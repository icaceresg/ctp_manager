import { HttpError } from './auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function text(value, { field, max = 20000, required = false } = {}) {
  const s = value === undefined || value === null ? '' : String(value);
  if (required && !s.trim()) throw new HttpError(400, `${field} no puede estar vacío.`);
  if (s.length > max) throw new HttpError(400, `${field} es demasiado largo (máx. ${max} caracteres).`);
  return required ? s.trim() : s;
}

export function date(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  // Parse in UTC and round-trip every component: Date otherwise accepts and
  // normalizes impossible calendar days (for example 30 February).
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new HttpError(400, 'Fecha no válida.');
  }
  return s;
}

export function time(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (!TIME_RE.test(s)) throw new HttpError(400, 'Hora no válida.');
  return s;
}

export function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador no válido.');
  return n;
}
