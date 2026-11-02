import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { noticeDraft, sameNoticeDraft, siteNoticeAttempt, siteNoticeError, siteNoticeState } from '../client/src/pages/siteNoticeModel.js';
import { noticePreviewOrigin, siteNoticeDocument } from '../client/src/pages/siteNoticeDocument.js';
const fixture = { schema_version: 1, revision: 5, enabled: false, title: 'Copa DEV', html: '<h2>Nuevo torneo</h2><p>Datos sintéticos.</p>' };
let vite, views;
before(async () => { vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' }); views = await vite.ssrLoadModule('/src/pages/SiteNoticeEditor.jsx'); });
after(async () => { await vite?.close(); });
test('management DTOs are bounded and malformed responses never become trusted previews', () => {
  assert.deepEqual(siteNoticeState(fixture), fixture);
  assert.equal(siteNoticeState({ ...fixture, html: '&amp;'.repeat(8000) }).html.length, 40000);
  for (const patch of [{ schema_version: 2 }, { revision: 0 }, { enabled: 1 }, { title: 'x'.repeat(121) }, { html: 'x'.repeat(65537) }]) assert.throws(() => siteNoticeState({ ...fixture, ...patch }));
});
test('saving and retrying carries one CAS revision and one idempotency reference', () => {
  const draft = { ...noticeDraft(fixture), enabled: true }, id = '34100000-0000-4000-8000-000000000001';
  const first = siteNoticeAttempt(null, fixture, draft, () => id);
  assert.equal(first.expected_revision, 5); assert.equal(first.request_id, id);
  assert.equal(siteNoticeAttempt(first, fixture, draft, () => { throw Error('new id'); }), first);
  assert.throws(() => siteNoticeAttempt(first, fixture, { ...draft, html: '<p>Edited</p>' }));
  assert.throws(() => siteNoticeAttempt(first, { ...fixture, revision: 6 }, draft));
  assert.equal(sameNoticeDraft(fixture, noticeDraft(fixture)), true);
});
test('errors are fixed, no arbitrary server/provider details reach the editor', () => {
  assert.match(siteNoticeError({ status: 409, message: 'PRIVATE' }), /Otra persona/);
  for (const status of [400, 401, 403, 409, 422, 500]) assert.equal(siteNoticeError({ status, message: 'PRIVATE' }).includes('PRIVATE'), false);
});
test('actual preview uses the public popup styling, escapes titles and never uses email chrome', () => {
  const html = renderToStaticMarkup(createElement(views.SiteNoticePreview, { notice: { ...fixture, title: '<script>UNTRUSTED</script>' }, mobile: true, origin: 'https://pre.playctp.com' }));
  assert.match(html, /is-mobile/); assert.match(html, /&lt;script&gt;UNTRUSTED&lt;\/script&gt;/);
  assert.match(html, /sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(html, /allow-scripts|allow-same-origin|Enviar prueba|unsubscribe|email-images.*upload/);
  assert.match(html, /aviso está desactivado/);
  const empty = renderToStaticMarkup(createElement(views.SiteNoticePreview, { notice: { ...fixture, html: '' }, origin: 'https://pre.playctp.com' }));
  assert.doesNotMatch(empty, /iframe/); assert.match(empty, /permanecerá oculto/);
});
test('preview only resolves approved CTP environments and denies scripts at the document boundary', () => {
  const document = siteNoticeDocument(fixture.html, 'https://playctp.com');
  assert.match(document, /script-src &#39;none&#39;/); assert.match(document, /default-src &#39;none&#39;/);
  assert.equal(siteNoticeDocument(fixture.html, 'https://bad.invalid'), '');
  assert.equal(noticePreviewOrigin({ hostname: 'pre.manager.playctp.com' }), 'https://pre.playctp.com');
});
