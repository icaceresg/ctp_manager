import { getIntlLocale, translate } from '../i18n/runtime.js';

const timeZone = 'Europe/Madrid';
const inputFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function competitionDateInput(value) {
  const date = new Date(value ?? NaN);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(inputFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function competitionDateTime(value) {
  const date = new Date(value ?? NaN);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(getIntlLocale(), { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : '—';
}

export function competitionDateToIso(input, originalIso) {
  if (originalIso && competitionDateInput(originalIso) === input) return originalIso;
  const wall = Date.parse(`${input}:00Z`);
  if (Number.isFinite(wall)) {
    // Sample the offsets on either side to handle Madrid's clock changes.
    const day = 86_400_000;
    const candidates = [wall - day, wall + day].map(instant =>
      wall - (Date.parse(`${competitionDateInput(instant)}:00Z`) - instant));
    const candidate = candidates.sort((a, b) => a - b).find(instant => competitionDateInput(instant) === input);
    if (candidate !== undefined) return new Date(candidate).toISOString();
  }
  throw new Error(translate('manager.tournament.invalidDate'));
}
