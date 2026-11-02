import { getIntlLocale, translate } from '../i18n/runtime.js';
import {
  PRICE_FIELDS, PRICE_KEYS, effectivePrice, moneyInput, parseMoney, priceInputKey, rawPrice,
  setPrice, setPriceInput, tournamentPriceKey,
} from './paymentPricingModel.js';

const money = cents => Number.isSafeInteger(cents)
  ? new Intl.NumberFormat(getIntlLocale(), { style: 'currency', currency: 'EUR' }).format(cents / 100) : '—';
const fieldLabel = field => translate(field === 'amount_cents' ? 'manager.pricing.price' : 'manager.pricing.fee');

function MoneyField({ snapshot, draft, setDraft, scope, id, field, name, inheritedKey }) {
  const inputId = priceInputKey(scope, id, field);
  const stored = rawPrice(draft, snapshot, scope, id, field);
  const current = effectivePrice(draft, snapshot, scope, id, field, inheritedKey);
  const explicitText = draft.pricingInputs?.[inputId];
  const text = explicitText ?? (Number.isSafeInteger(current) ? moneyInput(current) : '');
  const invalid = parseMoney(text, field) === null;
  const inherited = scope !== 'products' && stored === null;
  const fallback = inheritedKey ? effectivePrice(draft, snapshot, 'products', inheritedKey, field) : null;
  return <div className="wp-money-field">
    <input id={inputId} type="text" className="wp-money-input" inputMode="decimal" maxLength={20}
      aria-label={translate(field === 'amount_cents' ? 'manager.pricing.priceLabel' : 'manager.pricing.feeLabel', { name })}
      aria-invalid={invalid} aria-describedby={`${inputId}-hint`} value={text}
      onChange={event => setDraft(value => setPriceInput(value, snapshot, scope, id, field, event.target.value))} />
    <small id={`${inputId}-hint`} className={invalid ? 'wp-warn' : 'wp-sub'}>
      {invalid ? translate(field === 'amount_cents' ? 'manager.pricing.invalidPrice' : 'manager.pricing.invalidFee')
        : inherited ? translate('manager.pricing.inherited', { amount: money(fallback) })
          : scope !== 'products' ? translate('manager.pricing.custom') : null}
    </small>
    {scope !== 'products' && <button type="button" className="btn ghost sm" disabled={inherited && explicitText === undefined}
      aria-label={translate('manager.pricing.resetLabel', { name, field: fieldLabel(field) })}
      onClick={() => setDraft(value => setPrice(value, snapshot, scope, id, field, null))}>
      {translate('manager.pricing.useDefault')}
    </button>}
  </div>;
}

function PriceTable({ title, hint, scope, rows, snapshot, draft, setDraft, empty }) {
  return <section className="op-card" aria-labelledby={`wp-pricing-${scope}`}>
    <div className="op-section-title"><div><h2 id={`wp-pricing-${scope}`}>{title}</h2><p>{hint}</p></div></div>
    {!rows.length ? <p className="muted">{empty}</p> : <div className="table-card"><table className="data-table wp-pricing-table">
      <thead><tr><th>{translate(scope === 'tournaments' ? 'manager.pricing.tournament' : 'manager.pricing.product')}</th>
        <th>{translate('manager.pricing.price')}</th><th>{translate('manager.pricing.fee')}</th><th>{translate('manager.pricing.total')}</th></tr></thead>
      <tbody>{rows.map(({ id, name, inheritedKey, active }) => {
        const amount = effectivePrice(draft, snapshot, scope, id, 'amount_cents', inheritedKey);
        const fee = effectivePrice(draft, snapshot, scope, id, 'management_fee_cents', inheritedKey);
        const changed = !!draft.pricing?.[scope]?.[id];
        return <tr key={id} className={changed ? 'wp-row-changed' : ''}>
          <td><strong>{name}</strong>{typeof active === 'boolean' && <small className="wp-sub">{translate(active ? 'manager.pricing.onSale' : 'manager.pricing.notOnSale')}</small>}</td>
          {PRICE_FIELDS.map(field => <td key={field}><MoneyField {...{ snapshot, draft, setDraft, scope, id, field, name, inheritedKey }} /></td>)}
          <td className="wp-price-total">{money(Number.isSafeInteger(amount) && Number.isSafeInteger(fee) ? amount + fee : null)}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}

export default function PaymentPricingEditor({ snapshot, draft, setDraft, disabled = false }) {
  if (!snapshot.pricing) return <p className="op-error" role="status">{translate('manager.pricing.unavailable')}</p>;
  const products = PRICE_KEYS.map(key => snapshot.pricing.products.find(row => row.key === key)).filter(Boolean)
    .map(row => ({ id: row.key, name: translate(`manager.pricing.${row.key}`), active: row.active }));
  const tournaments = snapshot.tournaments.map(row => ({ id: row.id, name: row.name, inheritedKey: tournamentPriceKey(row) }));
  const seasons = snapshot.pricing.seasons.map(row => ({ id: row.season,
    name: translate('manager.pricing.season', { season: new Intl.NumberFormat(getIntlLocale()).format(row.season) }),
    inheritedKey: 'season_pass', active: row.on_sale }));
  return <fieldset className="wp-pricing-editor stack" disabled={disabled}>
    <legend className="sr-only">{translate('manager.pricing.tab')}</legend>
    <p className="muted">{translate('manager.pricing.description')}</p>
    <PriceTable {...{ snapshot, draft, setDraft }} scope="products" rows={products}
      title={translate('manager.pricing.defaultsTitle')} hint={translate('manager.pricing.defaultsHint')} />
    <PriceTable {...{ snapshot, draft, setDraft }} scope="seasons" rows={seasons}
      title={translate('manager.pricing.seasonsTitle')} hint={translate('manager.pricing.seasonsHint')} empty={translate('manager.pricing.noSeasons')} />
    <PriceTable {...{ snapshot, draft, setDraft }} scope="tournaments" rows={tournaments}
      title={translate('manager.pricing.tournamentsTitle')} hint={translate('manager.pricing.tournamentsHint')} empty={translate('manager.pricing.noTournaments')} />
  </fieldset>;
}
