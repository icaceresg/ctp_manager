import { HttpError } from './auth.js';

export const PRO_VIEW_ACTION = 'pro_view.configure';
export const PRO_VIEW_RESOURCE_ID = '00000000-0000-4000-8000-000000000001';
export const PRO_VIEW_MAX_DELAY = 900;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const statuses = ['standby', 'live', 'paused', 'ended'];
const keys = ['channel', 'delaySeconds', 'productionDelaySeconds', 'matchId', 'roomId', 'enabled', 'status'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const label = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : '';
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** The editor accepts configuration only, never an arbitrary URL or live score. */
export function proViewSettings(value) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new HttpError(400, 'La configuración de Pro View no es válida.');
  if (typeof value.channel !== 'string' || !/^[a-zA-Z0-9_]{3,25}$/.test(value.channel)) throw new HttpError(400, 'Indica el nombre del canal de Twitch, sin enlaces ni @.');
  if (![value.delaySeconds, value.productionDelaySeconds].every(number => integer(number) && number <= PRO_VIEW_MAX_DELAY) || value.productionDelaySeconds > value.delaySeconds) throw new HttpError(400, 'El retraso total debe estar entre 0 y 900 segundos y no ser menor que el de producción.');
  if ((value.matchId !== null && !uuid(value.matchId)) || (value.roomId !== null && !uuid(value.roomId)) || value.roomId !== null && value.matchId === null) throw new HttpError(400, 'Selecciona un partido y una sala válidos.');
  if (typeof value.enabled !== 'boolean' || !statuses.includes(value.status) || value.status === 'live' && (!value.enabled || !value.matchId)) throw new HttpError(400, 'Para publicar Pro View debes habilitarlo y seleccionar un partido.');
  return { channel: value.channel.toLowerCase(), delaySeconds: value.delaySeconds, productionDelaySeconds: value.productionDelaySeconds, matchId: value.matchId, roomId: value.roomId, enabled: value.enabled, status: value.status };
}

/** Closed private projection: do not forward room capabilities, provider tokens or raw snapshots. */
export function proViewState(value) {
  try {
    if (!object(value) || !integer(value.revision) || !Array.isArray(value.matches) || value.matches.length > 100 || !Array.isArray(value.rooms) || value.rooms.length > 100) throw new Error('state');
    const settings = proViewSettings(Object.fromEntries(keys.map(key => [key, value[key]])));
    const matches = value.matches.map(item => {
      if (!object(item) || !uuid(item.id)) throw new Error('match');
      return { id: item.id, title: label(item.title || item.label), scheduledAt: timestamp(item.scheduledAt) ? item.scheduledAt : null, status: label(item.status, 40) };
    });
    const rooms = value.rooms.map(item => {
      if (!object(item) || !uuid(item.id) || !uuid(item.matchId)) throw new Error('room');
      return { id: item.id, matchId: item.matchId, label: label(item.label), expiresAt: timestamp(item.expiresAt) ? item.expiresAt : null, status: label(item.status, 40) };
    });
    const preview = value.publicPreview;
    if (preview != null && (!object(preview) || !integer(preview.revision) || !timestamp(preview.sourceAt) || !timestamp(preview.visibleAt))) throw new Error('preview');
    return { revision: value.revision, ...settings, matches, rooms, lastErrorCode: typeof value.lastErrorCode === 'string' ? label(value.lastErrorCode, 80) : null,
      publicPreview: preview ? { revision: preview.revision, sourceAt: preview.sourceAt, visibleAt: preview.visibleAt } : null };
  } catch { throw new HttpError(502, 'CTP ha devuelto un estado de Pro View incompleto. No se ha aplicado ningún cambio.'); }
}

export function validateProViewProposal(input, state) {
  if (!object(input) || Object.keys(input).some(key => !['expected_version', 'payload'].includes(key)) || !integer(input.expected_version)) throw new HttpError(400, 'La propuesta de Pro View no es válida.');
  if (input.expected_version !== state.revision) throw new HttpError(409, 'Otra persona ha actualizado Pro View. Recarga antes de publicar.');
  const settings = proViewSettings(input.payload);
  // The active selection can fall outside today's candidates. It remains usable
  // until deliberately replaced; newly selected references must be returned by CTP.
  if (settings.matchId !== null && settings.matchId !== state.matchId && !state.matches.some(item => item.id === settings.matchId)) throw new HttpError(400, 'El partido no está disponible para la emisión. Actualiza la lista.');
  if (settings.roomId !== null && !state.rooms.some(item => item.id === settings.roomId && item.matchId === settings.matchId && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))) throw new HttpError(400, 'La sala no pertenece al partido o ha caducado.');
  return settings;
}
