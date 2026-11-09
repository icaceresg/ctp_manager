import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRetrospectiveItems, retrospectiveActionOverdue, retrospectiveDateKey, retrospectiveExportDocument,
  retrospectiveExportName, retrospectiveItemAuthor, retrospectiveOwnershipKey, readRetrospectiveEditKey,
  safeRetrospectiveLink, storeRetrospectiveEditKey,
} from '../client/src/pages/retrospectiveModel.js';

test('retrospective search combines accent-insensitive words, triage filters and explicit ownership without exposing anonymous authors', () => {
  const items = [
    { id: 'a', kind: 'improve', area: 'production', severity: 'high', title: 'Coordinación del directo', description: 'Retraso de sonido', proposal: '', votes: 3, anonymous: true, author: { id: 9, name: 'Must stay hidden' } },
    { id: 'b', kind: 'keep', area: 'clubs', severity: 'low', title: 'Información a clubes', votes: 5, author: { id: 9, name: 'Staff' } },
    { id: 'c', kind: 'idea', area: 'production', severity: 'high', title: 'Coordinación del directo', archived: true },
  ];
  assert.deepEqual(filterRetrospectiveItems(items, { query: 'coordinacion sonido', area: 'production', severity: 'high' }).map(x => x.id), ['a']);
  assert.deepEqual(filterRetrospectiveItems(items, { mine: true }, 9).map(x => x.id), ['b']);
  assert.deepEqual(filterRetrospectiveItems(items, { mine: true, mineIds: ['a'] }, 9).map(x => x.id), ['b', 'a']);
  assert.equal(retrospectiveItemAuthor(items[0]), 'Anónimo');
});

test('ownership claims are scoped to user, retrospective and item, validate values and tolerate unavailable browser storage', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const claim = 'a'.repeat(64);
  assert.equal(storeRetrospectiveEditKey(storage, 9, 'retro-a', 'item-a', claim), true);
  assert.equal(readRetrospectiveEditKey(storage, 9, 'retro-a', 'item-a'), claim);
  assert.equal(readRetrospectiveEditKey(storage, 10, 'retro-a', 'item-a'), null);
  assert.equal(readRetrospectiveEditKey(storage, 9, 'retro-b', 'item-a'), null);
  assert.equal(retrospectiveOwnershipKey(9, '../other', 'item-a'), null);
  assert.equal(storeRetrospectiveEditKey(storage, 9, 'retro-a', 'item-a', 'bad'), false);
  assert.equal(readRetrospectiveEditKey({ getItem() { throw Error('blocked'); } }, 9, 'retro-a', 'item-a'), null);
});

test('portable export strips capabilities, IDs, hidden anonymous names and technical metadata even from malformed upstream extras', () => {
  const doc = retrospectiveExportDocument({
    retrospective: { id: 'r', title: 'Inaugural', eventDate: '2026-11-08', summary: 'Decisiones', secret: 'private' },
    items: [{ id: 'i', title: 'Mejora', anonymous: true, author: { id: 9, name: 'Hidden author' }, createdAt: '2026-11-09T15:45:00Z', editKey: 'secret-key', edit_key_hash: 'private-hash', voters: [9], description: 'Texto', evidenceUrl: 'javascript:alert(1)', comments: [{ text: 'Respuesta', anonymous: true, author: { name: 'Hidden reply' }, createdAt: '2026-11-09T16:00:00Z' }] }],
    actions: [{ title: 'Acción', owner: { id: 10, name: 'Coordinación' }, dueDate: '2026-11-12', status: 'todo' }],
  });
  const json = JSON.stringify(doc);
  for (const secret of ['Hidden author', 'Hidden reply', 'secret-key', 'private-hash', 'voters', 'editKey']) assert.equal(json.includes(secret), false);
  assert.equal(doc.items[0].author, null); assert.equal(doc.items[0].createdAt, '2026-11-09');
  assert.equal(doc.items[0].comments[0].createdAt, '2026-11-09'); assert.equal(doc.items[0].evidenceUrl, null);
  assert.equal(doc.actions[0].owner, 'Coordinación');
});

test('calendar dates and deadlines stay calendar-based and unsafe external references are not clickable', () => {
  assert.equal(retrospectiveDateKey('2026-02-31'), '');
  assert.equal(retrospectiveDateKey('2026-11-08'), '2026-11-08');
  assert.equal(retrospectiveActionOverdue({ dueDate: '2026-11-08', status: 'todo' }, '2026-11-09'), true);
  assert.equal(retrospectiveActionOverdue({ dueDate: '2026-11-08', status: 'done' }, '2026-11-09'), false);
  assert.equal(safeRetrospectiveLink('https://user:password@example.test/file'), null);
  assert.equal(safeRetrospectiveLink('https://example.test/file'), 'https://example.test/file');
  assert.equal(safeRetrospectiveLink('data:text/html,evil'), null);
  assert.equal(retrospectiveExportName('../../Inaugural · CTP'), 'retrospectiva-inaugural-ctp.json');
});
