import { HttpError } from './auth.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 999999999;
const text = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
const nullableText = (value, max) => value === null || text(value, max);
const timestamp = value => text(value, 64) && Number.isFinite(Date.parse(value));
const fields = (value, allowed) => object(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const invalid = () => { throw new HttpError(400, 'La solicitud de moderación o privacidad no es válida.'); };
const upstream = () => { throw new HttpError(502, 'CTP no ha confirmado un estado válido. Actualiza antes de continuar.'); };
export const safetyId = value => { if (!uuid(value)) invalid(); return value; };
const page = (value, fallback, max) => { if (value !== undefined && !(typeof value === 'string' && /^\d+$/.test(value) || typeof value === 'number')) invalid(); const n = value === undefined ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 0 || n > max) invalid(); return n; };

export function ugcListQuery(query = {}) {
  if (!object(query) || Object.keys(query).some(key => !['offset','limit','status'].includes(key))) invalid();
  const limit = page(query.limit,20,50); if (limit < 1) invalid();
  const status = query.status ?? 'pending'; if (!['pending','hidden','dismissed','all'].includes(status)) invalid();
  return { action:'list', offset:page(query.offset,0,10000), limit, status };
}
export function ugcWritePayload(id, body) {
  if (!fields(body,['action','expected_version','reason','request_id']) || !['hide','dismiss'].includes(body.action)
    || !positive(body.expected_version) || !uuid(body.request_id) || !text(body.reason,500)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.reason) || Array.from(body.reason.trim()).length < 12) invalid();
  return { action:body.action, report_id:safetyId(id), expected_version:body.expected_version, reason:body.reason.trim(), request_id:body.request_id };
}
function reportDto(row) {
  if (!object(row) || !uuid(row.id) || !uuid(row.ticket_id) || !text(row.ticket_code,64)
    || !['message','user'].includes(row.context) || !['abuse','hate','sexual','child_safety','privacy','scam','other'].includes(row.reason)
    || !text(row.details,1000) || !['pending','hidden','dismissed'].includes(row.status) || !positive(row.version)
    || !timestamp(row.created_at) || !uuid(row.target_id) || !nullableText(row.target_username,100)
    || !nullableText(row.message_id,100) || !(row.lobby_id === null || uuid(row.lobby_id)) || typeof row.hidden !== 'boolean'
    || !(row.reviewed_at === null || timestamp(row.reviewed_at)) || !nullableText(row.review_note,500) || !object(row.evidence)) upstream();
  const evidence = {};
  for (const [key,max] of [['username',100],['message',5000],['avatar',2000],['created_at',64]]) {
    if (row.evidence[key] === undefined) continue;
    if (!nullableText(row.evidence[key],max)) upstream();
    evidence[key] = row.evidence[key];
  }
  if (row.evidence.redacted === true) evidence.redacted = true;
  return Object.fromEntries(['id','ticket_id','ticket_code','context','reason','details','status','version','created_at','target_id','target_username','message_id','lobby_id','hidden','reviewed_at','review_note'].map(key => [key,row[key]]).concat([['evidence',evidence]]));
}
export function ugcResponse(value, payload) {
  if (!object(value) || value.schema_version !== 1) upstream();
  if (payload.action === 'list') {
    if (!Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > payload.limit) upstream();
    const items=value.items.map(reportDto);
    if (payload.status !== 'all' && items.some(row=>row.status!==payload.status)) upstream();
    return { schema_version:1,total:value.total,items };
  }
  const report = value.report === null ? null : reportDto(value.report);
  if (report && report.id !== payload.report_id) upstream();
  if (payload.action !== 'get' && (!report || report.status !== (payload.action === 'hide' ? 'hidden' : 'dismissed')
    || report.version !== payload.expected_version+1 || report.review_note !== payload.reason)) upstream();
  return { schema_version:1,report };
}

export function erasureListQuery(query = {}) {
  if (!object(query) || Object.keys(query).some(key => !['limit','offset'].includes(key))) invalid();
  const limit = page(query.limit,20,50); if (limit < 1) invalid();
  return { action:'list',limit,offset:page(query.offset,0,10000) };
}
export function erasurePayload(action, id, body = {}) {
  if (action === 'prepare') {
    if (!fields(body,['expected_request_version','expected_user_version','confirm_username']) || !positive(body.expected_request_version)
      || !positive(body.expected_user_version) || !text(body.confirm_username,100) || body.confirm_username.length < 1) invalid();
    return { action,ticket_id:safetyId(id),...body };
  }
  if (action === 'status') { if (!fields(body,[])) invalid(); return { action,ticket_id:safetyId(id) }; }
  if (!['process','inspect'].includes(action) || !fields(body,['expected_version']) || !positive(body.expected_version)) invalid();
  return { action,job_id:safetyId(id),expected_version:body.expected_version };
}
function requestDto(row) {
  if (!object(row) || !uuid(row.ticket_id) || !uuid(row.user_id) || !positive(row.request_version) || !positive(row.user_version)
    || !text(row.username,100) || !['abierto','en_revision','esperando_respuesta','resuelto','rechazado','cerrado'].includes(row.ticket_status)
    || !timestamp(row.requested_at)) upstream();
  return Object.fromEntries(['ticket_id','user_id','request_version','username','user_version','ticket_status','requested_at'].map(key => [key,row[key]]));
}
export function erasureResponse(value, expected = {}) {
  if (!object(value) || value.schema_version !== 1) upstream();
  if (Array.isArray(value.requests)) {
    if (value.requests.length > (expected.limit ?? 50) || typeof value.has_more !== 'boolean') upstream();
    return { schema_version:1,has_more:value.has_more,requests:value.requests.map(row => {
      if (!object(row)) upstream(); const request = requestDto(row.request);
      const job = row.job === null ? null : erasureResponse(row.job,{ticket_id:request.ticket_id,user_id:request.user_id});
      return {request,job};
    }) };
  }
  const request = value.request == null ? null : requestDto(value.request);
  if (value.state === 'not_prepared') {
    if (!uuid(value.ticket_id) || !request || request.ticket_id !== value.ticket_id || expected.ticket_id && expected.ticket_id !== value.ticket_id) upstream();
    return {schema_version:1,ticket_id:value.ticket_id,state:'not_prepared',request};
  }
  const states = ['prepared','running','blocked_policy','blocked_dependency','retryable','awaiting_confirmation','completed'];
  const p = value.progress;
  if (!uuid(value.job_id) || !uuid(value.ticket_id) || !uuid(value.user_id) || !states.includes(value.state)
    || !['database','storage','external','confirmation','complete'].includes(value.phase) || !positive(value.version)
    || typeof value.retryable !== 'boolean' || !(value.completed_at === null || timestamp(value.completed_at))
    || !Array.isArray(value.blocked_reasons) || value.blocked_reasons.length > 50 || value.blocked_reasons.some(s => !text(s,100) || !/^[a-z0-9_]+$/.test(s))
    || !Array.isArray(value.retained_categories) || value.retained_categories.some(s => s !== 'competitive_keys_and_results') || !object(p)
    || ['database_sanitized','auth_closed','storage_verified','external_verified'].some(key => typeof p[key] !== 'boolean')
    || ![null,'queued','leased','sent','failed','uncertain'].includes(p.confirmation_state)
    || expected.ticket_id && value.ticket_id !== expected.ticket_id || expected.job_id && value.job_id !== expected.job_id || expected.user_id && value.user_id !== expected.user_id) upstream();
  if (value.state === 'completed' && (value.phase !== 'complete' || !value.completed_at || !p.database_sanitized || !p.auth_closed || !p.storage_verified || !p.external_verified || p.confirmation_state !== 'sent')) upstream();
  if (request && (request.ticket_id !== value.ticket_id || request.user_id !== value.user_id)) upstream();
  return Object.fromEntries(['job_id','ticket_id','user_id','state','phase','version','retryable','completed_at'].map(key => [key,value[key]]).concat([
    ['schema_version',1],['blocked_reasons',[...value.blocked_reasons]],['retained_categories',[...value.retained_categories]],
    ['progress',Object.fromEntries(['database_sanitized','auth_closed','storage_verified','external_verified','confirmation_state'].map(key => [key,p[key]]))],...(request ? [['request',request]] : [])]));
}
