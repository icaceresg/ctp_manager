import {HttpError} from './auth.js';
import {canManageRanked} from '../shared/access.js';
import {playerWorkspaceQuery,playerWorkspaceResponse} from './player-workspace-contract.js';

/** Reuses the caller's signed bridge transport and current-actor authorization. */
export function createPlayerWorkspaceReader({request,actorFor}){
 if(typeof request!=='function'||typeof actorFor!=='function')throw new TypeError('Player workspace requires the existing bridge and actor resolver.');
 return async function readPlayerWorkspace(currentUser,rawQuery){
  if(!canManageRanked(currentUser))throw new HttpError(403,'Solo el staff autorizado puede consultar jugadores.');
  const query=playerWorkspaceQuery(rawQuery),actor_id=await actorFor(currentUser);
  if(typeof actor_id!=='string'||!/^[A-Za-z0-9._:@-]{1,100}$/.test(actor_id))throw new HttpError(403,'El operador de CTP no está autorizado.');
  const result=playerWorkspaceResponse(await request({action:'player_workspace',actor_id,query}),query);
  // Browser convenience flags cannot grant the existing administrator writer.
  if(!currentUser.is_admin)result.viewer.can_edit=false;
  return result;
 };
}
