import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { LOCALES, PASSES, ROLES } from './model.js';

function Chips({ label, options, value = [], onChange }) {
  const toggle = id => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  return <fieldset className="crm-chips"><legend>{label}</legend>{options.map(([id, title]) => <label key={id} className={value.includes(id) ? 'active' : ''}><input type="checkbox" checked={value.includes(id)} onChange={() => toggle(id)} />{title}</label>)}</fieldset>;
}

/** Filtros de audiencia. Los mismos valores definen segmentos y campañas. */
export function AudienceFilters({ value, onChange, lockConsent = false, compact = false }) {
  const [open, setOpen] = useState(!compact);
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <div className="crm-filters">
    <div className="crm-filters-main">
      <label className="op-field crm-grow"><span>Buscar</span><input value={value.query || ''} maxLength={120} placeholder="Usuario, gamertag o correo" onChange={event => set('query', event.target.value)} /></label>
      <label className="op-field"><span>Correos promocionales</span><select value={lockConsent ? 'opted_in' : value.consent || 'any'} disabled={lockConsent} onChange={event => set('consent', event.target.value)}><option value="any">Todas las personas</option><option value="opted_in">Casilla activada</option><option value="opted_out">Casilla desactivada</option></select></label>
      <label className="op-field"><span>Pases</span><select value={value.pass_scope || 'current'} onChange={event => set('pass_scope', event.target.value)}><option value="current">Club con pase activo ahora</option><option value="ever">Ha estado en un club con pase</option></select></label>
      <button type="button" className="btn sm crm-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Más filtros</button>
    </div>
    <Chips label="Tipo de pase del club" options={Object.entries(PASSES)} value={value.pass_kinds} onChange={next => set('pass_kinds', next)} />
    {open && <>
      <div className="op-form-grid crm-grid-4">
        <label className="op-field"><span>Equipo</span><select value={value.team || 'any'} onChange={event => set('team', event.target.value)}><option value="any">Indiferente</option><option value="with">En un equipo ahora</option><option value="without">Sin equipo</option></select></label>
        <label className="op-field"><span>Torneos</span><select value={value.tournament || 'any'} onChange={event => set('tournament', event.target.value)}><option value="any">Indiferente</option><option value="played">Ha jugado algún torneo</option><option value="never">Nunca ha jugado</option></select></label>
        <label className="op-field"><span>Registro desde</span><input type="date" value={value.created_from || ''} onChange={event => set('created_from', event.target.value)} /></label>
        <label className="op-field"><span>Registro hasta</span><input type="date" value={value.created_to || ''} onChange={event => set('created_to', event.target.value)} /></label>
      </div>
      <Chips label="Idioma de la cuenta" options={LOCALES} value={value.locales} onChange={next => set('locales', next)} />
      <Chips label="Rol en CTP" options={Object.entries(ROLES)} value={value.roles} onChange={next => set('roles', next)} />
      {!lockConsent && <label className="op-check"><input type="checkbox" checked={Boolean(value.email_confirmed)} onChange={event => set('email_confirmed', event.target.checked)} />Solo correos confirmados</label>}
    </>}
    {lockConsent && <p className="muted crm-hint">Las campañas se envían solo a quien tiene activada la casilla de correos promocionales y el correo confirmado. CTP lo vuelve a comprobar justo antes de cada envío.</p>}
  </div>;
}
