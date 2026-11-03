import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite, Editor, Group, Provider;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  ({ ContentEditor: Editor } = await vite.ssrLoadModule('/src/components/ContentEditor.jsx'));
  ({ ResourceGroup: Group } = await vite.ssrLoadModule('/src/pages/ResourcesPage.jsx'));
  ({ AppProvider: Provider } = await vite.ssrLoadModule('/src/context.jsx'));
});
after(async () => { await vite?.close(); });
const content = { id: 1, title: 'Publicación QA sintética', status: 'no_listo', owner: '', date: null, time: null,
  platforms: [], description: '', copy: '', notes: '', resources: [],
  drive_url: 'https://drive.google.com/file/d/QA_asset/view?resourcekey=0-QA_key' };
const render = (Component, props) => renderToStaticMarkup(createElement(Provider, { me: { id: 1, is_admin: true, sections: ['calendario','recursos'] } }, createElement(Component, props)));

test('publication editor pre-fills its own Drive URL and keeps direct actions separate from saving', () => {
  const html = render(Editor, { content, onClose() {} });
  assert.match(html, /label for="c-drive">Archivo o carpeta de Google Drive/);
  assert.match(html, /id="c-drive"[^>]+type="url"[^>]+maxLength="2048"/i);
  assert.match(html, /value="https:\/\/drive\.google\.com\/file\/d\/QA_asset\/view\?resourcekey=0-QA_key"/);
  assert.match(html, /Descargar en Drive/);
  assert.match(html, /Google puede pedirte acceso o confirmar la descarga/);
  assert.match(html, /Guardar/);
  assert.doesNotMatch(html, /<iframe|<img|download=|oauth|access_token/i);
});

test('invalid or absent draft link offers no external action and invalid input is announced', () => {
  const invalid = render(Editor, { content: { ...content, drive_url: 'https://example.com/asset' }, onClose() {} });
  assert.match(invalid, /aria-invalid="true"/);
  assert.match(invalid, /aria-describedby="c-drive-hint"/);
  assert.doesNotMatch(invalid, /href="https:\/\/example\.com|Descargar en Drive|Abrir en Drive/);
  const old = { ...content }; delete old.drive_url;
  const empty = render(Editor, { content: old, onClose() {} });
  assert.doesNotMatch(empty, /aria-invalid="true"|Descargar en Drive|Abrir en Drive/);
});

test('Drive-only publication renders in Resources without zero-division or invented checklist progress', () => {
  const html = render(Group, { content, filter: 'pending', onUpdated() {} });
  assert.match(html, /Material en Drive/);
  assert.match(html, /Descargar en Drive/);
  assert.doesNotMatch(html, /NaN|Infinity|Todo listo|0\/0|<ul/);
  assert.doesNotMatch(html, /<button[^>]*>\s*<a/);
});
