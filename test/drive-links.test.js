import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { MAX_DRIVE_URL_LENGTH, parseDriveLink } from '../shared/drive.js';

// All identifiers and keys are synthetic. These tests never request Google,
// authenticate a user, fetch media or use the shared DEV database.
const FILE = '1QA_file-ABCDEFGHIJKLMNOP_0123456789';
const OTHER = '1QA_other-ABCDEFGHIJKLMNOP_9876543210';
const KEY = '0-QaResourceKey_AbCdEf0123456789';
const fileUrl = `https://drive.google.com/file/d/${FILE}/view`;
const keyQuery = `resourcekey=${KEY}`;
let vite, DriveLinks;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  ({ DriveLinks } = await vite.ssrLoadModule('/src/components/DriveLinks.jsx'));
});
after(async () => { await vite?.close(); });

test('a shared file keeps its exact identifier and resource key while removing tracking and navigation', () => {
  const result = parseDriveLink(`  https://DRIVE.GOOGLE.COM/file/d/${FILE}/preview?usp=sharing&${keyQuery}#navigation  `);
  assert.equal(result.kind, 'file');
  assert.equal(result.url, `${fileUrl}?${keyQuery}`);
  const download = new URL(result.downloadUrl);
  assert.equal(download.origin, 'https://drive.google.com'); assert.equal(download.pathname, '/uc');
  assert.deepEqual([...download.searchParams], [['export', 'download'], ['id', FILE], ['resourcekey', KEY]]);
  assert.deepEqual(parseDriveLink(result.url), result, 'canonical links are stable across save/read cycles');
});

test('Drive viewer, open and download share links all resolve to the same file without following redirects', () => {
  for (const url of [
    `https://drive.google.com/file/d/${FILE}`, `https://drive.google.com/file/d/${FILE}/edit/`,
    `https://drive.google.com/open?usp=sharing&id=${FILE}&${keyQuery}`,
    `https://drive.google.com/uc?export=download&id=${FILE}&${keyQuery}`,
  ]) {
    const result = parseDriveLink(url);
    assert.equal(result.kind, 'file'); assert.equal(new URL(result.url).pathname, `/file/d/${FILE}/view`);
    assert.equal(new URL(result.downloadUrl).searchParams.get('id'), FILE);
    if (url.includes('resourcekey')) assert.equal(new URL(result.url).searchParams.get('resourcekey'), KEY);
  }
});

test('folders and Workspace documents open their actual Google surface without a fabricated file download', () => {
  const cases = [
    [`https://drive.google.com/drive/folders/${FILE}?usp=sharing`, 'folder', `https://drive.google.com/drive/folders/${FILE}`],
    [`https://drive.google.com/drive/u/2/folders/${FILE}?${keyQuery}`, 'folder', `https://drive.google.com/drive/folders/${FILE}?${keyQuery}`],
    [`https://docs.google.com/document/d/${FILE}/view?usp=sharing`, 'document', `https://docs.google.com/document/d/${FILE}/edit`],
    [`https://docs.google.com/spreadsheets/d/${FILE}/edit?${keyQuery}#gid=0`, 'spreadsheet', `https://docs.google.com/spreadsheets/d/${FILE}/edit?${keyQuery}`],
    [`https://docs.google.com/presentation/d/${FILE}/preview`, 'presentation', `https://docs.google.com/presentation/d/${FILE}/edit`],
  ];
  for (const [url, kind, canonical] of cases) assert.deepEqual(parseDriveLink(url), { url: canonical, kind, downloadUrl: null });
});

test('empty, non-string and excessively long input never becomes a link', () => {
  assert.equal(MAX_DRIVE_URL_LENGTH, 2048);
  for (const value of [undefined, null, '', '   ', 1, {}, [], `${fileUrl}?tracking=${'a'.repeat(MAX_DRIVE_URL_LENGTH)}`]) {
    assert.equal(parseDriveLink(value), null);
  }
});

test('only exact HTTPS Google hosts without credentials or explicit ports are accepted', () => {
  for (const url of [
    fileUrl.replace('https:', 'http:'), fileUrl.replace('https:', 'ftp:'), fileUrl.replace('https:', ''),
    `javascript:${fileUrl}`, `data:text/html,${fileUrl}`,
    `https://drive.google.com.evil.invalid/file/d/${FILE}/view`, `https://evil-drive.google.com/file/d/${FILE}/view`,
    `https://drive.google.com./file/d/${FILE}/view`, `https://www.drive.google.com/file/d/${FILE}/view`,
    `https://drive.google.com@evil.invalid/file/d/${FILE}/view`, `https://fixture-user@drive.google.com/file/d/${FILE}/view`,
    `https://fixture-user:fixture-password@docs.google.com/document/d/${FILE}/edit`,
    `https://drive.google.com:443/file/d/${FILE}/view`, `https://drive.google.com:8443/file/d/${FILE}/view`,
    `https://drıve.google.com/file/d/${FILE}/view`,
  ]) assert.equal(parseDriveLink(url), null, url);
});

test('IDs and resource keys cannot escape their URL positions or smuggle a second target', () => {
  for (const url of [
    'https://drive.google.com/file/d//view', `https://drive.google.com/file/d/${'a'.repeat(201)}/view`,
    `https://drive.google.com/file/d/${FILE}%2F${OTHER}/view`, `https://drive.google.com/open?id=${FILE}%26id%3D${OTHER}`,
    `https://drive.google.com/open?id=${FILE}&id=${OTHER}`, `https://drive.google.com/open?id=${FILE}&id=${FILE}`,
    `${fileUrl}?resourcekey=${KEY}%26id%3D${OTHER}`, `${fileUrl}?resourcekey=${KEY}%23fragment`,
    `${fileUrl}?resourcekey=${KEY}%20space`, `${fileUrl}?resourcekey=`, `${fileUrl}?resourcekey=${'a'.repeat(201)}`,
    `${fileUrl}?resourcekey=${KEY}&resourcekey=${KEY}`, `${fileUrl}?resourcekey=${KEY}&resourcekey=Other`,
    `https://drive.google.com/file/d/%22%20onmouseover%3Dalert(1)/view`,
    `https://drive.google.com/file/d/${FILE}/other-path`, `https://drive.google.com/url?url=https://example.invalid`,
    `https://docs.google.com/file/d/${FILE}/view`, `https://drive.google.com/document/d/${FILE}/edit`,
  ]) assert.equal(parseDriveLink(url), null, url);
});

test('URL controls and credential-bearing query strings are rejected rather than stored', () => {
  for (const character of ['\n', '\r', '\t', '\u0000', '\u007f']) {
    assert.equal(parseDriveLink(`https://drive.google.com/fi${character}le/d/${FILE}/view`), null);
  }
  for (const parameter of ['access_token', 'refresh_token', 'id_token', 'code', 'token', 'client_secret', 'ACCESS_TOKEN']) {
    assert.equal(parseDriveLink(`${fileUrl}?${parameter}=synthetic-not-a-credential`), null);
  }
});

test('unknown navigation parameters cannot change the saved file or its Google download destination', () => {
  const result = parseDriveLink(`${fileUrl}?redirect_uri=https://example.invalid&url=https://example.invalid&${keyQuery}`);
  assert.equal(result.url, `${fileUrl}?${keyQuery}`);
  const download = new URL(result.downloadUrl);
  assert.equal(download.searchParams.get('id'), FILE); assert.equal(download.searchParams.get('resourcekey'), KEY);
  assert.equal(download.searchParams.has('redirect_uri'), false); assert.equal(download.searchParams.has('url'), false);
});

const render = props => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('Drive links must not fetch media, resolve permissions or proxy Google'); };
  try { return renderToStaticMarkup(createElement(DriveLinks, props)); }
  finally { globalThis.fetch = original; }
};
const hrefs = html => [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));

test('real JSX offers native Google links and explains that download may require permission', () => {
  const html = render({ url: `${fileUrl}?${keyQuery}` }), links = hrefs(html);
  assert.match(html, /Abrir en Drive/); assert.match(html, /Descargar en Drive/);
  assert.match(html, /Google puede pedirte acceso o confirmar la descarga/);
  assert.equal(links.length, 2);
  assert.deepEqual(links, [parseDriveLink(`${fileUrl}?${keyQuery}`).url, parseDriveLink(`${fileUrl}?${keyQuery}`).downloadUrl]);
  assert.equal((html.match(/target="_blank"/g) || []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 2);
  assert.doesNotMatch(html, /<iframe|<script|<img|\sdownload(?:=|\s|>)/i);
});

test('folder and Workspace JSX offers opening only; invalid links render no actions', () => {
  for (const url of [`https://drive.google.com/drive/folders/${FILE}`, `https://docs.google.com/document/d/${FILE}/edit`,
    `https://docs.google.com/spreadsheets/d/${FILE}/edit`, `https://docs.google.com/presentation/d/${FILE}/edit`]) {
    const html = render({ url }); assert.equal(hrefs(html).length, 1);
    assert.match(html, /Abrir en Drive/); assert.doesNotMatch(html, /Descargar en Drive|\/uc\?/);
    assert.match(html, /Necesitas permiso de acceso/);
  }
  for (const url of ['', 'https://example.invalid/file', 'javascript:alert(1)']) assert.equal(render({ url }), '');
});

test('compact presentation retains safe native links without adding scripts or network operations', () => {
  const html = render({ url: fileUrl, compact: true });
  assert.match(html, /content-drive is-compact/); assert.equal(hrefs(html).length, 2);
  assert.ok(hrefs(html).every(url => new URL(url).origin === 'https://drive.google.com'));
  assert.doesNotMatch(html, /<script|<iframe|onload=|onclick=/i);
});
