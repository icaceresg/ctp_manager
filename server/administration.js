import { HttpError } from './auth.js';
import { getAdministrationData } from './integration.js';
import { prepareAdministrationCommand } from './operations.js';
import { administrationQuery } from './administration-contract.js';

function administrator(user) {
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!user.is_admin||(user.auth_mode==='ctp'&&user.ctp_role!=='admin'))throw new HttpError(403,'Esta sección requiere administración de CTP.');
}
export async function queryAdministration(user,query) {
  administrator(user);
  administrationQuery(query);
  return getAdministrationData(user,query);
}
export function proposeAdministration(user,input) {
  administrator(user);
  return prepareAdministrationCommand(user,input);
}
