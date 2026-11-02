import { getIntlLocale } from '../i18n/runtime.js';

export const PRICE_KEYS = Object.freeze(['circuit_pass', 'season_pass', 'ticket_inaugural', 'ticket_cup', 'ticket_major', 'ticket_finals']);
export const PRICE_FIELDS = Object.freeze(['amount_cents', 'management_fee_cents']);
export const EMPTY_PRICING = Object.freeze({ products: {}, tournaments: {}, seasons: {} });

/** Parse decimal money without rounding, exponent notation, or implicit zero. */
export function parseMoney(text, field = 'amount_cents') {
  const value = String(text).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  const minimum = field === 'management_fee_cents' ? 0 : 1;
  const maximum = field === 'management_fee_cents' ? 2000 : 10000000;
  return Number.isSafeInteger(cents) && cents >= minimum && cents <= maximum ? cents : null;
}

export const moneyInput = cents => new Intl.NumberFormat(getIntlLocale(), {
  useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(cents / 100);
const identity = (scope, row) => scope === 'products' ? row.key : scope === 'tournaments' ? row.tournament_id : String(row.season);
const inputKey = (scope, id, field) => `${scope}:${id}:${field}`;
export const priceInputKey = inputKey;
export function publishedPricing(snapshot, scope, id) {
  return snapshot.pricing?.[scope]?.find(row => identity(scope, row) === String(id)) ?? {};
}
export function rawPrice(draft, snapshot, scope, id, field) {
  const changes = draft.pricing?.[scope]?.[id];
  if (changes && field in changes) return changes[field];
  return publishedPricing(snapshot, scope, id)[field] ?? null;
}
export function tournamentPriceKey(tournament) {
  if (tournament.circuit_code === 'inaugural') return 'ticket_inaugural';
  if (tournament.circuit_code === 'finals') return 'ticket_finals';
  return tournament.kind === 'major' ? 'ticket_major' : 'ticket_cup';
}
export function effectivePrice(draft, snapshot, scope, id, field, inheritedKey) {
  const text = draft.pricingInputs?.[inputKey(scope, id, field)];
  if (text !== undefined && parseMoney(text, field) === null) return null;
  const value = rawPrice(draft, snapshot, scope, id, field);
  return value ?? (inheritedKey ? effectivePrice(draft, snapshot, 'products', inheritedKey, field) : null);
}
export function setPrice(draft, snapshot, scope, id, field, value) {
  const pricing = draft.pricing ?? EMPTY_PRICING;
  const current = { ...(pricing[scope][id] ?? {}), [field]: value };
  const base = publishedPricing(snapshot, scope, id);
  for (const key of Object.keys(current)) if (current[key] === (base[key] ?? null)) delete current[key];
  const rows = { ...pricing[scope] };
  if (Object.keys(current).length) rows[id] = current; else delete rows[id];
  const pricingInputs = { ...draft.pricingInputs };
  delete pricingInputs[inputKey(scope, id, field)];
  return { ...draft, pricing: { ...pricing, [scope]: rows }, pricingInputs };
}
export function setPriceInput(draft, snapshot, scope, id, field, text) {
  const parsed = parseMoney(text, field);
  const next = parsed === null ? draft : setPrice(draft, snapshot, scope, id, field, parsed);
  return { ...next, pricingInputs: { ...next.pricingInputs, [inputKey(scope, id, field)]: text } };
}
export function invalidPricingInputs(draft) {
  return Object.entries(draft.pricingInputs ?? {}).filter(([key, text]) => parseMoney(text, key.split(':').at(-1)) === null);
}
export function pricingPendingCount(draft) {
  return Object.values(draft.pricing ?? EMPTY_PRICING).reduce((sum, rows) => sum + Object.keys(rows).length, 0)
    + invalidPricingInputs(draft).length;
}
export function pricingChanges(draft) {
  const changes = {};
  for (const [scope, rows] of Object.entries(draft.pricing ?? EMPTY_PRICING)) {
    const field = scope === 'products' ? 'key' : scope === 'tournaments' ? 'tournament_id' : 'season';
    const items = Object.entries(rows).map(([id, change]) => ({ [field]: scope === 'seasons' ? Number(id) : id, ...change }));
    if (items.length) changes[scope] = items;
  }
  return Object.keys(changes).length ? changes : null;
}
