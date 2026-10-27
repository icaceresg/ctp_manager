import test from 'node:test';
import assert from 'node:assert/strict';
import { readWholeChat } from '../client/src/operations/chatHistory.js';

const byId = (a, b) => a.id - b.id;
// Fake CTP chat: pages of `size`, newest page first, cursor = oldest id of the page.
function chat(ids, size = 50) {
  const calls = [];
  const fetchPage = async cursor => {
    calls.push(cursor);
    const older = cursor === null ? ids : ids.filter(id => id < cursor);
    const page = older.slice(-size);
    return { value: { cursor }, messages: page.map(id => ({ id })), next: older.length > size ? page[0] : null };
  };
  return { fetchPage, calls };
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('reads every page so the whole chat is shown without asking for older messages', async () => {
  const { fetchPage, calls } = chat(range(1, 120));
  const read = await readWholeChat(fetchPage, byId);
  assert.deepEqual(read.messages.map(m => m.id), range(1, 120));
  assert.equal(read.complete, true);
  assert.deepEqual(read.value, { cursor: null }, 'value is the newest page');
  assert.equal(calls.length, 3);
});

test('a refresh reuses the history already read instead of asking CTP again', async () => {
  const first = await readWholeChat(chat(range(1, 120)).fetchPage, byId);
  const { fetchPage, calls } = chat(range(1, 125));
  const read = await readWholeChat(fetchPage, byId, first);
  assert.deepEqual(read.messages.map(m => m.id), range(1, 125));
  assert.equal(read.complete, true);
  assert.equal(calls.length, 1);
});

test('a message removed in CTP does not come back from the previous read', async () => {
  const first = await readWholeChat(chat(range(1, 120)).fetchPage, byId);
  const read = await readWholeChat(chat(range(1, 120).filter(id => id !== 100)).fetchPage, byId, first);
  assert.equal(read.messages.some(m => m.id === 100), false);
  assert.equal(read.messages.length, 119);
});

test('a very long chat stops at the page limit and says it is incomplete', async () => {
  const read = await readWholeChat(chat(range(1, 500)).fetchPage, byId, null, 3);
  assert.deepEqual(read.messages.map(m => m.id), range(351, 500));
  assert.equal(read.complete, false);
});
