import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync, backup } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const fail = code => { throw new Error(code); };
export const BACKUP_PATHS = Object.freeze({
  database: '/var/lib/ctp-manager-pre/myredesmanager.db',
  directory: '/opt/ctp/backups/manager-pre',
  environment: '/etc/ctp-manager/pre.env',
  unit: '/etc/systemd/system/ctp-manager-pre.service',
  current: '/srv/ctp-manager/pre/current',
  releases: '/srv/ctp-manager/pre/releases',
});

async function regularFile(filename, { rootOwned = false, maximum = Infinity } = {}) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) fail('backup_source_not_regular');
  if (rootOwned && (info.uid !== 0 || (info.mode & 0o022))) fail('backup_source_not_root_owned');
  return info;
}

async function canonicalParents(filename, { rootOwned = false } = {}) {
  let parent = path.dirname(filename);
  for (;;) {
    const info = await fs.lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('backup_parent_not_directory');
    if (rootOwned && (info.uid !== 0 || (info.mode & 0o022))) fail('backup_parent_not_root_owned');
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

export async function fileReceipt(filename, relative) {
  const stat = await regularFile(filename);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return { path: relative, bytes: stat.size, sha256: hash.digest('hex') };
}

async function syncPath(filename) {
  const handle = await fs.open(filename, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** SQLite's online backup includes committed WAL data without stopping Manager. */
export async function snapshotDatabase(source, destination) {
  await canonicalParents(source);
  await regularFile(source);
  try { await fs.lstat(destination); fail('backup_destination_exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const database = new DatabaseSync(source, { readOnly: true });
  try { await backup(database, destination, { rate: 100 }); }
  finally { database.close(); }
  await fs.chmod(destination, 0o600);
  // Normalize only the completed copy, so restoring needs no sidecar WAL/SHM.
  const copy = new DatabaseSync(destination);
  try {
    copy.exec('PRAGMA journal_mode=DELETE;');
    const rows = copy.prepare('PRAGMA integrity_check;').all();
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') fail('backup_integrity_failed');
  } finally { copy.close(); }
  if ((await fs.lstat(destination)).size === 0) fail('backup_database_empty');
}

async function backupDirectory() {
  await canonicalParents(BACKUP_PATHS.directory, { rootOwned: true });
  try { await fs.mkdir(BACKUP_PATHS.directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await fs.lstat(BACKUP_PATHS.directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077)) fail('backup_directory_not_private');
}

async function releaseMetadata() {
  await canonicalParents(BACKUP_PATHS.current, { rootOwned: true });
  const link = await fs.lstat(BACKUP_PATHS.current);
  if (!link.isSymbolicLink() || link.uid !== 0) fail('backup_current_not_root_symlink');
  const directory = await fs.realpath(BACKUP_PATHS.current);
  if (path.dirname(directory) !== BACKUP_PATHS.releases || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(path.basename(directory))) fail('backup_release_outside_root');
  const manifest = path.join(directory, 'manifest.json');
  await canonicalParents(manifest, { rootOwned: true });
  await regularFile(manifest, { rootOwned: true, maximum: 4 * 1024 * 1024 });
  const metadata = JSON.parse(await fs.readFile(manifest, 'utf8'));
  if (metadata.application !== 'ctp-manager' || metadata.repository !== 'icaceresg/ctp_manager'
    || !/^[a-f0-9]{40}$/.test(metadata.source?.commit)) fail('backup_release_metadata_invalid');
  return { manifest, commit: metadata.source.commit, dirty: metadata.source.dirty === true };
}

export async function backupManager() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) fail('backup_requires_linux_root');
  if (process.argv.slice(2).length) fail('backup_accepts_no_arguments');
  process.umask(0o077);
  await backupDirectory();
  for (const filename of [BACKUP_PATHS.environment, BACKUP_PATHS.unit]) {
    await canonicalParents(filename, { rootOwned: true });
    await regularFile(filename, { rootOwned: true, maximum: 1024 * 1024 });
  }
  const release = await releaseMetadata();
  const createdAt = new Date().toISOString();
  const generation = `manager-pre-${createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(5).toString('hex')}`;
  const temporary = await fs.mkdtemp(path.join(BACKUP_PATHS.directory, '.incoming-'));
  let published = false;
  try {
    const database = path.join(temporary, 'myredesmanager.db');
    const archive = path.join(temporary, 'configs.private.tar.gz');
    const sources = [BACKUP_PATHS.environment, BACKUP_PATHS.unit, release.manifest];
    const before = await Promise.all(sources.map(filename => fileReceipt(filename, 'private-source')));
    await execute('/usr/bin/tar', ['--create', '--gzip', '--format=ustar', '--file', archive, '--directory', '/', '--', ...sources.map(filename => filename.slice(1))], { maxBuffer: 1024 * 1024 });
    await fs.chmod(archive, 0o600);
    const listing = await execute('/usr/bin/tar', ['--list', '--gzip', '--file', archive], { maxBuffer: 1024 * 1024 });
    if (listing.stdout.trim().split('\n').sort().join('\n') !== sources.map(filename => filename.slice(1)).sort().join('\n')) fail('backup_configuration_inventory_mismatch');
    await snapshotDatabase(BACKUP_PATHS.database, database);
    const after = await Promise.all(sources.map(filename => fileReceipt(filename, 'private-source')));
    if (JSON.stringify(before) !== JSON.stringify(after) || (await releaseMetadata()).manifest !== release.manifest) fail('backup_configuration_changed');
    const metadata = { schemaVersion: 1, application: 'ctp-manager', environment: 'pre', createdAt,
      sourceCommit: release.commit, sourceDirty: release.dirty, integrity: 'ok',
      files: [await fileReceipt(database, 'myredesmanager.db'), await fileReceipt(archive, 'configs.private.tar.gz')] };
    await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await Promise.all([database, archive, path.join(temporary, 'manifest.json')].map(syncPath));
    await syncPath(temporary);
    await fs.rename(temporary, path.join(BACKUP_PATHS.directory, generation));
    await syncPath(BACKUP_PATHS.directory);
    published = true;
    return { ok: true, generation, sourceCommit: release.commit, integrity: 'ok', files: metadata.files.length };
  } finally {
    if (!published) {
      const resolved = await fs.realpath(temporary);
      if (path.dirname(resolved) !== BACKUP_PATHS.directory || !path.basename(resolved).startsWith('.incoming-')) fail('backup_cleanup_outside_root');
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) backupManager().then(result => {
  console.log(JSON.stringify(result));
}).catch(error => {
  // Provider tokens, encryption keys, tar output and SQL errors never enter logs.
  console.error(JSON.stringify({ ok: false, code: /^[a-z_]+$/.test(error.message) ? error.message : 'manager_backup_failed' }));
  process.exitCode = 1;
});
