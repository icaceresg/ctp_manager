import test from 'node:test';
import assert from 'node:assert/strict';
import {reportEvidenceUrls} from '../shared/report-evidence.js';

test('staff can open an extensionless qu.ax share page and a manual proof, deduplicated', () => {
  assert.deepEqual(reportEvidenceUrls('Descripción\nPrueba temporal: https://qu.ax/QAonly\nhttps://qu.ax/QAonly\nhttps://example.invalid/clip?id=1'),
    ['https://qu.ax/QAonly', 'https://example.invalid/clip?id=1']);
});
test('unsupported schemes, credentials, backslashes and oversized notes produce no active unsafe links', () => {
  for (const value of [null, 8, '', 'javascript:alert(1)', 'data:image/svg+xml,evil', 'https://private:secret@qu.ax/QAonly', 'https://qu.ax\\evil/QAonly', 'x'.repeat(2001)])
    assert.deepEqual(reportEvidenceUrls(value), []);
  assert.equal(reportEvidenceUrls(Array.from({length:8}, (_,n)=>`https://qu.ax/QA${n}`).join('\n')).length,3);
});
test('evidence controls render explicit safe links and never embed or interpret report HTML', async () => {
  const {createServer} = await import('vite');
  const {createElement} = await import('react');
  const {renderToStaticMarkup} = await import('react-dom/server');
  const server = await createServer({server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  try {
    const {ReportEvidenceLinks} = await server.ssrLoadModule('/src/operations/ReportEvidenceLinks.jsx');
    const html = renderToStaticMarkup(createElement(ReportEvidenceLinks,{details:'<img src=x onerror=alert(1)>\nhttps://qu.ax/QAonly'}));
    assert.match(html,/href="https:\/\/qu\.ax\/QAonly"/);
    assert.match(html,/noopener noreferrer nofollow/);
    assert.match(html,/Ver prueba/);
    assert.doesNotMatch(html,/<(?:img|iframe|script)\b|onerror/);
    assert.equal(renderToStaticMarkup(createElement(ReportEvidenceLinks,{details:'Sin pruebas'})),'');
  } finally { await server.close(); }
});
