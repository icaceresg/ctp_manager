// Ruleta del directo: lectura de las personas registradas en CTP a través del
// directorio de staff del puente firmado (admin_service → staff). Ese directorio
// trae, además del rol CTP, el permiso de Manager concedido desde la página de
// staff (caster, producción…). Solo se conservan el identificador, el nombre
// visible y esos datos de acceso; nunca correo, avatar ni estadísticas.
import { HttpError } from './auth.js';
import { STAFF_KINDS } from '../shared/access.js';
import { staffDirectoryResponse } from './staff-access-contract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(STAFF_KINDS.map((kind) => kind.id));
export const RULETA_PAGE_SIZE = 100;
export const RULETA_MAX_PAGES = 80; // 8.000 personas como máximo por recarga.

/** Limpia una fila del directorio de staff CTP o devuelve null si no es válida. */
export function ruletaPerson(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !UUID.test(row.id)) return null;
  const name = typeof row.username === 'string' ? row.username.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
  if (!name) return null;
  const role = ['player', 'referee', 'admin'].includes(row.role) ? row.role : 'player';
  return {
    ctp_id: row.id.toLowerCase(),
    name,
    role,
    staff_kind: KINDS.has(row.staff_kind) ? row.staff_kind : '',
    staff_enabled: row.staff_enabled === true,
    email_confirmed: row.email_confirmed === true,
  };
}

/**
 * Recorre todas las páginas del directorio de staff CTP. `request` es el
 * transporte firmado del puente; `actorId` la identidad CTP del administrador.
 */
export async function collectRegisteredPlayers(request, actorId, { maxPages = RULETA_MAX_PAGES } = {}) {
  const people = new Map();
  let total = 0;
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      truncated = true;
      break;
    }
    const payload = { action: 'list', query: '', offset: page * RULETA_PAGE_SIZE, limit: RULETA_PAGE_SIZE };
    let result;
    try {
      result = staffDirectoryResponse(await request({ action: 'admin_service', actor_id: actorId, service: 'staff', payload }), payload);
    } catch (error) {
      throw error instanceof HttpError && error.status !== 502 ? error : new HttpError(502, 'CTP ha devuelto una lista de usuarios no válida.');
    }
    total = result.total;
    for (const row of result.items) {
      const person = ruletaPerson(row);
      if (person) people.set(person.ctp_id, person);
    }
    if (!result.items.length || payload.offset + result.items.length >= total) break;
  }
  return { people: [...people.values()], total, truncated };
}
