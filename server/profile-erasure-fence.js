import {HttpError} from './auth.js';
import {isErasedSubject} from './erasure-local.js';

/** Call only with official UUIDs from the endpoint's validated request/DTO.
 * A fresh marker read follows each await. Refuse the complete profile response;
 * do not rewrite history, inspect prose or forge a partial paginated result. */
export function requireUnmarkedProfiles(database,officialUserIds) {
  for(const id of officialUserIds) {
    if(isErasedSubject(database,id))throw new HttpError(404,'La cuenta ya no está disponible en CTP. Actualiza antes de continuar.');
  }
}
