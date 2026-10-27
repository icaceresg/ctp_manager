import { HttpError } from './auth.js';
import { ugcListQuery,ugcWritePayload,ugcResponse,safetyId,erasureListQuery,erasurePayload,erasureResponse } from './mobile-safety-contract.js';
import { createErasureInspector } from './erasure-local.js';

/** Only authenticated administration calls reach this connector. CTP repeats
 * current admin.console/role authorization behind the existing HMAC boundary. */
export function createMobileSafetyClient({request,actorFor,database,writesEnabled}) {
  const inspect = createErasureInspector(database);
  database.exec('CREATE TABLE IF NOT EXISTS account_erasure_job_refs(job_id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL)');
  const requireAdmin = (user,write=false) => {
    if (!user?.is_admin || user.auth_mode === 'ctp' && user.ctp_role !== 'admin') throw new HttpError(403,'Esta sección requiere administración CTP.');
    if (write && !writesEnabled()) throw new HttpError(403,'Los cambios oficiales están desactivados.');
  };
  const call = (user,service,payload) => request({action:'admin_service',actor_id:actorFor(user),service,payload});
  function remember(result) {
    const jobs = result.requests ? result.requests.map(item=>item.job).filter(Boolean) : result.job_id ? [result] : [];
    for (const job of jobs) database.prepare('INSERT INTO account_erasure_job_refs(job_id,ticket_id,user_id) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET ticket_id=excluded.ticket_id,user_id=excluded.user_id').run(job.job_id,job.ticket_id,job.user_id);
    return result;
  }
  const readJob = async(user,id,version) => {
    const ref = database.prepare('SELECT ticket_id,user_id FROM account_erasure_job_refs WHERE job_id=?').get(id);
    if (!ref) throw new HttpError(409,'Vuelve a cargar la solicitud de privacidad antes de continuar.');
    const current = erasureResponse(await call(user,'erasure',{action:'status',ticket_id:ref.ticket_id}),{ticket_id:ref.ticket_id,job_id:id,user_id:ref.user_id});
    if (current.version !== version) throw new HttpError(409,'La tramitación ha cambiado. Actualiza antes de continuar.');
    return remember(current);
  };
  return {
    async ugcList(user,query) { requireAdmin(user); const p=ugcListQuery(query); return ugcResponse(await call(user,'ugc',p),p); },
    async ugcGet(user,id) { requireAdmin(user); const p={action:'get',report_id:safetyId(id)}; return ugcResponse(await call(user,'ugc',p),p); },
    async ugcWrite(user,id,body) { requireAdmin(user,true); const p=ugcWritePayload(id,body); return ugcResponse(await call(user,'ugc',p),p); },
    async erasureList(user,query) { requireAdmin(user); const p=erasureListQuery(query); return remember(erasureResponse(await call(user,'erasure',p),p)); },
    async erasureStatus(user,id) { requireAdmin(user); const p=erasurePayload('status',id); return remember(erasureResponse(await call(user,'erasure',p),p)); },
    async erasurePrepare(user,id,body) { requireAdmin(user,true); const p=erasurePayload('prepare',id,body); return remember(erasureResponse(await call(user,'erasure',p),{ticket_id:p.ticket_id})); },
    async erasureProcess(user,id,body) {
      requireAdmin(user,true); const p=erasurePayload('process',id,body); await readJob(user,p.job_id,p.expected_version);
      return remember(erasureResponse(await call(user,'erasure',p),{job_id:p.job_id}));
    },
    async erasureInspect(user,id,body) {
      requireAdmin(user,true); const p=erasurePayload('inspect',id,body), current=await readJob(user,p.job_id,p.expected_version);
      if (current.phase !== 'external' || !current.progress?.database_sanitized || !current.progress?.auth_closed || !current.progress?.storage_verified) throw new HttpError(409,'CTP debe confirmar primero el cierre de acceso, la base de datos y los archivos.');
      const checked = inspect(current);
      // status/hash never come from the browser. An uncertain response requires
      // a fresh status read and a new real inspection before any retry.
      const result=remember(erasureResponse(await call(user,'erasure',{action:'external_check',job_id:p.job_id,expected_version:current.version,status:checked.status,receipt_sha256:checked.receipt_sha256}),{job_id:p.job_id,ticket_id:current.ticket_id,user_id:current.user_id}));
      return {...result,local_inspection:checked.report,local_receipt_sha256:checked.receipt_sha256};
    },
  };
}
