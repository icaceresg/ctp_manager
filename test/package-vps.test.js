import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { safePackagePath, hasPrivateCredential, collectPackageFiles, packageVps } from '../scripts/package-vps.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-manager-package-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ctp-manager-package-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const write = (relative, content) => {
    const destination = path.join(directory, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  write('server/index.js', 'console.log("synthetic manager");');
  write('shared/access.js', 'export const staffOnly = true;');
  write('dist/index.html', '<!doctype html><title>Manager fixture</title>');
  write('dist/assets/app.js', 'console.log("compiled fixture");');
  write('package.json', '{"name":"manager-fixture","private":true,"type":"module"}');
  write('package-lock.json', '{"name":"manager-fixture","lockfileVersion":3,"packages":{}}');
  write('.gitignore', 'dist/\noutput/\ndata/\n.env\nnode_modules/\n');
  write('.env', 'SYNTHETIC_SECRET=not-for-the-package');
  write('data/myredesmanager.db', 'not a real database');
  write('node_modules/fake/index.js', 'not for the package');
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--initial-branch=pre']);
  git(['add', '.']);
  git(['-c', 'user.name=CTP package QA', '-c', 'user.email=package-qa@example.invalid', 'commit', '-m', 'Synthetic package fixture']);
  return { directory, write, git, commit: git(['rev-parse', 'HEAD']) };
}

test('package paths refuse traversal, Windows drive names, hidden files and control characters', () => {
  for (const value of ['../.env', 'server/../data/a', '/etc/passwd', 'C:/secrets', 'dist\\app.js', 'dist/.env', 'dist//app.js', 'x\ny']) {
    assert.equal(safePackagePath(value), false, value);
  }
  assert.equal(safePackagePath('dist/assets/index-abc12345.js'), true);
});

test('credential scanning blocks restricted Stripe keys, private keys and service-role JWTs', () => {
  assert.equal(hasPrivateCredential(Buffer.from('rk_test_' + 'a'.repeat(24))), true);
  assert.equal(hasPrivateCredential(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----')), true);
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString('base64url')}.abcdefghijklmnopqrstuv`;
  assert.equal(hasPrivateCredential(Buffer.from(jwt)), true);
  assert.equal(hasPrivateCredential(Buffer.from('export const platform = "ctp";')), false);
});

test('runtime archive contains only explicit roots and hashes every source and built file', async t => {
  const source = fixture(t);
  const receipt = await packageVps({ cwd: source.directory, out: 'output/manager.tar.gz', env: {} });
  assert.equal(receipt.commit, source.commit);
  assert.equal(receipt.dirty, false);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', receipt.output, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.application, 'ctp-manager');
  assert.equal(manifest.source.commit, source.commit);
  assert.equal(manifest.source.dirty, false);
  assert.deepEqual(manifest.source.files.map(file => file.path), ['server/index.js', 'shared/access.js', 'package.json', 'package-lock.json']);
  assert.deepEqual(manifest.build.files.map(file => file.path), ['dist/assets/app.js', 'dist/index.html']);
  for (const file of [...manifest.source.files, ...manifest.build.files]) {
    const content = fs.readFileSync(path.join(source.directory, file.path));
    assert.equal(file.sha256, createHash('sha256').update(content).digest('hex'));
    assert.equal(file.bytes, content.length);
  }
  const entries = execFileSync('tar', ['-tzf', receipt.output], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.every(entry => entry === 'manifest.json' || /^(?:server|shared|dist)\//.test(entry) || /^package(?:-lock)?\.json$/.test(entry)));
  assert.ok(!entries.some(entry => /(?:\.env|node_modules|data\/|test\/)/.test(entry)));
});

test('package marks local source edits honestly and rejects a mismatched GitHub commit', async t => {
  const source = fixture(t);
  source.write('server/index.js', 'console.log("edited source");');
  const receipt = await packageVps({ cwd: source.directory, out: 'output/manager.tar.gz', env: {} });
  assert.equal(receipt.dirty, true);
  await assert.rejects(packageVps({ cwd: source.directory, out: 'output/rejected.tar.gz', env: { GITHUB_SHA: 'f'.repeat(40) } }), /source_commit_mismatch/);
  assert.equal(fs.existsSync(path.join(source.directory, 'output/rejected.tar.gz')), false);
});

test('source and compiled assets reject symlinks instead of following them', async t => {
  const source = fixture(t);
  fs.symlinkSync(path.join(source.directory, 'data'), path.join(source.directory, 'dist', 'linked-data'), 'junction');
  await assert.rejects(collectPackageFiles(source.directory), /package_link_refused/);
});

test('hidden configuration, databases and leaked credentials cannot enter the runtime package', async t => {
  const source = fixture(t);
  for (const [relative, content, expected] of [
    ['dist/.env', 'hidden', /unsafe_package_path/],
    ['dist/capture.sqlite', 'database', /private_package_file/],
    ['dist/assets/config.mjs', 'export const key = "sk_test_' + 'a'.repeat(24) + '";', /package_contains_private_credential/],
  ]) {
    source.write(relative, content);
    await assert.rejects(collectPackageFiles(source.directory), expected);
    fs.unlinkSync(path.join(source.directory, relative));
  }
});

function installedDependencies(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-manager-deps-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source.directory, name), path.join(directory, name));
  const write = (relative, content) => {
    const destination = path.join(directory, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  write('node_modules/.package-lock.json', '{"lockfileVersion":3}');
  write('node_modules/express/package.json', '{"name":"express","version":"5.2.1"}');
  write('node_modules/express/index.js', 'module.exports = {};');
  write('node_modules/gopd/.eslintrc', '{}');
  write('node_modules/gopd/test/index.js', 'require("../");');
  return { directory, write };
}

test('release can bundle the production dependencies installed from the same lockfile', async t => {
  const source = fixture(t);
  const deps = installedDependencies(t, source);
  const receipt = await packageVps({ cwd: source.directory, out: 'output/manager.tar.gz', deps: deps.directory, env: { GITHUB_REF: 'refs/heads/pre' } });
  assert.equal(receipt.dependencies, 5);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', receipt.output, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.ref, 'refs/heads/pre');
  assert.deepEqual(manifest.dependencies.files.map(file => file.path), [
    'node_modules/.package-lock.json', 'node_modules/express/index.js', 'node_modules/express/package.json',
    'node_modules/gopd/.eslintrc', 'node_modules/gopd/test/index.js',
  ]);
  const entries = execFileSync('tar', ['-tzf', receipt.output], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.includes('node_modules/express/package.json'));
  assert.ok(!entries.some(entry => /(?:\.env|data\/)/.test(entry)));
});

test('dependency bundling refuses another lockfile, links and leaked credentials', async t => {
  const source = fixture(t);
  const deps = installedDependencies(t, source);
  fs.writeFileSync(path.join(deps.directory, 'package-lock.json'), '{"name":"other","lockfileVersion":3,"packages":{}}');
  await assert.rejects(packageVps({ cwd: source.directory, out: 'output/a.tar.gz', deps: deps.directory, env: {} }), /dependency_lockfile_mismatch/);
  fs.copyFileSync(path.join(source.directory, 'package-lock.json'), path.join(deps.directory, 'package-lock.json'));
  deps.write('node_modules/leak/index.js', 'const key = "sk_live_' + 'b'.repeat(24) + '";');
  await assert.rejects(packageVps({ cwd: source.directory, out: 'output/b.tar.gz', deps: deps.directory, env: {} }), /dependency_contains_private_credential/);
  fs.rmSync(path.join(deps.directory, 'node_modules/leak'), { recursive: true });
  fs.symlinkSync(path.join(source.directory, 'data'), path.join(deps.directory, 'node_modules', 'linked'), 'junction');
  await assert.rejects(packageVps({ cwd: source.directory, out: 'output/c.tar.gz', deps: deps.directory, env: {} }), /dependency_link_refused/);
});
