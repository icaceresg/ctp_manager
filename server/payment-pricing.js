const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = Object.freeze(['circuit_pass', 'season_pass', 'ticket_inaugural', 'ticket_cup', 'ticket_major', 'ticket_finals']);
const fields = ['amount_cents', 'management_fee_cents'];
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const season = value => Number.isSafeInteger(value) && value >= 1 && value <= 4;
const amount = (value, field) => Number.isSafeInteger(value) && value >= (field === 'amount_cents' ? 1 : 0)
  && value <= (field === 'amount_cents' ? 10000000 : 2000);

export function paymentPricingPayload(value, fail) {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).some(key => !['products', 'tournaments', 'seasons'].includes(key))) fail();
  const result = {};
  for (const [scope, rows] of Object.entries(value)) {
    if (!Array.isArray(rows) || !rows.length || rows.length > (scope === 'products' ? 6 : scope === 'seasons' ? 4 : 100)) fail();
    const idKey = scope === 'products' ? 'key' : scope === 'tournaments' ? 'tournament_id' : 'season';
    const seen = new Set();
    result[scope] = rows.map(row => {
      if (!object(row) || Object.keys(row).length < 2 || Object.keys(row).some(key => ![idKey, ...fields].includes(key))) fail();
      const id = row[idKey];
      if (!(scope === 'products' ? keys.includes(id) : scope === 'tournaments' ? uuid(id) : season(id))) fail();
      const identity = typeof id === 'string' ? id.toLowerCase() : id;
      if (seen.has(identity)) fail();
      seen.add(identity);
      for (const field of fields) if (field in row && !(scope !== 'products' && row[field] === null) && !amount(row[field], field)) fail();
      return { ...row, [idKey]: identity };
    });
  }
  return result;
}

/** Old bridges omit pricing. A malformed published catalogue must never become zero euros. */
export function paymentPricingResponse(value, fail) {
  if (value === undefined) return null;
  if (!object(value) || !['products', 'tournaments', 'seasons'].every(key => Array.isArray(value[key]))) fail();
  const result = { products: [], tournaments: [], seasons: [] };
  for (const [scope, rows] of Object.entries(result)) {
    const idKey = scope === 'products' ? 'key' : scope === 'tournaments' ? 'tournament_id' : 'season';
    const seen = new Set();
    if (value[scope].length > (scope === 'products' ? 6 : scope === 'seasons' ? 4 : 10000)) fail();
    for (const row of value[scope]) {
      if (!object(row)) fail();
      const id = row[idKey];
      if (!(scope === 'products' ? keys.includes(id) : scope === 'tournaments' ? uuid(id) : season(id))) fail();
      const identity = typeof id === 'string' ? id.toLowerCase() : id;
      if (seen.has(identity)) fail();
      seen.add(identity);
      if (!fields.every(field => field in row && (scope !== 'products' && row[field] === null || amount(row[field], field)))) fail();
      if (scope === 'products' && (row.currency !== 'eur' || typeof row.active !== 'boolean')) fail();
      if (scope === 'seasons' && typeof row.on_sale !== 'boolean') fail();
      rows.push({ [idKey]: identity, amount_cents: row.amount_cents, management_fee_cents: row.management_fee_cents,
        ...(scope === 'products' ? { currency: row.currency, active: row.active } : scope === 'seasons' ? { on_sale: row.on_sale } : {}) });
    }
  }
  if (!keys.every(key => result.products.some(row => row.key === key))) fail();
  return result;
}
