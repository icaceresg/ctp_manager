// Ruleta del directo: lectura de las personas registradas en CTP a través del
// puente firmado ya existente (admin_query → users). Solo se conservan el
// identificador, el nombre visible y el rol; nunca correo, avatar ni estadísticas.
import { HttpError } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RULETA_PAGE_SIZE = 100;
export const RULETA_MAX_PAGES = 80; // 8.000 personas como máximo por recarga.

/** Limpia una fila de usuario CTP o devuelve null si no es válida. */
export function ruletaPerson(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !UUID.test(row.id)) return null;
  const name = typeof row.username === 'string' ? row.username.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
  if (!name) return null;
  const role = ['player', 'referee', 'admin'].includes(row.role) ? row.role : 'player';
  return { ctp_id: row.id.toLowerCase(), name, role };
}

/**
 * Recorre todas las páginas de usuarios CTP. `request` es el transporte firmado
 * del puente; `actorId` la identidad CTP del administrador que pide la lista.
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
    const result = await request({ action: 'admin_query', actor_id: actorId, resource: 'users', target_id: null, filters: { page, limit: RULETA_PAGE_SIZE } });
    if (!result || result.resource !== 'users' || !Array.isArray(result.items) || result.items.length > RULETA_PAGE_SIZE
      || !Number.isSafeInteger(result.total) || result.total < 0 || typeof result.has_more !== 'boolean') {
      throw new HttpError(502, 'CTP ha devuelto una lista de usuarios no válida.');
    }
    total = result.total;
    for (const row of result.items) {
      const person = ruletaPerson(row);
      if (person) people.set(person.ctp_id, person);
    }
    if (!result.has_more || !result.items.length) break;
  }
  return { people: [...people.values()], total, truncated };
}
