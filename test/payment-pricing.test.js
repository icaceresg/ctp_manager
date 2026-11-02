import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webPublicationPayload, webPublicationResponse } from '../server/web-publication-client.js';
import { EMPTY_DRAFT, draftChanges, pendingCount } from '../client/src/pages/webPublicationModel.js';
import { PRICE_KEYS, effectivePrice, invalidPricingInputs, parseMoney, rawPrice, setPrice, setPriceInput, tournamentPriceKey } from '../client/src/pages/paymentPricingModel.js';

const T = '34400000-0000-4000-8000-000000000001';
const R = '34400000-0000-4000-8000-000000000002';
const prices = [50000, 10000, 1000, 2500, 5000, 20000];
const snapshot = { schema_version: 1, revision: 4, sections: { calendar: false, market: false },
  tournaments: [{ id: T, name: 'Club tournament', kind: 'cup', circuit_code: 'cup-1', season: 1 }], clubs: [],
  tax: { spain_rate_bps: 2100, eu_rates: [] },
  pricing: { products: PRICE_KEYS.map((key, i) => ({ key, amount_cents: prices[i], management_fee_cents: 100, currency: 'eur', active: true })),
    tournaments: [], seasons: [1, 2, 3, 4].map(season => ({ season, amount_cents: null, management_fee_cents: null, on_sale: season === 1 })) } };
const request = pricing => ({ action: 'configure', expected_version: 4, request_id: R, reason: 'Ajustar precios y gastos por producto', changes: { pricing } });

test('money accepts exact cents and rejects empty, rounding, exponent, negative and excessive amounts', () => {
  for (const [text, amount] of [['0,01', 1], ['25', 2500], [' 10.90 ', 1090], ['100000.00', 10000000]]) assert.equal(parseMoney(text), amount, text);
  for (const text of ['', ' ', '0', '-1', '1e2', '1.001', '1,000', '1.000,25', '100000.01', 'Infinity', '€25', '1.', '9'.repeat(30)]) assert.equal(parseMoney(text), null, text);
  assert.equal(parseMoney('0', 'management_fee_cents'), 0);
  assert.equal(parseMoney('20.00', 'management_fee_cents'), 2000);
  assert.equal(parseMoney('20.01', 'management_fee_cents'), null);
});

test('tournament and season overrides inherit each field independently and preserve explicit zero fees', () => {
  const inherited = (draft, field) => effectivePrice(draft, snapshot, 'tournaments', T, field, 'ticket_cup');
  assert.equal(inherited(EMPTY_DRAFT, 'amount_cents'), 2500);
  let draft = setPrice(EMPTY_DRAFT, snapshot, 'products', 'ticket_cup', 'amount_cents', 3000);
  assert.equal(inherited(draft, 'amount_cents'), 3000, 'draft defaults update inherited totals');
  draft = setPrice(draft, snapshot, 'tournaments', T, 'management_fee_cents', 0);
  assert.equal(inherited(draft, 'amount_cents'), 3000);
  assert.equal(inherited(draft, 'management_fee_cents'), 0, 'zero does not fall back to 100');
  draft = setPrice(draft, snapshot, 'tournaments', T, 'amount_cents', 3500);
  assert.equal(inherited(draft, 'amount_cents'), 3500);
  draft = setPrice(draft, snapshot, 'seasons', 1, 'amount_cents', 12000);
  assert.equal(effectivePrice(draft, snapshot, 'seasons', 1, 'amount_cents', 'season_pass'), 12000);
  assert.equal(effectivePrice(draft, snapshot, 'seasons', 2, 'amount_cents', 'season_pass'), 10000);
  assert.deepEqual(draftChanges(draft).pricing, {
    products: [{ key: 'ticket_cup', amount_cents: 3000 }],
    tournaments: [{ tournament_id: T, management_fee_cents: 0, amount_cents: 3500 }],
    seasons: [{ season: 1, amount_cents: 12000 }],
  });
  draft = setPrice(draft, snapshot, 'tournaments', T, 'amount_cents', null);
  assert.equal(inherited(draft, 'amount_cents'), 3000);
  assert.equal(rawPrice(draft, snapshot, 'tournaments', T, 'management_fee_cents'), 0);
  assert.equal(tournamentPriceKey({ kind: 'major', circuit_code: 'inaugural' }), 'ticket_inaugural');
  assert.equal(tournamentPriceKey({ kind: 'cup', circuit_code: 'finals' }), 'ticket_finals');
  assert.equal(tournamentPriceKey({ kind: 'major' }), 'ticket_major');
  assert.equal(tournamentPriceKey({ kind: 'personalizado' }), 'ticket_cup');
});

test('resetting an existing override sends null; reverting or discarding removes pending changes', () => {
  const published = { ...snapshot, pricing: { ...snapshot.pricing,
    tournaments: [{ tournament_id: T, amount_cents: 4500, management_fee_cents: 200 }] } };
  let draft = setPrice(EMPTY_DRAFT, published, 'tournaments', T, 'management_fee_cents', null);
  assert.deepEqual(draftChanges(draft).pricing.tournaments, [{ tournament_id: T, management_fee_cents: null }]);
  assert.equal(effectivePrice(draft, published, 'tournaments', T, 'amount_cents', 'ticket_cup'), 4500);
  assert.equal(effectivePrice(draft, published, 'tournaments', T, 'management_fee_cents', 'ticket_cup'), 100);
  draft = setPrice(draft, published, 'tournaments', T, 'management_fee_cents', 200);
  assert.equal(pendingCount(draft), 0);
  assert.equal(draftChanges(draft), null);
  assert.equal(draftChanges(EMPTY_DRAFT), null);
});

test('invalid input remains in the draft, blocks publishing, and never shows a stale total', () => {
  let draft = setPriceInput(EMPTY_DRAFT, snapshot, 'products', 'ticket_cup', 'amount_cents', '27.50');
  assert.equal(effectivePrice(draft, snapshot, 'products', 'ticket_cup', 'amount_cents'), 2750);
  draft = setPriceInput(draft, snapshot, 'products', 'ticket_cup', 'amount_cents', '27.501');
  assert.equal(invalidPricingInputs(draft).length, 1);
  assert.equal(draft.pricingInputs['products:ticket_cup:amount_cents'], '27.501');
  assert.equal(effectivePrice(draft, snapshot, 'products', 'ticket_cup', 'amount_cents'), null);
  assert.equal(effectivePrice(draft, snapshot, 'tournaments', T, 'amount_cents', 'ticket_cup'), null);
  assert.ok(pendingCount(draft) > 0);
  draft = setPriceInput(draft, snapshot, 'products', 'ticket_cup', 'amount_cents', '25');
  assert.equal(invalidPricingInputs(draft).length, 0);
  assert.equal(pendingCount(draft), 0);
  draft = setPriceInput(draft, snapshot, 'tournaments', T, 'management_fee_cents', '');
  assert.equal(invalidPricingInputs(draft).length, 1);
  draft = setPrice(draft, snapshot, 'tournaments', T, 'management_fee_cents', null);
  assert.equal(invalidPricingInputs(draft).length, 0);
  assert.equal(pendingCount(draft), 0);
});

test('publication accepts pricing-only updates and null resets, refusing unsafe or duplicate entries', () => {
  const changes = { products: [{ key: 'circuit_pass', amount_cents: 55000, management_fee_cents: 0 }],
    tournaments: [{ tournament_id: T.toUpperCase(), amount_cents: null, management_fee_cents: 200 }],
    seasons: [{ season: 2, amount_cents: 15000, management_fee_cents: null }] };
  assert.equal(webPublicationPayload(request(changes)).changes.pricing.tournaments[0].tournament_id, T);
  assert.equal(webPublicationPayload(request(changes)).changes.pricing.products[0].management_fee_cents, 0);
  for (const pricing of [{}, { sql: [] }, { products: [] }, { seasons: [{ season: 0, amount_cents: 100 }] },
    { seasons: [{ season: 5, amount_cents: 100 }] }, { products: [{ key: 'team_pass_early', amount_cents: 100 }] },
    { products: [{ key: 'season_pass', amount_cents: 0 }] }, { products: [{ key: 'season_pass', amount_cents: null }] },
    { products: [{ key: 'season_pass', amount_cents: 100.5 }] }, { products: [{ key: 'season_pass', amount_cents: '100' }] },
    { products: [{ key: 'season_pass', amount_cents: 10000001 }] }, { products: [{ key: 'season_pass', management_fee_cents: 2001 }] },
    { products: [{ key: 'season_pass', management_fee_cents: -1 }] }, { products: [{ key: 'season_pass', active: false }] },
    { products: [{ key: 'season_pass' }] }, { products: [{ key: 'season_pass', amount_cents: 100 }, { key: 'season_pass', amount_cents: 200 }] },
    { tournaments: [{ tournament_id: 'invalid', amount_cents: 100 }] },
    { tournaments: [{ tournament_id: T, amount_cents: 100 }, { tournament_id: T.toUpperCase(), amount_cents: 200 }] }]) {
    assert.throws(() => webPublicationPayload(request(pricing)), { status: 400 }, JSON.stringify(pricing));
  }
  assert.throws(() => webPublicationPayload({ ...request(changes), changes: { tax: { management_fee_cents: 100 } } }), { status: 400 });
  assert.throws(() => webPublicationPayload({ ...request(changes), changes: { tax: { management_fee_active: true } } }), { status: 400 });
});

test('published pricing is strictly validated and never coerced into a free product', () => {
  assert.deepEqual(webPublicationResponse(snapshot).pricing, snapshot.pricing);
  assert.equal(webPublicationResponse({ ...snapshot, pricing: undefined }).pricing, null, 'old bridges expose no editable catalogue');
  for (const pricing of [null, {}, { ...snapshot.pricing, products: [] },
    { ...snapshot.pricing, products: [...snapshot.pricing.products, snapshot.pricing.products[0]] },
    ...['NaN', -1, null, 1.5, 10000001].map(amount_cents => ({ ...snapshot.pricing,
      products: snapshot.pricing.products.map((row, i) => i ? row : { ...row, amount_cents }) })),
    { ...snapshot.pricing, seasons: [{ season: 1, amount_cents: null, management_fee_cents: null }] },
    { ...snapshot.pricing, tournaments: [{ tournament_id: T, amount_cents: null, management_fee_cents: '0' }] }]) {
    assert.throws(() => webPublicationResponse({ ...snapshot, pricing }), { status: 502 });
  }
});

test('new pricing messages have identical keys and interpolation values in all six languages', () => {
  const catalogues = ['es', 'en', 'it', 'fr', 'pt', 'de'].map(locale => JSON.parse(readFileSync(new URL(`../client/src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')));
  const base = catalogues[0];
  for (const catalogue of catalogues) {
    assert.deepEqual(Object.keys(catalogue).sort(), Object.keys(base).sort());
    for (const [key, value] of Object.entries(catalogue)) {
      assert.ok(value.trim(), key);
      assert.deepEqual(value.match(/\{\w+\}/g)?.sort(), base[key].match(/\{\w+\}/g)?.sort(), key);
    }
  }
});
