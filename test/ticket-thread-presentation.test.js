import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

let vite, module;
const author = '10000000-0000-4000-8000-000000000001';
const viewer = '20000000-0000-4000-8000-000000000002';
const me = { id: 99, ctp_user_id: viewer, auth_mode: 'ctp', ctp_role: 'referee', is_admin: false, sections: ['arbitraje'] };
const base = () => ({
  viewer_id: viewer, can_change_status: true,
  ticket: { id: '30000000-0000-4000-8000-000000000003', status: 'abierto', description: 'Descripción de prueba', author: { id: author, username: 'Jugador de prueba' }, assigned: null, proof_url: null },
  messages: [], events: [],
});
before(async () => {
  // Real JSX, synthetic records and SSR only; no controller effects or remote data.
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  module = await vite.ssrLoadModule('/src/operations/TicketChat.jsx');
});
after(async () => { await vite?.close(); });
const render = (thread, changes = {}) => {
  let calls = 0;
  const props = { thread, me, returnTo: '/operaciones/incidencias?bucket=mine', busy: false, error: '', text: '', onReload() { ++calls; }, onAction() { ++calls; }, onSend() { ++calls; }, onTextChange() { ++calls; }, ...changes };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(module.TicketThreadView, props)));
  assert.equal(calls, 0, 'rendering must never assign, change a status or send a reply');
  return html;
};

test('shared references accept ordinary safe providers and never turn user text into remote media', () => {
  const thread = base();
  thread.ticket.proof_url = 'https://proof.example.invalid/clip?a=1&b=2';
  thread.ticket.description = 'Consulta https://playctp.com/es/ranked?lobby=synthetic y javascript:alert(1).';
  thread.messages = [
    { id: 'one', author_name: 'Jugador de prueba', body: 'https://youtu.be/synthetic <img src=x onerror=alert(1)>', created_at: '2026-10-29T10:00:00Z', is_staff: false },
    { id: 'two', author_name: 'Jugador de prueba', body: 'https://proof.example.invalid/clip?a=1&b=2', created_at: '2026-10-29T10:01:00Z', is_staff: false },
    { id: 'three', author_name: 'Jugador de prueba', body: 'https://user:pass@example.invalid/clip file:///example javascript:alert(1)', created_at: '2026-10-29T10:02:00Z', is_staff: false },
  ];
  const result = module.ticketReferences(thread);
  assert.equal(result.entries.length, 3, 'duplicate proof/message references have one context entry');
  assert.equal(result.entries[0].source, 'Prueba del ticket');
  assert(result.entries.some(entry => entry.url.includes('playctp.com/es/ranked?lobby=synthetic')));
  assert(result.entries.every(entry => !new URL(entry.url).username && ['http:', 'https:'].includes(new URL(entry.url).protocol)));
  const html = render(thread);
  assert.doesNotMatch(html, /<img|<iframe|<video|<embed|<object|href="(?:javascript:|file:|https:\/\/user:)/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /noopener noreferrer nofollow ugc/);
  assert.doesNotMatch(html, /Abrir partida y resolver|partido vinculado/);
});

test('the original request remains readable before replies, with safe links and no text truncation', () => {
  const thread = base();
  thread.ticket.created_at = '2026-10-29T09:00:00Z';
  thread.ticket.description = 'Descripción original íntegra. <img src=bad> https://proof.example.invalid/clip?view=1\n' + 'x'.repeat(19000) + ' Final de la solicitud.';
  const html = render(thread);
  assert.match(html, /<details class="ticket-original-request" open="">/);
  assert.match(html, /Solicitud inicial/);
  assert.match(html, /Descripción original íntegra/);
  assert.match(html, /Final de la solicitud/);
  assert.match(html, /&lt;img src=bad&gt;/);
  assert.match(html, /href="https:\/\/proof\.example\.invalid\/clip\?view=1"/);
  assert.match(html, /dateTime="2026-10-29T09:00:00Z"/i);
  assert.doesNotMatch(html, /<img|<video|<iframe|La descripción original está en el resumen/);
  assert(html.indexOf('Solicitud inicial') < html.indexOf('Mensajes y cambios del ticket'));
  const missingDate = base(); missingDate.ticket.created_at = 'invalid';
  assert.doesNotMatch(render(missingDate), /dateTime="invalid"/i);
});

test('message grouping requires an exact author identity, staff role and nearby chronology', () => {
  const first = { author_id: author, author_name: 'Mismo nombre', is_staff: false, created_at: '2026-10-29T10:00:00Z' };
  const second = { ...first, created_at: '2026-10-29T10:02:00Z' };
  assert.equal(module.consecutiveTicketMessages(first, second), true);
  assert.equal(module.consecutiveTicketMessages(first, { ...second, author_id: viewer }), false);
  assert.equal(module.consecutiveTicketMessages({ ...first, author_id: undefined }, { ...second, author_id: undefined }), false);
  assert.equal(module.consecutiveTicketMessages(first, { ...second, is_staff: true }), false);
  assert.equal(module.consecutiveTicketMessages(first, { ...second, created_at: '2026-10-29T10:06:00Z' }), false);
  assert.equal(module.consecutiveTicketMessages(first, { ...second, created_at: '2026-10-29T09:59:00Z' }), false);
  assert.equal(module.consecutiveTicketMessages(first, { ...second, created_at: 'not-a-date' }), false);
});

test('status editing is explicit and authoritative status capability is not inferred from assignment', () => {
  const thread = base();
  const editable = render(thread);
  assert.match(editable, /Aplicar estado/);
  assert.match(editable, /<button[^>]*disabled=""[^>]*>Aplicar estado<\/button>/);
  assert.match(editable, /Enviar una respuesta no cambia el estado/);
  const readOnly = render({ ...thread, can_change_status: false });
  assert.doesNotMatch(readOnly, /<select|Aplicar estado/);
  assert.match(readOnly, /CTP no permite cambiar el estado desde este ticket/);
  assert.match(readOnly, /Hacerme cargo/);
  assert.match(readOnly, /Enviar respuesta/);
});

test('assignment uses the official viewer UUID while closed conversation cannot send a reply', () => {
  const thread = base(); thread.ticket.assigned = { id: viewer, username: 'Árbitro de prueba' };
  assert.doesNotMatch(render(thread), /Hacerme cargo/);
  thread.ticket.assigned.id = String(me.id);
  assert.match(render(thread), /Hacerme cargo/, 'Manager local numeric ID is never a CTP assignment identity');
  thread.ticket.status = 'cerrado';
  const closed = render(thread);
  assert.doesNotMatch(closed, /<textarea|Enviar respuesta/);
  assert.match(closed, /Reábrelo desde Estado para responder/);
  const protectedClosed = render({ ...thread, can_change_status: false });
  assert.doesNotMatch(protectedClosed, /Reábrelo|<textarea|<select/);
  assert.match(protectedClosed, /Puedes consultar la conversación/);
});

test('last-message copy states the observed sender and never guesses the waiting party from manual status', () => {
  const thread = base(); thread.ticket.status = 'esperando_respuesta';
  thread.messages = [{ id: 'one', author_id: author, author_name: 'Jugador', is_staff: false, body: 'Respuesta de prueba', created_at: '2026-10-29T10:00:00Z' }];
  assert.match(render(thread), /Último mensaje del jugador/);
  thread.messages[0].is_staff = true;
  const html = render(thread);
  assert.match(html, /Última respuesta del staff/);
  assert.doesNotMatch(html, /Esperando al jugador|Esperando al staff|sin leer|historial completo/);
});

test('context references are bounded without removing the original text messages', () => {
  const thread = base();
  thread.messages = [{ id: 'one', body: Array.from({ length: 60 }, (_, i) => `https://proof.example.invalid/clip-${i}`).join('\n'), author_id: author, author_name: 'Jugador', is_staff: false, created_at: '2026-10-29T10:00:00Z' }];
  const result = module.ticketReferences(thread);
  assert.equal(result.entries.length, 50); assert.equal(result.truncated, true);
  const html = render(thread);
  assert.match(html, /clip-59/);
  assert.match(html, /El resto de enlaces sigue disponible en la conversación/);
});

test('a refresh failure offers a read retry without asking to repeat a player action', () => {
  const html = render(base(), { readError: 'No se pudo actualizar la consulta.' });
  assert.match(html, /No se ha podido actualizar la conversación/);
  assert.match(html, /Reintentar lectura/);
  assert.match(html, /Se conserva la última consulta disponible/);
  assert.doesNotMatch(html, /No se ha confirmado la acción|Repite la misma acción/);
  const action = render(base(), { error: 'No se recibió el recibo de la respuesta.' });
  assert.match(action, /No se ha confirmado la acción/);
  assert.match(action, /Repite la misma acción/);
  assert.doesNotMatch(action, /No se ha podido actualizar la conversación|Reintentar lectura/);
});

test('read and uncertain-write errors keep separate recovery instructions', () => {
  const html = render(base(), { readError: 'Lectura fallida.', error: 'Falta confirmar la respuesta.' });
  assert.match(html, /Lectura fallida/);
  assert.match(html, /Reintentar lectura/);
  assert.match(html, /Falta confirmar la respuesta/);
  assert.match(html, /Repite la misma acción/);
});

test('two links from one host display distinct paths and stable reference ordinals', () => {
  const thread = base();
  const paths = ['/synthetic-proof-one', '/synthetic-proof-two'];
  thread.messages = paths.map((path, index) => ({ id: 'link-' + index, author_id: author, author_name: 'Jugador', is_staff: false, body: 'https://gyazo.com' + path, created_at: '2026-10-29T10:00:00Z' }));
  const html = render(thread);
  for (const path of paths) {
    assert.match(html, new RegExp(`class="ticket-link-path">${path}<`));
    assert(html.includes(`href="https://gyazo.com${path}"`));
    assert(html.includes(`title="https://gyazo.com${path}"`));
  }
  assert.match(html, /aria-label="Enlace 1\. Abrir enlace compartido/);
  assert.match(html, /aria-label="Enlace 2\. Abrir enlace compartido/);
  assert.doesNotMatch(html, /<iframe|<img|<video/);
});
