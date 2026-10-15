import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PACKAGE_ROOTS = Object.freeze(['server', 'shared', 'dist', 'package.json', 'package-lock.json']);
const digest = content => createHash('sha256').update(content).digest('hex');
const reject = code => { throw new Error(code); };

export function safePackagePath(relative) {
  return typeof relative === 'string' && relative.length > 0 && relative.length <= 240
    && !/[\\:\x00-\x1f\x7f]/.test(relative) && !relative.startsWith('/')
    && relative.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));
}

export function hasPrivateCredential(content) {
  const text = content.toString('utf8');
  if (/\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|whsec_[A-Za-z0-9]{16,})\b/.test(text)
    || /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(text)) return true;
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    try {
      if (JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url')).role === 'service_role') return true;
    } catch { /* Non-JWT text does not expose a usable service-role key. */ }
  }
  return false;
}

export async function collectPackageFiles(cwd) {
  const files = [];
  async function visit(relative) {
    if (!safePackagePath(relative)) reject('unsafe_package_path');
    const original = path.join(cwd, relative);
    const info = await fs.lstat(original);
    if (info.isSymbolicLink()) reject('package_link_refused');
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(original)).sort()) await visit(`${relative}/${name}`);
      return;
    }
    if (!info.isFile()) reject('package_special_file_refused');
    if (/\.(?:map|key|pem|db|sqlite|sqlite3|sql|bak|log)$/i.test(relative)
      || /(?:^|\/)(?:node_modules|data|output|test|tests|validation\.local)(?:\/|$)/i.test(relative)) reject('private_package_file');
    if (info.size > 100 * 1024 * 1024) reject('package_file_too_large');
    const content = await fs.readFile(original);
    if (hasPrivateCredential(content)) reject('package_contains_private_credential');
    files.push({ path: relative, sha256: digest(content), bytes: content.length, content });
    if (files.length > 10000 || files.reduce((sum, file) => sum + file.bytes, 0) > 400 * 1024 * 1024) reject('package_size_limit');
  }
  for (const root of PACKAGE_ROOTS) await visit(root);
  if (!files.some(file => file.path === 'server/index.js') || !files.some(file => file.path === 'dist/index.html')) reject('package_entrypoint_required');
  return files;
}

export async function packageVps({ cwd = process.cwd(), out, env = process.env } = {}) {
  if (typeof out !== 'string' || !out.endsWith('.tar.gz')) reject('tar_gzip_output_required');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit) || (env.GITHUB_SHA && env.GITHUB_SHA !== commit)) reject('source_commit_mismatch');
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd, encoding: 'utf8' }).trim());
  const files = await collectPackageFiles(cwd);
  const publicFile = ({ path: name, sha256, bytes }) => ({ path: name, sha256, bytes });
  const sourceFiles = files.filter(file => !file.path.startsWith('dist/')).map(publicFile);
  const builtFiles = files.filter(file => file.path.startsWith('dist/')).map(publicFile);
  const manifest = {
    schemaVersion: 1,
    application: 'ctp-manager',
    repository: 'icaceresg/ctp_manager',
    source: { commit, dirty, sha256: digest(JSON.stringify(sourceFiles)), files: sourceFiles },
    build: { sha256: digest(JSON.stringify(builtFiles)), files: builtFiles },
  };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ctp-manager-package-'));
  try {
    for (const file of files) {
      const destination = path.join(temporary, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.content, { mode: 0o644, flag: 'wx' });
    }
    await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest) + '\n', { mode: 0o644, flag: 'wx' });
    const output = path.resolve(cwd, out);
    await fs.mkdir(path.dirname(output), { recursive: true });
    execFileSync('tar', ['-czf', output, '--format=ustar', '-C', temporary, 'manifest.json', ...PACKAGE_ROOTS], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const archive = await fs.readFile(output);
    if (archive.length > 200 * 1024 * 1024) reject('compressed_package_size_limit');
    return { ok: true, commit, dirty, files: files.length, bytes: archive.length, sha256: digest(archive), output };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') reject('usage_package_vps_out_tar_gz');
  console.log(JSON.stringify(await packageVps({ out: args[1] })));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'manager_package_failed');
  process.exitCode = 1;
});
