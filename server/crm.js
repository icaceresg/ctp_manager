import { HttpError } from './auth.js';
import { getAdministrationService } from './integration.js';
import { crmRequest } from './crm-contract.js';

function administrator(user) {
  if(!user?.id)throw new HttpError(401,'Necesitas iniciar sesión.');
  if(!user.is_admin||(user.auth_mode==='ctp'&&user.ctp_role!=='admin'))throw new HttpError(403,'El CRM requiere administración de CTP.');
}
/** Toda la autoridad reside en CTP (manager_crm); Manager no guarda contactos. */
export async function crmAction(user,input) {
  administrator(user);
  const {action,data}=crmRequest(input);
  return getAdministrationService(user,'crm',{action,data});
}
