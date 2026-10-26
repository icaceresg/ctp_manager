// Spanish names for Ranked values that CTP sends as ids.
export const RANKED_DIVISIONS = Object.freeze({
  bronze: 'Bronce', silver: 'Plata', gold: 'Oro', platinum: 'Platino',
  diamond: 'Diamante', crimson: 'Carmesí', iridescent: 'Iridiscente',
});
export const divisionLabel = id => RANKED_DIVISIONS[id] || id;

/** 'snd' for Search & Destroy (BYD), 'hp' for Hardpoint, null when unknown. */
export function rankedModeKey(mode) {
  if (typeof mode !== 'string') return null;
  if (/search|s\s*&\s*d|byd|buscar/i.test(mode)) return 'snd';
  if (/hard\s*point|punto caliente/i.test(mode)) return 'hp';
  return null;
}
export function rankedModeLabel(mode) {
  const key = rankedModeKey(mode);
  return key === 'snd' ? 'BYD' : key === 'hp' ? 'Punto caliente' : mode || null;
}

/** Reasons a player can pick when reporting another player of the match (CTP 239). */
export const REPORT_REASONS = Object.freeze({
  cheating: 'Trampas o hacks', toxicity: 'Insultos o comportamiento tóxico', griefing: 'Antijuego', afk: 'Abandono o AFK',
  banned_loadout: 'Armas o equipo prohibidos', exploit: 'Bugs o exploits', account: 'Cuenta falsa o compartida', other: 'Otro motivo',
});
export const reportReasonLabel = id => REPORT_REASONS[id] || 'Otro motivo';

export const BAN_DURATIONS = Object.freeze([
  [15, '15 minutos'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [360, '6 horas'],
  [720, '12 horas'], [1440, '1 día'], [4320, '3 días'], [10080, '7 días'],
]);
