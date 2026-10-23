import { HttpError, describeUser } from './auth.js';
import { db } from './db.js';
import { signManagerRequest } from './bridge-signature.js';
import { MANAGER_PUBLIC_ORIGINS } from './config.js';
import { COMPETITION_ACTIONS, competitionPayload, correctionPayload } from './competition-contract.js';
import { GUARD_ACTIONS, guardPayload, guardState, guardId } from './guard-contract.js';
import { RANKED_ACTIONS, rankedPayload, rankedState } from './ranked-contract.js';
import { rankedMonitorState } from './ranked-monitor-contract.js';
import { CLUB_ACTIONS, manualClubPayload } from './manual-club-contract.js';
import { ADMIN_ACTIONS, administrationPayload, administrationQuery } from './administration-contract.js';
import { CASE_ACTIONS,casePayload,caseQueryParameters } from './case-contract.js';
import { PRO_VIEW_ACTION, proViewSettings, proViewState } from './pro-view-contract.js';
import { canManageStaff } from '../shared/access.js';
import { staffDirectoryQuery, staffAccessPayload, staffDirectoryResponse, staffAccessResponse } from './staff-access-contract.js';
import { CRM_ERRORS, crmIsRead } from './crm-contract.js';
import { collectRegisteredPlayers } from './ruleta-contract.js';
import {
  ingestSnapshot, getIntegrationStatus, setIntegrationStatus,
  getCommand, markCommandSending, acknowledgeCommand, failCommand,
  incidentDetail,
  matchDossier,
  getOperatorIdentity,
  rememberCompetitionData,
  rememberGuardState,
  rememberRankedState,
  rememberAdministrationData,
  rememberCaseData,
  rememberProViewState,
} from './operations.js';

const ACTION_SECTIONS = Object.freeze({
  [PRO_VIEW_ACTION]: 'realizacion',
  ...Object.fromEntries(CASE_ACTIONS.map(type => [type,'arbitraje'])),
  ...Object.fromEntries(ADMIN_ACTIONS.map(type => [type, '__admin__'])),
  ...Object.fromEntries(COMPETITION_ACTIONS.map((type) => [type, 'operaciones'])),
  ...Object.fromEntries(GUARD_ACTIONS.map(type=>[type,'arbitraje'])),
  ...Object.fromEntries(RANKED_ACTIONS.map(type=>[type,'operaciones'])),
  ...Object.fromEntries(CLUB_ACTIONS.map(type=>[type,'clubes'])),
  'incident.resolve': 'arbitraje',
  'incident.reply': 'arbitraje',
  'stats.review': 'arbitraje',
  'club.verify': 'clubes',
  'discord.retry': 'comunicaciones',
  'sanction.create': 'arbitraje',
  'sanction.revoke': 'arbitraje',
  'sanction.appeal': 'arbitraje',
  'sanction.review': 'arbitraje',
  'stats.correct': 'arbitraje',
  'match.resolve': 'arbitraje', 'match.revert': 'arbitraje',
  'veto.prepare': 'arbitraje', 'veto.reset': 'arbitraje', 'veto.start': 'arbitraje', 'veto.staff_gate': 'arbitraje',
});
const ACTIONS = Object.keys(ACTION_SECTIONS);
const MAX_BYTES = 4 * 1024 * 1024;

export function integrationConfig(env = process.env) {
  const raw = env.CTP_OPERATIONS_URL || '';
  const token = env.CTP_OPERATIONS_TOKEN || '';
  if (!raw && !token) return { configured: false, writes: false, url: null, token: null, pollMs: 0 };
  let url;
  try { url = new URL(raw); } catch { throw new Error('CTP_OPERATIONS_URL no es válida.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash || url.search) {
    throw new Error('CTP_OPERATIONS_URL requiere HTTPS y no admite credenciales ni parámetros.');
  }
  if (token.length < 32 || /\s/.test(token)) throw new Error('CTP_OPERATIONS_TOKEN debe tener al menos 32 caracteres sin espacios.');
  const signingSecret = env.CTP_SIGNING_SECRET || '';
  if (signingSecret.length < 32 || /\s/.test(signingSecret) || signingSecret === token) throw new Error('CTP_SIGNING_SECRET requiere una clave independiente de al menos 32 caracteres sin espacios.');
  const writes = env.CTP_ENABLE_WRITES === 'true';
  if (writes && !MANAGER_PUBLIC_ORIGINS.includes(env.PUBLIC_ORIGIN) && !(loopback && env.CTP_ALLOW_LOCAL_WRITES === 'true')) {
    throw new Error('Las escrituras oficiales requieren PUBLIC_ORIGIN=https://manager.playctp.com o https://pre.manager.playctp.com. Las pruebas locales necesitan un destino loopback y CTP_ALLOW_LOCAL_WRITES=true.');
  }
  const seconds = Number(env.CTP_SYNC_SECONDS || 0);
  if (!Number.isInteger(seconds) || (seconds !== 0 && seconds < 30) || seconds > 86400) throw new Error('CTP_SYNC_SECONDS debe ser 0 o entre 30 y 86400.');
  return { configured: true, writes, localTestMode: loopback && env.CTP_ALLOW_LOCAL_WRITES === 'true', url: url.href, token, signingSecret, pollMs: seconds * 1000 };
}

export function webOrigin(env = process.env) {
  let url;
  try { url = new URL(env.CTP_WEB_ORIGIN || 'https://playctp.com'); } catch { throw new Error('CTP_WEB_ORIGIN debe ser un origen HTTPS válido o HTTP local.'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('CTP_WEB_ORIGIN debe ser un origen HTTPS sin ruta, o HTTP de loopback para QA local.');
  return url.origin;
}

function supportedActions(value) {
  if (Array.isArray(value)) return value.filter((a) => ACTIONS.includes(a));
  if (value && typeof value === 'object') return ACTIONS.filter((a) => value[a] === true);
  return [];
}

function integrationError(status, message) { return new HttpError(status, message); }

// Only these semantic provider codes may become user-facing copy. Never relay
// an upstream message, OAuth response or credentials to the browser.
async function ownerServiceFailure(body, response) {
  if (body.action !== 'admin_service' || !['twitch','crm'].includes(body.service) || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  try {
    const chunks = []; let bytes = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) return null;
      chunks.push(Buffer.from(part.value));
    }
    const error = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body.service === 'crm') {
      const message = typeof error?.crm_error === 'string' && Object.hasOwn(CRM_ERRORS, error.crm_error) ? CRM_ERRORS[error.crm_error] : null;
      return message ? integrationError(response.status === 409 ? 409 : 422, message) : null;
    }
    if (error?.code !== 'provider_error') return null;
    const messages = {
      configPending: 'La conexión de Twitch está pendiente de configurar en el servidor.',
      stateExpired: 'La autorización ha caducado o ya se ha usado. Vuelve a conectar Twitch.',
      wrongChannel: 'Autoriza con la cuenta de Twitch de playctp. La cuenta seleccionada no pertenece al canal.',
      authorizationRejected: 'Twitch no ha confirmado la autorización. Vuelve a conectar el canal.',
      tooManyAttempts: 'Se han realizado demasiados intentos. Espera antes de volver a conectar Twitch.',
      invalidCallback: 'La respuesta de Twitch no es válida. Vuelve a iniciar la conexión.',
    };
    const key = typeof error.provider_error === 'string' && error.provider_error.startsWith('integrations.twitch.') ? error.provider_error.slice('integrations.twitch.'.length) : '';
    return messages[key] ? integrationError(response.status === 409 ? 409 : response.status === 429 ? 429 : response.status >= 500 ? 502 : 400, messages[key]) : null;
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); }
}

/** Bounded JSON transport. Remote bodies and URLs are never used as error messages. */
export function createOperationsTransport(config, fetchImpl = fetch) {
  return async function request(body) {
    if (!config.configured) throw integrationError(503, 'Conexión con CTP sin configurar.');
    let response;
    try {
      const serialized = JSON.stringify(body);
      response = await fetchImpl(config.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(body.action === 'admin_service' ? 25_000 : 10_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, ...signManagerRequest(serialized, config.signingSecret) },
        body: serialized,
      });
      if (!response.ok) {
        const ownerFailure = await ownerServiceFailure(body, response);
        if (ownerFailure) throw ownerFailure;
        await response.body?.cancel().catch(() => {});
        if ([401, 403].includes(response.status)) {
          // An explicit authentication/authorization denial cannot apply the
          // command. A first-attempt denial can therefore be discarded safely;
          // an earlier ambiguous attempt must still retain its command ID.
          const error = integrationError(body.action === 'command' ? 502 : 403, 'CTP ha rechazado las credenciales o los permisos del operador.');
          error.remoteRejected = true;
          throw error;
        }
        if (response.status === 409) throw integrationError(409, 'El estado oficial ha cambiado. Sincroniza y revisa la solicitud.');
        if ([400, 404, 422].includes(response.status)) {
          const error = integrationError(422, 'CTP ha rechazado la solicitud. Revisa el recurso y los datos.');
          error.remoteRejected = [400, 422].includes(response.status);
          throw error;
        }
        throw integrationError(502, 'CTP no está disponible. Puedes volver a intentarlo.');
      }
      if (!/^application\/json\b/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        throw integrationError(502, 'CTP ha devuelto una respuesta no válida.');
      }
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) {
        await response.body?.cancel();
        throw integrationError(502, 'La respuesta de CTP supera el límite permitido.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw integrationError(502, 'CTP ha devuelto una respuesta vacía.');
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw integrationError(502, 'La respuesta de CTP supera el límite permitido.');
        }
        chunks.push(Buffer.from(value));
      }
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw integrationError(502, 'CTP ha devuelto JSON no válido.'); }
      // Candidate lookup is the only bridge action whose RPC returns a JSON
      // array. Keep the object contract for snapshots, queries and commands.
      const validData = body.action === 'club_candidates'
        ? Array.isArray(parsed?.data)
        : parsed?.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data);
      if (!parsed || parsed.ok !== true || !validData) {
        throw integrationError(502, 'CTP no ha confirmado la solicitud.');
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw integrationError(502, 'No se ha podido contactar con CTP. Reintenta cuando vuelva la conexión.');
    }
  };
}

export function officialPayload(type, payload = {}) {
  if (type === PRO_VIEW_ACTION) return proViewSettings(payload);
  if (CASE_ACTIONS.includes(type)) return casePayload(type,payload);
  if (ADMIN_ACTIONS.includes(type)) return administrationPayload(type, payload);
  if (GUARD_ACTIONS.includes(type)) return guardPayload(type,payload);
  if (RANKED_ACTIONS.includes(type)) return rankedPayload(type,payload);
  if (CLUB_ACTIONS.includes(type)) return manualClubPayload(type,payload);
  if (COMPETITION_ACTIONS.includes(type)) return competitionPayload(type, payload);
  if (type === 'stats.correct') return correctionPayload(payload);
  if (type.startsWith('sanction.')) {
    const reason = String(payload.reason || '').trim();
    if (reason.length < 12 || reason.length > 2000) throw integrationError(422, 'La decisión disciplinaria necesita entre 12 y 2000 caracteres.');
    if (type === 'sanction.create') return Object.fromEntries(['incident_id', 'subject_type', 'subject_id', 'restriction', 'scopes', 'starts_at', 'ends_at'].map((key) => [key, payload[key]]).concat([['reason', reason]]));
    if (type === 'sanction.review') return { reason, decision: payload.decision };
    if (['sanction.appeal', 'sanction.revoke'].includes(type)) return { reason };
    throw integrationError(422, 'Acción disciplinaria no admitida.');
  }
  if (type === 'incident.reply') {
    const text = String(payload.text || '').trim();
    if (!text || text.length > 2000) throw integrationError(422, 'La respuesta necesita entre 1 y 2000 caracteres.');
    return { text };
  }
  if (type === 'stats.review') return { approve: payload.decision === 'approve', note: payload.reason || '' };
  if (type === 'club.verify') {
    const note = String(payload.reason || '').trim();
    if (note.length < 12 || note.length > 500) throw integrationError(422, 'La revisión del club necesita un motivo de entre 12 y 500 caracteres.');
    return { approve: payload.decision === 'verify', note };
  }
  if (type === 'incident.resolve') {
    const reason = String(payload.resolution || payload.reason || '').trim();
    if (reason.length < 8 || reason.length > 2000) throw integrationError(422, 'La resolución necesita un motivo de entre 8 y 2000 caracteres.');
    const result = { reason };
    for (const key of ['maps_a', 'maps_b', 'winner_team_id', 'winner_side']) {
      if (payload[key] !== undefined) result[key] = payload[key];
    }
    if (payload.decision === 'cancel') result.decision = 'cancel';
    return result;
  }
  if (type === 'discord.retry') return {};
  throw integrationError(422, 'Acción oficial no admitida.');
}

let activeSync = null;
const sending = new Set();
const config = integrationConfig();
const request = createOperationsTransport(config);
setIntegrationStatus({ configured: config.configured, write_enabled: config.configured && config.writes, local_test_mode: config.localTestMode === true, web_origin: webOrigin() });

export function integrationStatus() {
  const stored = getIntegrationStatus();
  return {
    configured: config.configured,
    local_test_mode: config.localTestMode === true,
    write_enabled: config.configured && config.writes,
    syncing: Boolean(activeSync),
    last_sync_at: stored.last_sync_at || null,
    last_error: stored.last_error || null,
    supported_actions: supportedActions(stored.supported_actions),
    web_origin: webOrigin(),
    possibly_truncated: stored.possibly_truncated === true,
    competition_cutover_enabled: typeof stored.competition_cutover_enabled === 'boolean' ? stored.competition_cutover_enabled : null,
    poll_seconds: config.pollMs / 1000,
  };
}

export async function syncOperations() {
  if (activeSync) throw integrationError(409, 'Ya hay una sincronización en curso.');
  activeSync = (async () => {
    try {
      const snapshot = await request({ action: 'snapshot' });
      if (['matches', 'incidents', 'stats', 'clubs', 'deliveries'].some((key) => !Array.isArray(snapshot[key]))) {
        throw integrationError(502, 'CTP ha devuelto una instantánea incompleta. Se conservan los últimos datos válidos.');
      }
      const actions = supportedActions(snapshot.supported_actions);
      // Validation/persistence is transactional; failed snapshots retain the last good projection.
      ingestSnapshot(snapshot);
      setIntegrationStatus({ last_sync_at: new Date().toISOString(), last_error: null, supported_actions: actions, possibly_truncated: snapshot.possibly_truncated === true, competition_cutover_enabled: typeof snapshot.competition_cutover_enabled === 'boolean' ? snapshot.competition_cutover_enabled : null });
    } catch (error) {
      const safe = error instanceof HttpError && error.status >= 500 ? error.message : 'No se ha podido sincronizar CTP. Se conservan los últimos datos válidos.';
      setIntegrationStatus({ last_error: safe });
      throw integrationError(error instanceof HttpError ? error.status : 502, safe);
    }
  })();
  try { await activeSync; } finally { activeSync = null; }
  return integrationStatus();
}

export async function sendOperationCommand(id) {
  if (!config.configured) throw integrationError(503, 'Conexión con CTP sin configurar.');
  if (!config.writes) throw integrationError(403, 'Los envíos a CTP están desactivados. Se requiere habilitación explícita en el servidor.');
  const command = getCommand(id);
  if (!command) throw integrationError(404, 'Solicitud no encontrada.');
  const recoverable = command.status === 'sending' && Date.now() - command.updated_at >= 30_000;
  if (!['pending', 'failed'].includes(command.status) && !recoverable) throw integrationError(409, 'Esta solicitud ya está confirmada o no admite envío.');
  const rawType = command.type || command.action;
  const type = rawType === 'incident.note' ? 'incident.reply' : rawType;
  if (!command.attempts && (command.source_available === false || (Number.isInteger(command.source_version_current) && command.expected_version !== command.source_version_current))) {
    throw integrationError(409, 'El recurso oficial ha cambiado o ya no está disponible. Sincroniza y revisa la solicitud.');
  }
  if (!ACTIONS.includes(type) || !integrationStatus().supported_actions.includes(type)) throw integrationError(422, 'CTP no admite todavía esta acción. La solicitud permanece pendiente.');
  const author = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(command.actor_id);
  if (!author) throw integrationError(403, 'El autor de esta solicitud ya no tiene acceso.');
  const user = describeUser(author);
  if (!user.is_admin && !user.sections.includes(ACTION_SECTIONS[type])) throw integrationError(403, 'El autor de esta solicitud ya no tiene el permiso necesario.');
  if (sending.has(command.id)) throw integrationError(409, 'Esta solicitud ya se está enviando.');
  const payload = officialPayload(type, command.payload);
  sending.add(command.id);
  try {
    markCommandSending(command.id);
    const commandId = command.idempotency_key || command.id;
    const targetId = command.target_id || command.resource_id;
    const result = await request(type === PRO_VIEW_ACTION ? {
      action: 'pro_view_configure', actor_id: getOperatorIdentity(command.actor_id), commandId,
      expectedRevision: command.expected_version, settings: payload,
    } : {
      action: 'command', actor_id: getOperatorIdentity(command.actor_id), command_id: commandId,
      type, target_id: targetId,
      expected_version: command.expected_version ?? command.payload?.expected_version,
      payload,
    });
    if (type === PRO_VIEW_ACTION ? result.applied !== true || result.commandId !== commandId || !Number.isSafeInteger(result.revision) || result.revision < 1 : result.applied !== true || result.command_id !== commandId || result.type !== type || result.target_id !== targetId) throw integrationError(502, 'CTP no ha confirmado la aplicación de esta solicitud.');
    acknowledgeCommand(command.id, { confirmed: true, external_id: result.external_id || result.command_id || result.commandId, source_version: type === PRO_VIEW_ACTION ? result.revision : result.source_version ?? result.version, revision_id: result.revision_id });
    let sync_pending = false;
    if (['stats.correct','incident.status','match.resolve','match.revert'].includes(type)) {
      try { await syncOperations(); } catch { sync_pending = true; }
    }
    return { ok: true, confirmed: true, command_id: command.id, sync_pending };
  } catch (error) {
    const safe = error instanceof HttpError ? error.message : 'No se ha confirmado el envío a CTP.';
    failCommand(command.id, { message: safe, definitive_rejection: !command.attempts && (error.remoteRejected === true || ((GUARD_ACTIONS.includes(type) || type === PRO_VIEW_ACTION) && error.status === 409)) });
    throw integrationError(error instanceof HttpError ? error.status : 502, safe);
  } finally { sending.delete(command.id); }
}

export async function getProViewState(user) {
  if (!user?.is_admin && !user?.sections?.includes('realizacion')) throw integrationError(403, 'Necesitas acceso de producción para gestionar Pro View.');
  if (!integrationStatus().supported_actions.includes(PRO_VIEW_ACTION)) throw integrationError(503, 'El puente CTP todavía no tiene habilitado Pro View.');
  const state = proViewState(await request({ action: 'pro_view_state', actor_id: getOperatorIdentity(user.id) }));
  return rememberProViewState(state);
}

export async function getGuardState(user,id) {
  if(!user?.is_admin&&!user?.sections?.includes('arbitraje'))throw integrationError(403,'Necesitas acceso de arbitraje.');
  guardId(id);
  if(!integrationStatus().supported_actions.includes('guard.start'))throw integrationError(503,'El puente CTP todavía no tiene habilitada la integración Guard.');
  const state=guardState(await request({action:'guard_state',actor_id:getOperatorIdentity(user.id),target_id:id}),id);
  return rememberGuardState(state);
}
export async function getRankedState(user) {
  if (!user?.is_admin) throw integrationError(403, 'La programación de Ranked requiere administración.');
  if (!integrationStatus().supported_actions.includes('ranked.season.schedule')) throw integrationError(503, 'El puente CTP todavía no tiene habilitadas las seasons de Ranked.');
  return rememberRankedState(rankedState(await request({ action: 'ranked_state', actor_id: getOperatorIdentity(user.id) })));
}
export async function getRankedMonitor(user) {
  if (!user?.id) throw integrationError(401, 'Necesitas iniciar sesión.');
  if (!user.is_admin || (user.auth_mode === 'ctp' && user.ctp_role !== 'admin')) throw integrationError(403, 'La monitorización de Ranked requiere administración.');
  return rankedMonitorState(await request({action: 'ranked_monitor', actor_id: getOperatorIdentity(user.id)}));
}
export async function getClubCandidates(user, query) {
  if (!user?.is_admin) throw integrationError(403, 'La creación manual de clubes requiere administración.');
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 40) throw integrationError(400, 'Busca un jugador con 3–40 caracteres.');
  if (!integrationStatus().supported_actions.includes('club.create')) throw integrationError(503, 'El puente CTP todavía no admite altas manuales de clubes.');
  const result = await request({ action: 'club_candidates', actor_id: getOperatorIdentity(user.id), query: query.trim() });
  if (!Array.isArray(result) || result.length > 20 || result.some(row => !row || !/^[0-9a-f-]{36}$/i.test(row.id) || typeof row.username !== 'string')) throw integrationError(502, 'CTP ha devuelto candidatos no válidos.');
  return result.map(row => ({ id: row.id, username: row.username.slice(0, 100) }));
}
export async function getIncidentContext(user, id, cursor) {
  // This local permission/resource check runs before any network request.
  const { incident } = await getOfficialIncident(user, id);
  if (incident.source !== 'ctp') throw integrationError(422, 'Este expediente es interno y no tiene conversación en CTP.');
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length > 160)) throw integrationError(400, 'Cursor no válido.');
  const result = await request({ action: 'case_context', actor_id: getOperatorIdentity(user.id), target_id: id, cursor: cursor || null });
  if (result.incident_id !== id || !Array.isArray(result.messages) || result.messages.length > 50 ||
    (result.next_cursor !== null && (typeof result.next_cursor !== 'string' || result.next_cursor.length > 160))) {
    throw integrationError(502, 'CTP ha devuelto un contexto no válido.');
  }
  const messages = result.messages.map((message) => {
    if (!message || typeof message.id !== 'string' || typeof message.text !== 'string' || !['ticket', 'ranked'].includes(message.source) || typeof message.created_at !== 'string') {
      throw integrationError(502, 'CTP ha devuelto un mensaje no válido.');
    }
    return { id: message.id.slice(0, 160), author_name: String(message.author_name || '').slice(0, 160), text: message.text.slice(0, 16000),
      created_at: message.created_at, source: message.source, is_staff: message.is_staff === true };
  });
  return { incident_id: id, messages, next_cursor: result.next_cursor,
    web_path: typeof result.web_path === 'string' && /^\/(?!\/)/.test(result.web_path) && !result.web_path.includes('\\') ? result.web_path : null };
}

/** Read official competition data using the caller's bound staff identity. */
export async function getCompetitionData(user, query = {}) {
  const resource = query.resource || 'tournaments';
  if (!['tournaments', 'tournament', 'history', 'statistics', 'match', 'referee_queue'].includes(resource)) throw integrationError(400, 'Consulta de competición no válida.');
  const allowed = ['statistics', 'match', 'referee_queue'].includes(resource) ? ['arbitraje'] : resource === 'history' ? ['operaciones', 'arbitraje'] : ['operaciones'];
  if (!user?.is_admin && !allowed.some((section) => user?.sections?.includes(section))) throw integrationError(403, 'No tienes permiso para esta consulta.');
  const filters = {};
  for (const key of ['query', 'status', 'kind', 'tournament_id', 'date_from', 'date_to', 'cursor']) {
    if (query[key] !== undefined && query[key] !== '') {
      if (typeof query[key] !== 'string' || query[key].length > (key === 'cursor' ? 512 : 160)) throw integrationError(400, 'Filtro de consulta no válido.');
      filters[key] = query[key];
    }
  }
  for (const key of ['date_from', 'date_to']) if (filters[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(Date.parse(filters[key])))) throw integrationError(400, 'Fecha de filtro no válida.');
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) throw integrationError(400, 'El intervalo de fechas está invertido.');
  const limit = Number(query.limit || 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw integrationError(400, 'Tamaño de página no válido.');
  filters.limit = limit;
  const target_id = query.target_id || null;
  if (target_id !== null && (typeof target_id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/i.test(target_id))) throw integrationError(400, 'Identificador no válido.');
  if (['tournament', 'statistics', 'match'].includes(resource) && !target_id) throw integrationError(400, 'Selecciona un recurso.');
  const result = await request({ action: 'competition', actor_id: getOperatorIdentity(user.id), resource, target_id, filters });
  const list = (value, max) => Array.isArray(value) && value.length <= max && value.every((row) => row && typeof row === 'object' && !Array.isArray(row));
  if (resource === 'tournament') {
    if (!result.tournament || result.tournament.id !== target_id || !list(result.participants, 256) || !list(result.matches, 2000) || !list(result.games, 1000)) throw integrationError(502, 'CTP ha devuelto un torneo incompleto.');
  } else if (resource === 'match') {
    if (result.match?.id !== target_id || !Number.isInteger(result.match?.manager_version) || !['steps', 'pool', 'messages', 'reports'].every(key => list(result[key], 1000))) throw integrationError(502, 'CTP ha devuelto un partido incompleto.');
    if(result.dossier&&(result.dossier.id!==target_id||result.dossier.version!==result.match.manager_version||!list(result.dossier.roster,100)||!list(result.dossier.statistics,100)||!list(result.dossier.maps,30)))throw integrationError(502,'CTP ha devuelto un dossier incoherente.');
  } else if (!list(result.items, resource === 'statistics' ? 100 : limit) || (result.next_cursor != null && (typeof result.next_cursor !== 'string' || result.next_cursor.length > 512))) {
    throw integrationError(502, 'CTP ha devuelto una página no válida.');
  }
  if (resource === 'tournaments' && !list(result.games, 1000)) throw integrationError(502, 'CTP no ha devuelto los juegos disponibles.');
  return rememberCompetitionData(resource, result);
}

export const getOperationHistory = (user, query = {}) => getCompetitionData(user, { ...query, resource: 'history' });

/** Historic dossiers are read on demand by referees, never added to the caster feed. */
export async function getOfficialMatchDossier(user,id) {
  try{return matchDossier(user,id);}catch(error){if(error.status!==404||(!user?.is_admin&&!user?.sections?.includes('arbitraje')))throw error;}
  const result=await getCompetitionData(user,{resource:'match',target_id:id});
  if(!result.dossier)throw integrationError(502,'CTP no ha devuelto el dossier histórico. Actualiza la conexión.');
  return matchDossier(user,id,{historical:true});
}

export async function getCaseData(user, query = {}) {
  if(!user?.is_admin&&!user?.sections?.includes('arbitraje'))throw integrationError(403,'Necesitas acceso de arbitraje.');
  const parsed=caseQueryParameters(query);
  const result=await request({action:'case_query',actor_id:getOperatorIdentity(user.id),...parsed});
  if(!Array.isArray(result.messages)||result.messages.length>50||result.messages.some(row=>!row||typeof row!=='object')
    ||(result.next_cursor!=null&&(typeof result.next_cursor!=='string'||result.next_cursor.length>160)))throw integrationError(502,'CTP ha devuelto una conversación no válida.');
  const item=parsed.resource==='incident'?result.incident:result.match;
  if(item?.id!==parsed.target_id||!Number.isSafeInteger(item.manager_version)||item.manager_version<1)throw integrationError(502,'CTP ha devuelto una versión de expediente no válida.');
  return rememberCaseData(parsed.resource,result);
}
export async function getOfficialIncident(user,id) {
  try{return incidentDetail(user,id);}catch(error){if(error.status!==404)throw error;}
  await getCaseData(user,{resource:'incident',target_id:id});
  return incidentDetail(user,id);
}

/** Administrative data stays server-to-server and is never a general SQL proxy. */
export async function getAdministrationData(user, query = {}) {
  if (!user?.is_admin) throw integrationError(403, 'Esta sección requiere administración CTP.');
  const body = administrationQuery(query);
  const result = await request({ ...body, actor_id: getOperatorIdentity(user.id) });
  if (result.resource !== body.resource || !Array.isArray(result.items) || result.items.length > body.filters.limit
    || result.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))
    || !Number.isSafeInteger(result.total) || result.total < 0 || typeof result.has_more !== 'boolean') throw integrationError(502, 'CTP ha devuelto una página administrativa no válida.');
  const privateKeys = new Set(['password', 'password_hash', 'encrypted_password', 'access_token', 'refresh_token', 'service_role_key', 'client_secret', 'private_key', 'ctp_tokens']);
  const safe = value => {
    if (Array.isArray(value)) return value.every(safe);
    return !value || typeof value !== 'object' || Object.entries(value).every(([key, child]) => !privateKeys.has(key.toLowerCase()) && safe(child));
  };
  if (!safe(result)) throw integrationError(502, 'CTP ha devuelto campos privados no admitidos.');
  return rememberAdministrationData(result);
}

export async function getAdministrationService(user, service, payload) {
  if (!user?.is_admin) throw integrationError(403, 'Esta sección requiere administración CTP.');
  if (!['twitch','push','image','crm'].includes(service)) throw integrationError(400, 'Servicio no admitido.');
  const read = service === 'crm' ? crmIsRead(payload?.action) : service === 'push' || payload?.action === 'status';
  if (!read && !config.writes) throw integrationError(403, 'Los cambios oficiales están desactivados.');
  return request({action:'admin_service',actor_id:getOperatorIdentity(user.id),service,payload});
}

/** Ruleta: lista de personas registradas en CTP, leída con la identidad del administrador. */
export async function getRegisteredPlayers(user) {
  if (!user?.is_admin) throw integrationError(403, 'Cargar la lista de CTP requiere administración.');
  if (!config.configured) throw integrationError(503, 'Conexión con CTP sin configurar.');
  return collectRegisteredPlayers(request, getOperatorIdentity(user.id));
}

export const ctpBridgeConfigured = () => config.configured;

/** Coordination can manage staff grants without receiving the admin console. */
export async function getStaffDirectory(user, query) {
  if (!canManageStaff(user)) throw integrationError(403, 'La gestión de staff requiere administración o coordinación de CTP.');
  const payload = staffDirectoryQuery(query);
  const result = await request({ action: 'admin_service', actor_id: getOperatorIdentity(user.id), service: 'staff', payload });
  return staffDirectoryResponse(result, payload);
}

export async function setStaffAccess(user, userId, body) {
  if (!canManageStaff(user)) throw integrationError(403, 'La gestión de staff requiere administración o coordinación de CTP.');
  if (!config.writes) throw integrationError(403, 'Los cambios oficiales están desactivados.');
  const payload = staffAccessPayload(userId, body);
  const result = await request({ action: 'admin_service', actor_id: getOperatorIdentity(user.id), service: 'staff', payload });
  return staffAccessResponse(result, payload);
}

/** Optional read polling only; writes always require a deliberate authenticated request. */
export function startOperationsSync() {
  if (!config.configured || !config.pollMs) return null;
  const timer = setInterval(() => { if (!activeSync) syncOperations().catch(() => {}); }, config.pollMs);
  timer.unref();
  return timer;
}
