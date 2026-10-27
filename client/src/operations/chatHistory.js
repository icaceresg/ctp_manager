// CTP sends match chats in pages of up to 50 messages, newest page first.
// Staff must see the whole conversation, so every read walks back to the
// first message. `known` is the previous read of the same chat: once a page
// reaches a message already known, the older part is reused instead of asking
// CTP for it again on every refresh.
export const CHAT_MAX_PAGES = 40;

/**
 * fetchPage(cursor) resolves to { value, messages, next }, where `next` is the
 * cursor of the older page or null. `older(a, b)` is negative when a was
 * written before b. Returns the newest page's `value`, every message from
 * oldest to newest and whether the read reached the first message.
 */
export async function readWholeChat(fetchPage, older, known = null, maxPages = CHAT_MAX_PAGES) {
  const knownIds = new Set((known?.messages || []).map(message => String(message.id)));
  const byId = new Map();
  let cursor = null, value, pages = 0, complete = false;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!pages) value = page.value;
    pages++;
    for (const message of page.messages) byId.set(String(message.id), message);
    cursor = page.next || null;
    if (!cursor) { complete = true; break; }
    if (page.messages.some(message => knownIds.has(String(message.id)))) {
      // Only what is older than this page: a message removed in CTP since the
      // last read must not come back from the previous copy.
      const oldest = page.messages.reduce((a, b) => older(a, b) <= 0 ? a : b);
      for (const message of known.messages) if (older(message, oldest) < 0) byId.set(String(message.id), message);
      complete = Boolean(known.complete);
      break;
    }
    if (pages >= maxPages) break;
  }
  return { value, messages: [...byId.values()].sort(older), complete };
}
