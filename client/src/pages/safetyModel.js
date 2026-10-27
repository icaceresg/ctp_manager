export const ERASURE_STATES = {not_prepared:'Pendiente de preparar',prepared:'Preparada',running:'En curso',blocked_policy:'Requiere decisión de conservación',blocked_dependency:'Dependencia pendiente',retryable:'Requiere reintento',awaiting_confirmation:'Confirmación pendiente',completed:'Completada'};
export const ERASURE_PHASES = {database:'Datos y acceso',storage:'Archivos',external:'Manager y PC Check',confirmation:'Notificación final',complete:'Finalizada'};
export const UGC_REASONS = {abuse:'Acoso o insultos',hate:'Odio',sexual:'Contenido sexual',child_safety:'Seguridad de menores',privacy:'Privacidad',scam:'Fraude',other:'Otro motivo'};
export const UGC_STATES = {pending:'Pendiente',hidden:'Contenido retirado',dismissed:'Archivado'};
export function canProcessErasure(job) { return Boolean(job?.job_id && ['database','storage'].includes(job.phase) && job.retryable && job.state !== 'completed'); }
export function canInspectErasure(job) { return Boolean(job?.job_id && job.phase === 'external' && job.progress?.database_sanitized && job.progress?.auth_closed && job.progress?.storage_verified); }

/** A failed/ambiguous transmission retains the exact nonce, reason and CAS.
 * Reloading/switching report requires explicit abandonment of this local intent. */
export function createModerationIntent(randomUUID=()=>crypto.randomUUID()) {
  let pending = null;
  return {
    get pending() { return pending; },
    begin(report,action,reason) {
      const body={action,expected_version:report.version,reason:reason.trim()};
      if (pending) {
        if (pending.report_id !== report.id || Object.entries(body).some(([key,value])=>value !== pending.body[key])) throw Error('Hay una acción sin confirmar. Reintenta la misma acción o actualiza el informe para comprobar su estado.');
        return pending.body;
      }
      pending={report_id:report.id,body:{...body,request_id:randomUUID()}};
      return pending.body;
    },
    confirm(id,body,result) {
      if (!pending || pending.report_id !== id || pending.body !== body || result?.report?.id !== id
        || result.report.status !== (body.action === 'hide'?'hidden':'dismissed')) throw Error('CTP no ha confirmado esta decisión.');
      pending=null;
    },
    reset() {pending=null;},
  };
}

export function createAvatarRemovalIntent(randomUUID=()=>crypto.randomUUID()) {
  let pending=null;
  return {
    get pending(){return pending;},
    begin(value,reason){
      const body={expected_report_version:value.report.version,expected_user_version:value.user.manager_version,reason:reason.trim()};
      if(pending){
        if(pending.report_id!==value.report.id||Object.entries(body).some(([key,child])=>pending.body[key]!==child))throw Error('La retirada anterior sigue sin confirmar. Reinténtala o actualiza su estado antes de cambiar los datos.');
        return pending.body;
      }
      pending={report_id:value.report.id,body:{...body,request_id:randomUUID()}};return pending.body;
    },
    confirm(id,body,value){if(!pending||pending.report_id!==id||pending.body!==body||value?.report?.id!==id||value?.job?.report_id!==id)throw Error('CTP no ha confirmado el trabajo de retirada.');pending=null;},
    reset(){pending=null;},
  };
}
