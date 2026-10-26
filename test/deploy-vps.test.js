import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const posix = process.platform !== 'win32';
const script = path.resolve('scripts/deploy-vps.sh');
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-deploy-ci-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('manager-deploy-ci-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'output'));
  fs.writeFileSync(path.join(root, 'output/ctp-manager.tar.gz'), 'synthetic package');
  fs.writeFileSync(path.join(root, 'bin/ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.SSH_CALLS, process.argv.at(-1) + '\\n');
if (process.env.SSH_FAILURE) {
  console.error(process.env.SSH_PRIVATE_KEY);
  process.exit(255);
}
const command = process.argv.at(-1).split(' ');
const data = command[0] === 'check'
  ? {status:'ready',environment:command[1],current:'manual-previous'}
  : {status:'deployed',environment:command[1],release:command.slice(2,5).join('-'),commit:command[2],artifactSha256:command[5]};
if (process.env.WRONG_RECEIPT) data.release = 'unrelated-release';
console.log(JSON.stringify(data));
`, { mode: 0o700 });
  const env = { ...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH,
    RUNNER_TEMP: root, SSH_CALLS: path.join(root, 'ssh-calls'), GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
    GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch',
    SSH_PRIVATE_KEY: 'synthetic-value-never-print', VPS_HOST: 'vps.example.invalid',
    VPS_KNOWN_HOSTS: 'vps.example.invalid ssh-ed25519 synthetic', ...overrides };
  return { root, env, run: (environment, operation) => spawnSync('bash', [script, environment, operation],
    { cwd: root, env, encoding: 'utf8', timeout: 15000 }) };
}

test('production dry run verifies restricted access without sending a deployment', { skip: !posix }, t => {
  const f = fixture(t, { DEPLOY_DRY_RUN: 'true' });
  const result = f.run('prod', 'check');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(f.env.SSH_CALLS, 'utf8'), 'check prod\n');
  assert.match(fs.readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /publishes nothing/);
  assert.ok(!result.stdout.includes(f.env.SSH_PRIVATE_KEY));
});

test('production refuses automatic events, the wrong branch and missing publication confirmation before SSH', { skip: !posix }, t => {
  for (const overrides of [
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/pre' },
    { DEPLOY_DRY_RUN: 'true', DEPLOY_CONFIRMATION: 'PUBLICAR PRODUCCION' },
    { DEPLOY_DRY_RUN: 'false', DEPLOY_CONFIRMATION: '' },
  ]) {
    const f = fixture(t, overrides);
    assert.notEqual(f.run('prod', 'deploy').status, 0);
    assert.equal(fs.existsSync(f.env.SSH_CALLS), false);
  }
});

test('an explicitly confirmed production publication accepts only its own release receipt', { skip: !posix }, t => {
  const f = fixture(t, { DEPLOY_DRY_RUN: 'false', DEPLOY_CONFIRMATION: 'PUBLICAR PRODUCCION' });
  const result = f.run('prod', 'deploy');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"status":"deployed"/);
  assert.match(fs.readFileSync(f.env.SSH_CALLS, 'utf8'), /^deploy prod a{40} 123 1 [a-f0-9]{64}\n$/);
  f.env.WRONG_RECEIPT = '1';
  assert.notEqual(f.run('prod', 'deploy').status, 0);
});

test('failed SSH never exposes raw stderr or a private value', { skip: !posix }, t => {
  const f = fixture(t, { SSH_FAILURE: '1' });
  const result = f.run('prod', 'check');
  assert.notEqual(result.status, 0);
  assert.ok(!(result.stdout + result.stderr).includes(f.env.SSH_PRIVATE_KEY));
});

test('PRE still accepts its own automatic branch and refuses main', { skip: !posix }, t => {
  const f = fixture(t, { GITHUB_REF: 'refs/heads/pre', GITHUB_EVENT_NAME: 'push' });
  assert.equal(f.run('pre', 'check').status, 0);
  assert.equal(f.run('pre', 'deploy').status, 0);
  f.env.GITHUB_REF = 'refs/heads/main';
  assert.notEqual(f.run('pre', 'deploy').status, 0);
});
