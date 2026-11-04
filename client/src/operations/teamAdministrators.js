import { translate } from '../i18n/runtime.js';

const ERRORS = new Set(['invalid','forbidden','conflict','unavailable','userUnavailable','notFound','requestConflict','reasonRequired','activeRoster','writesDisabled','invalidCreate','accountUnavailable','limit','captainRequired']);
export function teamAdminError(error) {
  const message=typeof error?.message==='string'?error.message:'';
  const key=message.startsWith('manager.teamAdmins.')?message.slice('manager.teamAdmins.'.length):'';
  return translate(`manager.teamAdmins.${ERRORS.has(key)?key:'unavailable'}`);
}
export function teamAdministratorIntent(version, userId, enabled, reason, requestId) {
  if (!Number.isSafeInteger(version)||version<0||typeof enabled!=='boolean'||!String(reason||'').trim()||String(reason).trim().length<12)
    throw new Error('manager.teamAdmins.reasonRequired');
  return {user_id:userId,enabled,expected_version:version,reason:reason.trim(),request_id:requestId};
}
export function teamAccessLabel(entry) {
  const label=translate(`manager.teamAdmins.access.${entry.kind}`);
  return entry.season?translate('manager.teamAdmins.accessSeason',{label,season:entry.season}):label;
}
export function teamRegistrationStatus(status) {
  return translate(`manager.teamAdmins.status.${['borrador','inscripcion_abierta','en_curso','finalizado','cancelado'].includes(status)?status:'unknown'}`);
}
