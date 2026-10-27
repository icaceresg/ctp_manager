import crypto from 'node:crypto';
import { isErasedSubject } from './erasure-local.js';
import { readFileSync } from 'node:fs';

const DRIVER_CATALOGUE = JSON.parse(readFileSync(new URL('./pc-check-vulnerable-drivers.catalog.json',import.meta.url),'utf8'));

export class PcCheckError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new PcCheckError(status, message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const GAME_TITLE = 'Call of Duty: Modern Warfare 4';
const GAME_DISTRIBUTIONS = new Set(['steam','battle-net','xbox-pc','unspecified']);
const POLICIES = new Set(['ctp-pc-check/2026-10-26.2','ctp-pc-check/2026-10-26.3']);
const SIGNATURES = new Set(['ValidCachedPolicy','NotSigned','HashMismatch','NotTrustedOrCacheUnavailable','unavailable','not-inspected-byte-limit','not-inspected']);
const FILE_REASONS = new Set(['path_unavailable','time_budget','file_count_limit','byte_limit','nonlocal_or_unsupported_path','reparse_or_inaccessible_path','file_identity_changed_or_unverifiable','file_metadata_unavailable','executable_file_count_limit']);
const SCOPES = { Hardware: 1, Security: 2, Persistence: 4, Processes: 8, Network: 16, Events: 32, GameMemoryMetadata: 64, RawHardwareIdentifiers: 128, FullNetworkAddresses: 256 };
const COLLECTORS = { hardware: 1, security: 2, persistence: 4, processes: 8, network: 16, events: 32, memory: 72 };
const STATUSES = new Set(['complete', 'partial', 'unavailable', 'cancelled', 'failed']);
const FINDINGS = {
  hardware: ['HARDWARE_DRIVER_SIGNATURE_REVIEW','finding.hardware.driverSignatureReview','unsignedDriverCount',512],
  processes: ['PROCESS_MODULE_SIGNATURE_REVIEW','finding.process.moduleSignatureReview','moduleSignatureReviewCount',256],
  events: ['SECURITY_EVENT_METADATA_REVIEW','finding.events.metadataReview','reviewEventCount',200],
  memory: ['PRIVATE_EXECUTABLE_METADATA_REVIEW','finding.memory.privateExecutableReview',null,15000]
};
const DRIVER_FINDING = ['HARDWARE_VULNERABLE_DRIVER_REVIEW','finding.hardware.vulnerableDriverReview'];
const NAMES = new Set(['consent.json', 'targets.json', 'manifest.json', 'report.html', ...Object.keys(COLLECTORS).map(x => `${x}.json`)]);
const MAX_BYTES = 8 * 1024 * 1024;
const DATA_KEYS = {
  hardware: ['identifierMode','baseboards','bios','systems','pnpDevices','drivers','systemDrivers','unsignedDriverCount','pciInterpretation','duplicateDevicesAreNormal','firmwareIntegrity','physicalDmaDeviceAbsence','fileIdentityCoverage','driverCatalogue'],
  security: ['os','secureBoot','defender','deviceGuard','codeIntegrity','configurationIsCheatingProof','kernelOrFirmwareTampering'],
  persistence: ['autoruns','services','scheduledTasks','imageExecutionOptions','appInit','winlogon','commandLinesCollected','scriptContentsCollected','persistenceIsCheatingProof','registryCoverage'],
  processes: ['processes','selectedGameModules','moduleSignatureReviewCount','bytesHashed','signaturePolicy','fileInspection','commandLinesCollected','processMemoryBytesCollected','protectedProcessesBypassed','modulesAreSnapshot','unsignedModulesAreCheatingProof','fileIdentityCoverage','maximumExecutableFiles','prioritizedGameExecutables'],
  network: ['observedFromUtc','observedUntilUtc','addressMode','tcp','udp','interfaceCounterDeltas','packetContentsCollected','dnsQueriesCollected','udpDestinationCoverage','connectionsAreCheatingProof'],
  events: ['windowFromUtc','windowUntilUtc','sources','events','returnedCounts','reviewEventCount','eventMessagesCollected','eventDataCollected','returnedCountsAreFullWindowCounts','missingLogsProveNoActivity','eventsAreCheatingProof','gameEventLinks','gameEventLinkCoverage'],
  memory: ['targets','maximumExplicitTargets','maximumRegionQueriesPerTarget','maximumReviewRegionsPerTarget','memoryBytesRead','protectedProcessesBypassed','debugPrivilegeEnabled','driverInstalled','privateExecutableIsCheatingProof','assessment']
};
const DATA_ARRAYS = {
  hardware:['baseboards','bios','systems','pnpDevices','drivers','systemDrivers'], security:['os'],
  persistence:['autoruns','services','scheduledTasks','imageExecutionOptions','appInit','winlogon'],
  processes:['processes','selectedGameModules'], network:['tcp','udp','interfaceCounterDeltas'],
  events:['sources','events','returnedCounts'], memory:['targets']
};
const ROW_KEYS = {
  hardware: { baseboards:['manufacturer','product','serial'], bios:['manufacturer','version','releasedAtUtc','serial'], systems:['vendor','model','identifyingNumber','uuid'], pnpDevices:['name','manufacturer','class','instanceId','pciVendorDevice','service','problemCode'], drivers:['name','class','manufacturer','provider','version','dateUtc','signed','inf','deviceId'], systemDrivers:['name','displayName','state','startMode','executable','fileIdentity'] },
  security: { os:['caption','version','build','architecture','lastBootAtUtc'] },
  persistence: { autoruns:['location','name','executable','executableResolution'], services:['name','displayName','state','startMode','executable'], scheduledTasks:['name','folderPseudonym','state','executables'], imageExecutionOptions:['view','image','debugger','globalFlag'], appInit:['view','modules','loadEnabled','requireSigned'], winlogon:['location','name','executables'] },
  processes: { processes:['pid','name','startedAtUtc','executable','executableAvailable','fileIdentity'], selectedGameModules:['pid','coverage','modules'] },
  network: { tcp:['protocol','pid','localAddress','localPort','remoteAddress','remotePort','state'], udp:['protocol','pid','localAddress','localPort','remoteEndpointAvailable'], interfaceCounterDeltas:['adapterPseudonym','intervalSeconds','receivedBytesDelta','sentBytesDelta'] },
  events: { sources:['provider','coverage','returnedRecords','maximumRecords','selectedEventIds'], events:['provider','eventId','atUtc','level'], returnedCounts:['provider','eventId','returnedCount'] },
  memory: { targets:['pid','coverage','nativeError','regionQueries','committedRegions','committedBytesRepresentedByMetadata','privateExecutableRegions','reviewRegions'] }
};
const REQUEST_KEYS = ['caseId','operatorAlias','playerAlias','purpose','locale','scopes','gameProcessIds','retentionDays','playerId','managerCaseId','uploadToManager','gameTitle','gameDistribution','gameBuildLabel'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail(400, 'Texto no válido para el expediente.');
  return value;
}
const coreTrim = value => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,'');
function playerAlias(value) {
  text(value,1,80);
  // .NET Char.IsControl also excludes C1 controls; White_Space mirrors String.Trim
  // without JavaScript's additional BOM trimming. Preserve the original alias for binding.
  if (/[\u0080-\u009f]/.test(value) || coreTrim(value).length === 0) fail(400,'Alias del jugador no válido.');
  return value;
}
function onlyKeys(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'Campos fuera del protocolo de evidencia.');
}
function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function declaredGameContext(request, policy) {
  if ((policy.endsWith('.3') || Object.hasOwn(request,'gameTitle')) && request.gameTitle !== GAME_TITLE) fail(400, 'El título del juego no corresponde a Modern Warfare 4.');
  if ((policy.endsWith('.3') || Object.hasOwn(request,'gameDistribution')) && !GAME_DISTRIBUTIONS.has(request.gameDistribution)) fail(400, 'Distribución del juego no válida.');
  if (request.gameBuildLabel != null) text(request.gameBuildLabel, 0, 80);
  return { title:request.gameTitle ?? null, distribution:request.gameDistribution ?? 'unspecified', buildLabel:request.gameBuildLabel || null,
    source:'operator-declared-not-game-attestation', legacyContextMissing:!Object.hasOwn(request,'gameTitle') };
}
function utcTicks(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(?:Z|\+00:00)$/.exec(value);
  const milliseconds = match && Date.parse(`${match[1]}Z`);
  if (!match || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0,19) !== match[1]) fail(400,'Fecha UTC de identidad o evento no válida.');
  return 621355968000000000n + BigInt(milliseconds)*10000n + BigInt((match[2] || '').padEnd(7,'0'));
}
function scopeMask(value) {
  if (Number.isSafeInteger(value) && value > 0 && value <= 511) return value;
  if (typeof value !== 'string') fail(400, 'Alcances de consentimiento no válidos.');
  const parts = value.split(',').map(x => x.trim());
  if (!parts.length || parts.some(x => !Object.hasOwn(SCOPES, x)) || new Set(parts).size !== parts.length) fail(400, 'Alcances de consentimiento no válidos.');
  return parts.reduce((n, x) => n | SCOPES[x], 0);
}
function validScopes(scopes) {
  return Number.isSafeInteger(scopes) && scopes > 0 && scopes <= 511 &&
    (!(scopes & 128) || Boolean(scopes & 1)) && (!(scopes & 256) || Boolean(scopes & 16)) && (!(scopes & 64) || Boolean(scopes & 8));
}
const cleanJson = buffer => {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    if (!object(value)) fail(400, 'Artefacto JSON no válido.');
    return value;
  } catch { fail(400, 'Artefacto JSON no válido.'); }
};

// Each case is scoped to the authenticated creator (or an administrator). No Supabase ACL is inferred.
export function createPcCheckStore(db, { origin, now = Date.now, key, reviewers = () => [] } = {}) {
  const evidenceKey = key instanceof Uint8Array && key.byteLength === 32 ? Buffer.from(key) : null;
  let ready = false;
  function privacyWrite(fn) {
    init();db.exec('SAVEPOINT pc_check_privacy_write');
    try{
      // Acquire SQLite's writer before reading the mark/token. This no-op
      // touches no row and composes with an enclosing transaction on Node22.
      db.prepare('UPDATE pc_check_migrations SET applied_at=applied_at WHERE 0').run();
      const result=fn();db.exec('RELEASE pc_check_privacy_write');return result;
    }catch(error){db.exec('ROLLBACK TO pc_check_privacy_write');db.exec('RELEASE pc_check_privacy_write');throw error;}
  }
  function init() {
    if (!evidenceKey) fail(503, 'PC Check necesita configurar una clave de custodia separada.');
    if (ready) return;
    db.exec(`CREATE TABLE IF NOT EXISTS pc_check_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pc_check_cases (
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL, player_alias TEXT NOT NULL,
        assigned_operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL, operator_alias TEXT NOT NULL,
        purpose TEXT NOT NULL, retention_days INTEGER NOT NULL, allowed_scopes INTEGER NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, token_hash TEXT, token_expires_at INTEGER,
        receipt_id TEXT, received_at INTEGER, manifest_sha256 TEXT, upload_sha256 TEXT,
        summary_json TEXT, evidence_ciphertext BLOB, evidence_nonce BLOB, evidence_tag BLOB
      );
      CREATE INDEX IF NOT EXISTS pc_check_case_owner ON pc_check_cases(assigned_operator_id, created_at);
        CREATE INDEX IF NOT EXISTS pc_check_case_player ON pc_check_cases(player_id, created_at);
      CREATE TABLE IF NOT EXISTS pc_check_reviews (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES pc_check_cases(id),
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, actor_alias TEXT NOT NULL,
        note TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pc_check_case_reviewers (
        case_id TEXT NOT NULL REFERENCES pc_check_cases(id), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_at INTEGER NOT NULL,
        PRIMARY KEY(case_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS pc_check_audit (
        id TEXT PRIMARY KEY, case_id TEXT, actor_id INTEGER, action TEXT NOT NULL, created_at INTEGER NOT NULL
      );`);
    db.prepare('INSERT OR IGNORE INTO pc_check_migrations(id,applied_at) VALUES(?,?)').run('20261026-pc-check-cases-v1', now());
    ready = true;
  }
  function staff(user) {
    if (!user?.id) fail(401, 'Necesitas iniciar sesión.');
    if (!user.is_admin && !user.sections?.includes('arbitraje')) fail(403, 'Necesitas acceso de arbitraje.');
  }
  function audit(action, caseId, userId = null) {
    db.prepare('INSERT INTO pc_check_audit(id,case_id,actor_id,action,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(), caseId, userId, action, now());
  }
  function row(id) {
    init();
    if (!UUID.test(id || '')) fail(404, 'Expediente no encontrado.');
    const item = db.prepare('SELECT * FROM pc_check_cases WHERE id=?').get(id);
    if (!item) fail(404, 'Expediente no encontrado.');
    return item;
  }
  function active(item) { if (item.expires_at <= now()) fail(410, 'La conservación del expediente ha caducado.'); }
  function owned(user, id, ownerOnly = false) {
    staff(user);
    const item = row(id);
    if (!user.is_admin && item.assigned_operator_id !== user.id && (ownerOnly || !db.prepare('SELECT 1 FROM pc_check_case_reviewers WHERE case_id=? AND user_id=?').get(id, user.id))) fail(403, 'No tienes acceso a este expediente.');
    active(item);
    return item;
  }
  function dto(item) {
    return { id: item.id, playerId: item.player_id, playerAlias: item.player_alias, assignedOperatorId: item.assigned_operator_id,
      operatorAlias: item.operator_alias, purpose: item.purpose, retentionDays: item.retention_days, allowedScopes: item.allowed_scopes,
      createdAtUtc: new Date(item.created_at).toISOString(), expiresAtUtc: new Date(item.expires_at).toISOString(),
      assignmentExpiresAtUtc: item.token_expires_at ? new Date(item.token_expires_at).toISOString() : null,
      receivedAtUtc: item.received_at ? new Date(item.received_at).toISOString() : null,
      receiptId: item.receipt_id, manifestSha256: item.manifest_sha256,
      summary: item.summary_json ? JSON.parse(item.summary_json) : null,
      identityBinding: 'staff-assignment-not-player-authentication' };
  }
  function assignment(item) {
    return { format: 'ctp-pc-check-assignment/v1', managerOrigin: origin, caseId: item.id,
      playerId: item.player_id, playerAlias: item.player_alias, operatorAlias: item.operator_alias,
      purpose: item.purpose, retentionDays: item.retention_days, allowedScopes: item.allowed_scopes,
      expiresAtUtc: new Date(item.token_expires_at).toISOString() };
  }
  function native(id, accessToken) {
    const item = row(id);
    if(isErasedSubject(db,item.player_id))fail(410,'La recogida de datos de esta cuenta está cerrada por privacidad.');
    if (!TOKEN.test(accessToken || '') || !item.token_hash || !crypto.timingSafeEqual(Buffer.from(digest(accessToken)), Buffer.from(item.token_hash))) fail(401, 'Asignación no válida.');
    active(item);
    if (item.token_expires_at <= now()) fail(410, 'La asignación ha caducado.');
    return item;
  }
  function receipt(item) { return { caseId: item.id, playerId: item.player_id, manifestSha256: item.manifest_sha256, receivedAtUtc: new Date(item.received_at).toISOString(), receiptId: item.receipt_id }; }
  function encryptEvidence(id, sha, value) {
    const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', evidenceKey, nonce);
    cipher.setAAD(Buffer.from(`${id}:${sha}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  }
  function decryptEvidence(item) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', evidenceKey, item.evidence_nonce);
      decipher.setAAD(Buffer.from(`${item.id}:${item.manifest_sha256}`, 'utf8'));
      decipher.setAuthTag(item.evidence_tag);
      return JSON.parse(Buffer.concat([decipher.update(item.evidence_ciphertext), decipher.final()]).toString('utf8'));
    } catch { fail(500, 'No se puede verificar la custodia cifrada de la evidencia.'); }
  }
  return {
    init,
    create(user, input) {
      staff(user); init();
      return privacyWrite(()=>{
      if (!object(input) || !UUID.test(input.playerId || '') || !validScopes(input.allowedScopes) || !Number.isSafeInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 30) fail(400, 'Jugador, alcances o conservación no válidos.');
      if (isErasedSubject(db,input.playerId)) fail(409,'La cuenta tiene un proceso de privacidad; no admite nuevas recogidas de datos.');
      const declaredPlayerAlias = playerAlias(input.playerAlias), purpose = text(input.purpose, 10, 500);
      const operatorAlias = text(user.name || user.username, 1, 80), id = crypto.randomUUID(), created = now();
      db.prepare('INSERT INTO pc_check_cases(id,player_id,player_alias,assigned_operator_id,operator_alias,purpose,retention_days,allowed_scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, input.playerId.toLowerCase(), declaredPlayerAlias, user.id, operatorAlias, purpose, input.retentionDays, input.allowedScopes, created, created + input.retentionDays * 86400000);
      audit('case.created', id, user.id);
      return dto(row(id));
      });
    },
    list(user, query = {}) {
      staff(user);
      if (!object(query) || Object.keys(query).some(key => key !== 'user_id') || (query.user_id !== undefined && (typeof query.user_id !== 'string' || !UUID.test(query.user_id)))) fail(400, 'El filtro de jugador debe ser un UUID CTP válido.');
      const playerId = query.user_id?.toLowerCase() || null;
      init();
      // The player filter narrows the existing owner/reviewer ACL; it never grants access.
      const clauses = ['c.expires_at>?'], values = [now()];
      if (!user.is_admin) {
        clauses.push('(c.assigned_operator_id=? OR EXISTS(SELECT 1 FROM pc_check_case_reviewers r WHERE r.case_id=c.id AND r.user_id=?))');
        values.push(user.id, user.id);
      }
      if (playerId) { clauses.push('c.player_id=?'); values.push(playerId); }
      const items = db.prepare(`SELECT c.* FROM pc_check_cases c WHERE ${clauses.join(' AND ')} ORDER BY c.created_at DESC,c.id LIMIT 100`).all(...values);
      audit('case.listed', null, user.id);
      return { cases: items.map(dto), maximumCases: 100, includesExpired: false, filters: { user_id: playerId } };
    },
    detail(user, id) {
      const item = owned(user, id); audit('case.read', id, user.id);
      const reviews = db.prepare('SELECT id,actor_id AS authorId,actor_alias AS authorAlias,note,created_at AS createdAt FROM pc_check_reviews WHERE case_id=? ORDER BY created_at,id').all(id).map(x => ({ id: x.id, authorId: x.authorId, authorAlias: x.authorAlias, text: x.note, createdAtUtc: new Date(x.createdAt).toISOString() }));
      const assignedReviewers = db.prepare('SELECT r.user_id AS id,u.name,u.username FROM pc_check_case_reviewers r JOIN users u ON u.id=r.user_id WHERE r.case_id=?').all(id).map(r => ({ id:r.id, name:r.name||r.username }));
      return { case: dto(item), reviews, reviewers: assignedReviewers, canAssignReviewers: Boolean(user.is_admin || item.assigned_operator_id === user.id) };
    },
    issue(user, id) {
      return privacyWrite(()=>{
      const item = owned(user, id, true);
      if(isErasedSubject(db,item.player_id))fail(409,'La cuenta tiene un proceso de privacidad; no admite nuevas recogidas de datos.');
      if (item.receipt_id) fail(409, 'La evidencia recibida es inmutable; crea otro expediente para un nuevo check.');
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('UPDATE pc_check_cases SET token_hash=?,token_expires_at=? WHERE id=?').run(digest(token), Math.min(now() + 86400000, item.expires_at), id);
      audit('assignment.issued', id, user.id);
      return { ...assignment(row(id)), accessToken: token };
      });
    },
    authenticateAssignment(id, token) { return assignment(native(id, token)); },
    reviewerCandidates(user) { staff(user); init(); return { reviewers: reviewers().map(x=>({id:x.id,name:x.name||x.username})).slice(0,200) }; },
    assignReviewer(user, id, input) {
      owned(user, id, true);
      if (!Number.isSafeInteger(input?.reviewerId) || input.reviewerId <= 0 || !reviewers().some(x=>x.id === input.reviewerId)) fail(400, 'Revisor activo de arbitraje no válido.');
      if (input.enabled === false) db.prepare('DELETE FROM pc_check_case_reviewers WHERE case_id=? AND user_id=?').run(id,input.reviewerId);
      else db.prepare('INSERT INTO pc_check_case_reviewers(case_id,user_id,assigned_by,assigned_at) VALUES(?,?,?,?) ON CONFLICT(case_id,user_id) DO NOTHING').run(id,input.reviewerId,user.id,now());
      audit(input.enabled === false ? 'reviewer.revoked' : 'reviewer.assigned',id,user.id);
      return { reviewerId:input.reviewerId, enabled:input.enabled !== false };
    },
    getAssignment(id, token) { const item = native(id, token); audit('assignment.read', id); return assignment(item); },
    upload(id, token, input) {
      return privacyWrite(()=>{
      const item = native(id, token);
      const checked = validateUpload(item, input, now());
      if (item.receipt_id) {
        if (item.manifest_sha256 !== checked.manifestSha256 || item.upload_sha256 !== checked.uploadSha256) fail(409, 'El expediente ya contiene otra evidencia inmutable.');
        audit('evidence.retry', id); return receipt(item);
      }
      const receivedAt = now(), receiptId = crypto.randomUUID();
      const encrypted = encryptEvidence(id, checked.manifestSha256, checked.evidence);
      const update = db.prepare('UPDATE pc_check_cases SET receipt_id=?,received_at=?,manifest_sha256=?,upload_sha256=?,summary_json=?,evidence_ciphertext=?,evidence_nonce=?,evidence_tag=? WHERE id=? AND receipt_id IS NULL')
        .run(receiptId, receivedAt, checked.manifestSha256, checked.uploadSha256, JSON.stringify(checked.summary), encrypted.ciphertext, encrypted.nonce, encrypted.tag, id);
      if (update.changes !== 1) {
        const winner = row(id);
        if (winner.manifest_sha256 !== checked.manifestSha256 || winner.upload_sha256 !== checked.uploadSha256) fail(409, 'El expediente ya contiene otra evidencia inmutable.');
        audit('evidence.retry', id); return receipt(winner);
      }
      audit('evidence.received', id);
      return receipt(row(id));
      });
    },
    evidence(user, id) { const item = owned(user, id); if (!item.receipt_id) fail(404, 'Todavía no hay evidencia recibida.'); const evidence = decryptEvidence(item); audit('evidence.read', id, user.id); return { receipt: receipt(item), evidence }; },
    review(user, id, input) {
      const item = owned(user, id);
      if (!item.receipt_id) fail(409, 'Espera a recibir la evidencia antes de añadir una revisión.');
      const note = text(input?.text, 1, 4000), at = now(), reviewId = crypto.randomUUID();
      db.prepare('INSERT INTO pc_check_reviews(id,case_id,actor_id,actor_alias,note,created_at) VALUES(?,?,?,?,?,?)').run(reviewId, id, user.id, text(user.name || user.username, 1, 80), note, at);
      audit('review.added', id, user.id);
      return { id: reviewId, authorId: user.id, authorAlias: user.name || user.username, text: note, createdAtUtc: new Date(at).toISOString() };
    }
  };
}

function validateUpload(item, input, receivedAt) {
  if (!object(input) || input.format !== 'ctp-pc-check-upload/v1' || input.caseId !== item.id || !SHA.test(input.manifestSha256 || '') || !Array.isArray(input.artifacts) || input.artifacts.length < 3 || input.artifacts.length > 12) fail(400, 'Paquete de evidencia no válido.');
  onlyKeys(input,['format','caseId','manifestSha256','artifacts']);
  const files = new Map(); let total = 0;
  for (const artifact of input.artifacts) {
    if (!object(artifact) || !NAMES.has(artifact.name) || files.has(artifact.name) || typeof artifact.base64 !== 'string') fail(400, 'Nombre, duplicado o contenido de artefacto no válido.');
    onlyKeys(artifact,['name','base64']);
    if (artifact.base64.length > Math.ceil((MAX_BYTES - total) / 3) * 4) fail(413, 'La evidencia supera 8 MiB.');
    if (artifact.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/=]*$/.test(artifact.base64)) fail(400, 'Codificación de artefacto no válida.');
    const bytes = Buffer.from(artifact.base64, 'base64');
    if (bytes.toString('base64') !== artifact.base64) fail(400, 'Codificación de artefacto no válida.');
    total += bytes.length;
    if (total > MAX_BYTES) fail(413, 'La evidencia supera 8 MiB.');
    files.set(artifact.name, bytes);
  }
  if (!files.has('manifest.json') || !files.has('consent.json') || !files.has('report.html') || digest(files.get('manifest.json')) !== input.manifestSha256) fail(400, 'No coincide la integridad del manifiesto.');
  const manifest = cleanJson(files.get('manifest.json'));
  onlyKeys(manifest,['format','toolVersion','caseId','createdAtUtc','deleteAfterUtc','state','artifacts','integrityLimitation','syntheticFixture']);
  text(manifest.toolVersion,1,80); text(manifest.integrityLimitation,1,1000);
  if (![manifest.createdAtUtc,manifest.deleteAfterUtc].every(value=>typeof value==='string' && value.length<=64 && Number.isFinite(Date.parse(value))) || (Object.hasOwn(manifest,'syntheticFixture') && typeof manifest.syntheticFixture !== 'boolean')) fail(400,'Metadatos del manifiesto no válidos.');
  if (manifest.format !== 'ctp-pc-check-evidence/v1' || manifest.caseId !== item.id || !STATUSES.has(manifest.state) || !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== files.size - 1) fail(400, 'Manifiesto o identidad no válidos.');
  const listed = new Set();
  for (const artifact of manifest.artifacts) {
    onlyKeys(artifact,['name','bytes','sha256']);
    if (!object(artifact) || artifact.name === 'manifest.json' || !NAMES.has(artifact.name) || listed.has(artifact.name) || !files.has(artifact.name) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes !== files.get(artifact.name).length || !SHA.test(artifact.sha256 || '') || artifact.sha256 !== digest(files.get(artifact.name))) fail(400, 'Artefactos modificados, ausentes o no permitidos.');
    listed.add(artifact.name);
  }
  const consent = cleanJson(files.get('consent.json')), request = consent.request;
  onlyKeys(consent,['policyVersion','acceptedAtUtc','request','acknowledgedBy','playerPresent','understandsLimits','authorizesSelectedScopes','agreesLocalEvidenceStorage','agreesManagerUpload']);
  onlyKeys(request,REQUEST_KEYS);
  text(request.locale,2,16);
  if (!object(request) || request.caseId !== item.id || request.managerCaseId !== item.id || request.playerId !== item.player_id || request.playerAlias !== item.player_alias || request.operatorAlias !== item.operator_alias || request.purpose !== item.purpose || request.retentionDays !== item.retention_days || request.uploadToManager !== true || consent.agreesManagerUpload !== true) fail(400, 'El consentimiento no corresponde a la asignación del servidor.');
  const scopes = scopeMask(request.scopes);
  const acknowledgedBy = playerAlias(consent.acknowledgedBy);
  if (!validScopes(scopes) || (scopes & item.allowed_scopes) !== scopes || !POLICIES.has(consent.policyVersion) || coreTrim(acknowledgedBy) !== coreTrim(item.player_alias) || !['playerPresent', 'understandsLimits', 'authorizesSelectedScopes', 'agreesLocalEvidenceStorage'].every(k => consent[k] === true)) fail(400, 'Consentimiento o alcances no autorizados.');
  const gameContext = declaredGameContext(request, consent.policyVersion);
  const acceptedAt = Date.parse(consent.acceptedAtUtc);
  if (!Number.isFinite(acceptedAt) || acceptedAt < item.created_at || acceptedAt > receivedAt + 60000) fail(400, 'Fecha de consentimiento no válida.');
  if (!Array.isArray(request.gameProcessIds) || request.gameProcessIds.length > 3 || request.gameProcessIds.some(p => !integer(p,2147483647) || p === 0) || new Set(request.gameProcessIds).size !== request.gameProcessIds.length || ((scopes & 64) && request.gameProcessIds.length === 0)) fail(400, 'Objetivos del consentimiento no válidos.');
  const collectors = [], targetTicks = new Map();
  if (files.has('targets.json')) {
    if (!(scopes & 8)) fail(400, 'Objetivos fuera de los alcances consentidos.');
    const bytes = files.get('targets.json');
    if (bytes.length > 4096) fail(400, 'Objetivos no válidos.');
    const targets = cleanJson(bytes), entries = Object.entries(targets);
    const rawNumbers = [...bytes.toString('utf8').matchAll(/"([1-9][0-9]{0,9})"\s*:\s*(0|[1-9][0-9]{0,18})(?=\s*[,}])/g)];
    if (entries.length > 3 || rawNumbers.length !== entries.length || entries.some(([pid,ticks])=>!request.gameProcessIds.includes(Number(pid)) || !/^[1-9][0-9]{0,9}$/.test(pid) || !Number.isFinite(ticks) || !Number.isInteger(ticks) || ticks < 0) || rawNumbers.some(match=>BigInt(match[2]) > 3155378975999999999n)) fail(400, 'Objetivos fuera de los PID consentidos o valores no válidos.');
    for (const match of rawNumbers) targetTicks.set(Number(match[1]),BigInt(match[2]));
  }
  if (request.gameProcessIds.length && !files.has('targets.json')) fail(400, 'Falta la identidad temporal de los objetivos.');
  for (const [id, scope] of Object.entries(COLLECTORS)) {
    const name = `${id}.json`, selected = (scopes & scope) === scope;
    if (files.has(name) !== selected) fail(400, 'La cobertura no coincide con los alcances consentidos.');
    if (!selected) continue;
    const result = cleanJson(files.get(name));
    onlyKeys(result,['collectorId','status','startedAtUtc','completedAtUtc','data','findings','limitations','truncated']);
    if (![result.startedAtUtc,result.completedAtUtc].every(value=>typeof value==='string' && value.length<=64 && Number.isFinite(Date.parse(value)))) fail(400,'Fechas del collector no válidas.');
    if (result.collectorId !== id || !STATUSES.has(result.status) || !object(result.data) || !Array.isArray(result.findings) || result.findings.length > 100 || !Array.isArray(result.limitations) || result.limitations.length > 100 || result.limitations.some(x => typeof x !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(x)) || typeof result.truncated !== 'boolean') fail(400, 'Contrato de collector no válido.');
    result.findings.forEach(f => {
      onlyKeys(f,['code','level','explanationKey','facts']);
      const allowed = [FINDINGS[id],id === 'hardware' ? DRIVER_FINDING : null].find(rule=>rule?.[0]===f.code);
      if (!object(f) || !allowed || f.code !== allowed[0] || f.level !== 'review' || f.explanationKey !== allowed[1]) fail(400, 'Hallazgo no válido; no se aceptan veredictos.');
      if (f.facts != null && (!object(f.facts) || Object.keys(f.facts).some(k=>!['pid','count'].includes(k)) || Object.values(f.facts).some(v=>typeof v!=='string'||!/^\d{1,12}$/.test(v)))) fail(400, 'Hechos de hallazgo fuera del protocolo.');
      if (f.facts?.pid != null && !request.gameProcessIds.includes(Number(f.facts.pid))) fail(400,'PID de hallazgo fuera del consentimiento.');
    });
    assertPrivacy(id, result.data, scopes);
    assertDataSchema(id, result.data, request.gameProcessIds, {policy:consent.policyVersion,targetTicks,completedAtUtc:result.completedAtUtc});
    const findingRule = FINDINGS[id];
    const count = id === 'memory' ? (result.data.targets || []).reduce((sum,target)=>sum+(Number.isSafeInteger(target.privateExecutableRegions)?target.privateExecutableRegions:0),0) : findingRule ? result.data[findingRule[2]] ?? 0 : 0;
    if (findingRule && (!Number.isSafeInteger(count) || count < 0 || count > findingRule[3])) fail(400, 'Contador de revisión no válido.');
    // Summary does not trust a client-supplied verdict, title or findings list. It derives known review
    // signals from bounded source counts; the source remains untrusted evidence for a human reviewer.
    const findings = findingRule && count > 0 ? [{code:findingRule[0],level:'review',explanationKey:findingRule[1],count,facts:{count:String(count)}}] : [];
    const catalogue = id === 'hardware' && result.data.driverCatalogue ? checkedDriverCatalogue(result.data) : null;
    if (catalogue?.matchCount) findings.push({code:DRIVER_FINDING[0],level:'review',explanationKey:DRIVER_FINDING[1],count:catalogue.matchCount,facts:{count:String(catalogue.matchCount)}});
    const fileIdentities = id === 'hardware' ? (result.data.systemDrivers || []).flatMap(row=>row.fileIdentity?[row.fileIdentity]:[]) : id === 'processes' ? [...(result.data.processes || []).flatMap(row=>row.fileIdentity?[row.fileIdentity]:[]),...(result.data.selectedGameModules || []).flatMap(target=>target.modules.flatMap(row=>row.fileIdentity?[row.fileIdentity]:[]))] : [];
    const fileIdentitySummary = fileIdentities.length ? {recordCount:fileIdentities.length,completeFiles:fileIdentities.filter(row=>row.status==='complete').length,partialFiles:fileIdentities.filter(row=>row.status==='partial').length,unavailableFiles:fileIdentities.filter(row=>row.status==='unavailable').length,notCollectedFiles:fileIdentities.filter(row=>row.status==='not-collected').length,source:'untrusted-collector-file-metadata'} : null;
    const eventLinks = result.data.gameEventLinks || [];
    const gameEventLinkSummary = id === 'events' && result.data.gameEventLinkCoverage ? { ...result.data.gameEventLinkCoverage, relationCounts:Object.fromEntries(['image-load','remote-thread-target','process-access-target','image-tampering'].map(relation=>[relation,eventLinks.filter(row=>row.relation===relation).length])),assessment:'event-correlation-not-cheating-verdict' } : null;
    collectors.push({ id, status: result.status, truncated: result.truncated, limitations: result.limitations, findings,
      ...(fileIdentitySummary?{fileIdentitySummary}:{}),...(result.data.fileIdentityCoverage?{fileIdentityCoverage:result.data.fileIdentityCoverage}:{}),...(catalogue?{driverCatalogue:catalogue}:{}),...(gameEventLinkSummary?{gameEventLinkSummary}:{} ) });
  }
  const partial = collectors.some(c => c.status !== 'complete' || c.truncated);
  const summary = { state: manifest.state === 'cancelled' ? 'cancelled' : manifest.state === 'failed' ? 'failed' : partial || manifest.state !== 'complete' ? 'partial' : 'complete', collectors,
    reviewFlagCount: collectors.reduce((n, c) => n + c.findings.filter(f => f.level === 'review').length, 0),
    assessment: 'evidence-for-human-review-not-cheating-verdict',
    identityBinding: 'staff-assignment-not-player-authentication', gameContext, syntheticFixture: manifest.syntheticFixture === true };
  const uploadSha256 = digest([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${name}:${bytes.length}:${digest(bytes)}`).join('\n'));
  // Preserve every original byte, including HTML as inert base64. Parsing is only for validation and
  // summary derivation: rewriting JSON would invalidate hashes and round large .NET tick integers.
  return { manifestSha256: input.manifestSha256, uploadSha256, summary, evidence: {
    format: 'ctp-pc-check-stored-raw/v1', artifacts: [...files].map(([name, bytes])=>({name,base64:bytes.toString('base64')})),
    htmlExecution: 'never-rendered-stored-as-base64-only'
  } };
}

function assertPrivacy(id, data, scopes) {
  if (Object.keys(data).some(k => !DATA_KEYS[id].includes(k))) fail(400, 'El collector contiene campos fuera del protocolo de evidencia.');
  for (const key of DATA_ARRAYS[id]) if (Object.hasOwn(data,key) && (!Array.isArray(data[key]) || data[key].some(x=>!object(x)))) fail(400, 'Estructura de collector no válida.');
  let visited = 0;
  function inspect(value, depth = 0) {
    if (++visited > 40000 || depth > 12) fail(400, 'Evidencia demasiado compleja.');
    if (typeof value === 'string' && value.length > 2000) fail(400, 'Campo de evidencia demasiado largo.');
    if (Array.isArray(value)) { if (value.length > 1200) fail(400, 'Lista de evidencia demasiado larga.'); for (const child of value) inspect(child, depth + 1); }
    else if (object(value)) for (const [name, child] of Object.entries(value)) {
      if (/^(?:password|secret|accessToken|refreshToken|environment|commandLine|eventData|userData|message|payload|bytes|rawMemory)$/i.test(name)) fail(400, 'La evidencia contiene campos no permitidos.');
      inspect(child, depth + 1);
    }
  }
  inspect(data);
  const pseudonym = x => x === null || (typeof x === 'string' && /^case-hmac:[0-9a-f]{64}$/.test(x));
  if (id === 'hardware' && !(scopes & 128)) {
    for (const [group, fields] of [['baseboards', ['serial']], ['bios', ['serial']], ['systems', ['identifyingNumber', 'uuid']], ['pnpDevices', ['instanceId']], ['drivers', ['deviceId']]])
      for (const item of data[group] || []) for (const field of fields) if (!pseudonym(item[field])) fail(400, 'Identificadores de hardware fuera del consentimiento.');
  }
  if (id === 'network' && !(scopes & 256))
    for (const endpoint of [...(data.tcp || []), ...(data.udp || [])])
      for (const field of ['localAddress', 'remoteAddress']) if (Object.hasOwn(endpoint, field) && !pseudonym(endpoint[field])) fail(400, 'Direcciones de red fuera del consentimiento.');
  for (const flag of ['commandLinesCollected', 'scriptContentsCollected', 'processMemoryBytesCollected', 'eventMessagesCollected', 'packetContentsCollected', 'dnsQueriesCollected', 'protectedProcessesBypassed', 'debugPrivilegeEnabled', 'driverInstalled'])
    if (Object.hasOwn(data,flag) && data[flag] !== false) fail(400, 'El paquete declara una recogida no permitida por este protocolo.');
  if ((Object.hasOwn(data,'memoryBytesRead') && data.memoryBytesRead !== 0) || Object.entries(data).some(([k,v])=>/CheatingProof$/.test(k)&&v!==false)) fail(400, 'El protocolo no admite dumps de memoria ni declaraciones de culpabilidad.');
}

function assertFileIdentity(value) {
  const keys = ['status','reason','sha256','sizeBytes','fileVersion','productVersion','productName','companyName','peMetadataSource','signatureStatus','signaturePolicy','hashCoverage'];
  onlyKeys(value,keys);
  if (keys.some(key=>!Object.hasOwn(value,key)) || !['complete','partial','unavailable','not-collected'].includes(value.status) || !['full-file','not-complete'].includes(value.hashCoverage) || !['not-inspected','ValidCachedPolicy','NotSigned','HashMismatch','NotTrustedOrCacheUnavailable'].includes(value.signatureStatus) || value.peMetadataSource !== 'self-declared-version-resource' || value.signaturePolicy !== 'winverifytrust-cache-only-no-url-retrieval-local-trust-policy' || (value.reason !== null && !FILE_REASONS.has(value.reason))) fail(400,'Identidad de archivo fuera del protocolo.');
  for (const key of ['fileVersion','productVersion','productName','companyName']) if (value[key] != null) text(value[key],0,200);
  if ((value.sha256 != null && !SHA.test(value.sha256)) || (value.sizeBytes != null && !integer(value.sizeBytes))) fail(400,'Hash o tamaño de archivo no válido.');
  if (value.status === 'complete' && (value.hashCoverage !== 'full-file' || !SHA.test(value.sha256 || '') || !integer(value.sizeBytes))) fail(400,'La identidad completa exige hash del archivo completo y tamaño.');
  if (value.hashCoverage === 'full-file' && !SHA.test(value.sha256 || '')) fail(400,'Cobertura de hash incoherente.');
}

function assertFileCoverage(value) {
  onlyKeys(value,['maximumFiles','maximumBytes','maximumFileSeconds','maximumIdentitySeconds','attemptedFiles','completedFiles','unavailableFiles','notCollectedFiles','bytesRead','elapsedSeconds','limitReached','byteAccounting']);
  if (value.maximumFiles !== 128 || value.maximumBytes !== 134217728 || value.maximumFileSeconds !== 6 || value.maximumIdentitySeconds !== 12 || !integer(value.attemptedFiles,128) || !integer(value.completedFiles,value.attemptedFiles) || !integer(value.unavailableFiles,value.attemptedFiles) || !integer(value.notCollectedFiles,2048) || !integer(value.bytesRead,134217728) || !Number.isFinite(value.elapsedSeconds) || value.elapsedSeconds < 0 || value.elapsedSeconds > 3600 || typeof value.limitReached !== 'boolean' || value.byteAccounting !== 'sha256-stream-only-native-trust-and-version-io-not-measured') fail(400,'Cobertura de identidad de archivos no válida.');
}

function assertDataSchema(id, data, gamePids, context) {
  const pseudonym = value => value === null || (typeof value === 'string' && /^case-hmac:[0-9a-f]{64}$/.test(value));
  const objects = {hardware:['fileIdentityCoverage','driverCatalogue'],security:['defender','deviceGuard','codeIntegrity'],processes:['fileIdentityCoverage'],events:['gameEventLinks','gameEventLinkCoverage']};
  for (const [key,value] of Object.entries(data)) if (!DATA_ARRAYS[id].includes(key) && !(objects[id] || []).includes(key) && (object(value) || Array.isArray(value))) fail(400,'Campo de collector fuera del esquema filtrado.');
  for (const [group,keys] of Object.entries(ROW_KEYS[id])) for (const row of data[group] || []) {
    onlyKeys(row,keys);
    for (const [key,value] of Object.entries(row)) {
      if (key === 'fileIdentity') { if (context.policy.endsWith('.2')) fail(400,'La identidad ampliada de archivo exige el consentimiento .3.'); assertFileIdentity(value); continue; }
      if ((id === 'processes' && group === 'selectedGameModules' && key === 'modules') || (id === 'memory' && key === 'reviewRegions')) continue;
      if (['executables','modules','selectedEventIds'].includes(key)) {
        if (!Array.isArray(value) || value.length > (key === 'modules' ? 64 : key === 'executables' ? 8 : 32) || value.some(child => object(child) || Array.isArray(child))) fail(400,'Lista anidada fuera del protocolo.');
      } else if (object(value) || Array.isArray(value)) fail(400,'Campo anidado fuera del protocolo.');
    }
  }
  if (data.fileIdentityCoverage != null) { if (context.policy.endsWith('.2')) fail(400,'La identidad ampliada de archivo exige el consentimiento .3.'); assertFileCoverage(data.fileIdentityCoverage); }
  if (id === 'hardware' && data.driverCatalogue != null) {
    if (context.policy.endsWith('.2')) fail(400,'El catálogo ampliado exige el consentimiento .3.');
    checkedDriverCatalogue(data);
  }
  if (id === 'hardware' && ((data.baseboards?.length || 0) > 8 || (data.bios?.length || 0) > 8 || (data.systems?.length || 0) > 8 || (data.pnpDevices?.length || 0) > 512 || (data.drivers?.length || 0) > 512 || (data.systemDrivers?.length || 0) > 256)) fail(400,'Inventario de hardware demasiado grande.');
  if (id === 'security') {
    for (const [key,keys] of [['defender',['amServiceEnabled','antivirusEnabled','realtimeProtectionEnabled','behaviorMonitorEnabled','ioavProtectionEnabled','nisEnabled','signatureUpdatedAtUtc']],['deviceGuard',['availableSecurityProperties','servicesConfigured','servicesRunning','vbsStatus','dmaProtectionHardwareAvailable','dmaEnforcement']],['codeIntegrity',['memoryIntegrityRegistryConfigured','effectivePolicy']]]) if (data[key] != null) {
      onlyKeys(data[key],keys);
      for (const [field,value] of Object.entries(data[key])) {
        if (key === 'deviceGuard' && ['availableSecurityProperties','servicesConfigured','servicesRunning'].includes(field)) {
          if (!Array.isArray(value) || value.length > 16 || value.some(n=>!integer(n,65535))) fail(400,'Propiedades DeviceGuard no válidas.');
        } else if (object(value) || Array.isArray(value)) fail(400,'Estado de seguridad fuera del protocolo.');
      }
    }
  }
  if (id === 'persistence') {
    for (const row of data.scheduledTasks || []) if (!pseudonym(row.folderPseudonym)) fail(400,'La carpeta de tarea exige pseudónimo.');
    if ((data.autoruns?.length || 0) > 256 || (data.services?.length || 0) > 500 || (data.scheduledTasks?.length || 0) > 500 || (data.imageExecutionOptions?.length || 0) > 256 || (data.appInit?.length || 0) > 2 || (data.winlogon?.length || 0) > 4) fail(400,'Inventario de persistencia demasiado grande.');
  }
  if (id === 'processes') {
    if ((Object.hasOwn(data,'maximumExecutableFiles') && data.maximumExecutableFiles !== 64) || (Object.hasOwn(data,'prioritizedGameExecutables') && data.prioritizedGameExecutables !== true)) fail(400,'Priorización de ejecutables fuera del protocolo.');
    if ((data.processes?.length || 0) > 1000) fail(400,'Inventario de procesos demasiado grande.');
    for (const process of data.processes || []) if (!integer(process.pid,2147483647)) fail(400,'PID de proceso no válido.');
    const selected = data.selectedGameModules || [];
    if (selected.length > 3 || new Set(selected.map(row=>row.pid)).size !== selected.length) fail(400,'Objetivos duplicados o fuera de límite.');
    let modules = 0;
    for (const target of selected) {
      if (!gamePids.includes(target.pid) || !['available','unavailable'].includes(target.coverage) || !Array.isArray(target.modules)) fail(400,'Módulos fuera de los PID consentidos.');
      if (target.coverage === 'available' && !(context.targetTicks.get(target.pid) > 0n)) fail(400,'No hay identidad temporal para los módulos declarados disponibles.');
      modules += target.modules.length;
      for (const module of target.modules) {
        onlyKeys(module,['name','path','sizeBytes','sha256','signatureStatus','fileIdentity']);
        if ((module.sha256 != null && !SHA.test(module.sha256)) || (module.sizeBytes != null && !integer(module.sizeBytes)) || !SIGNATURES.has(module.signatureStatus)) fail(400,'Metadatos de módulo no válidos.');
        if (module.fileIdentity != null) {
          if (context.policy.endsWith('.2')) fail(400,'La identidad ampliada de archivo exige el consentimiento .3.');
          assertFileIdentity(module.fileIdentity);
          if (['sha256','sizeBytes','signatureStatus'].some(key=>module[key] !== module.fileIdentity[key])) fail(400,'Las proyecciones de identidad del módulo no coinciden.');
        }
        for (const [key,value] of Object.entries(module)) if (key !== 'fileIdentity' && (object(value) || Array.isArray(value))) fail(400,'Metadatos de módulo fuera del protocolo.');
      }
      if (target.coverage !== 'available' && target.modules.length) fail(400,'Un objetivo no disponible no puede declarar módulos inspeccionados.');
    }
    if (modules > 256) fail(400,'Demasiados módulos para los objetivos elegidos.');
  }
  if (id === 'network') {
    if ((data.tcp?.length || 0) + (data.udp?.length || 0) > 1000 || (data.interfaceCounterDeltas?.length || 0) > 32) fail(400,'Inventario de red demasiado grande.');
    for (const row of data.interfaceCounterDeltas || []) if (!pseudonym(row.adapterPseudonym)) fail(400,'El adaptador de red exige pseudónimo.');
    for (const row of [...(data.tcp || []),...(data.udp || [])]) if (!integer(row.pid,2147483647) || !integer(row.localPort,65535) || (Object.hasOwn(row,'remotePort') && !integer(row.remotePort,65535))) fail(400,'Metadatos de endpoint no válidos.');
  }
  if (id === 'events' && ((data.sources?.length || 0) > 3 || (data.events?.length || 0) > 200 || (data.returnedCounts?.length || 0) > 200)) fail(400,'Demasiados eventos de seguridad.');
  if (id === 'events') assertGameEventLinks(data,gamePids,context);
  if (id === 'memory') {
    const targets = data.targets || [];
    if (targets.length > 3 || new Set(targets.map(row=>row.pid)).size !== targets.length) fail(400,'Objetivos de memoria duplicados o fuera de límite.');
    for (const target of targets) {
      if (!gamePids.includes(target.pid)) fail(400,'Metadatos de memoria fuera de los PID consentidos.');
      if (!['unknown-identity-not-captured-at-consent','unknown-access-denied-or-exited','unknown-identity-mismatch-not-inspected','address-space-end-observed','unknown-time-budget','unknown-query-failed','unknown-invalid-region-size','unknown-region-query-limit'].includes(target.coverage)) fail(400,'Cobertura de memoria fuera del protocolo.');
      if ((target.regionQueries || target.privateExecutableRegions || target.reviewRegions?.length) && !(context.targetTicks.get(target.pid) > 0n)) fail(400,'No hay identidad temporal para las regiones inspeccionadas.');
      for (const key of ['regionQueries','committedRegions','privateExecutableRegions']) if (Object.hasOwn(target,key) && !integer(target[key],5000)) fail(400,'Contador de regiones no válido.');
      if (Object.hasOwn(target,'committedBytesRepresentedByMetadata') && !integer(target.committedBytesRepresentedByMetadata)) fail(400,'Tamaño de regiones no válido.');
      if (target.reviewRegions != null) {
        if (!Array.isArray(target.reviewRegions) || target.reviewRegions.length > 256) fail(400,'Demasiadas regiones de revisión.');
        for (const region of target.reviewRegions) {
          onlyKeys(region,['addressPseudonym','regionBytes','protection','allocationProtection','state','type']);
          if (!pseudonym(region.addressPseudonym) || region.addressPseudonym === null || !integer(region.regionBytes) || !/^0x[0-9A-Fa-f]{8}$/.test(region.protection || '') || !/^0x[0-9A-Fa-f]{8}$/.test(region.allocationProtection || '') || region.state !== 'committed' || region.type !== 'private') fail(400,'Región de memoria fuera del protocolo de metadatos.');
        }
      }
    }
  }
}

function checkedDriverCatalogue(data) {
  const value = data.driverCatalogue;
  onlyKeys(value,['id','revision','license','matchType','entryCount','matches','matchCount','assessment']);
  if (value.id !== DRIVER_CATALOGUE.id || value.revision !== DRIVER_CATALOGUE.revision || value.license !== DRIVER_CATALOGUE.license || value.matchType !== 'sha256-file' || value.entryCount !== DRIVER_CATALOGUE.entries.length || value.assessment !== 'component-risk-not-cheating-verdict' || !Array.isArray(value.matches) || value.matches.length > 256) fail(400,'Catálogo de drivers no válido.');
  const matches = [];
  for (const [driverIndex,driver] of (data.systemDrivers || []).entries()) {
    const identity = driver.fileIdentity;
    if (identity?.status !== 'complete' || identity.hashCoverage !== 'full-file') continue;
    const entry = DRIVER_CATALOGUE.entries.find(entry=>entry.sha256 === identity.sha256);
    if (entry) matches.push({driverIndex,entryId:entry.entryId,sha256:entry.sha256,category:entry.category,family:entry.family,
      sourceUrl:`https://github.com/magicsword-io/LOLDrivers/blob/${DRIVER_CATALOGUE.revision}/yaml/${entry.entryId}.yaml`});
  }
  if (value.matchCount !== matches.length || value.matches.length !== matches.length) fail(400,'No coinciden las coincidencias del catálogo con los hashes aportados.');
  for (const [index,match] of value.matches.entries()) {
    onlyKeys(match,['driverIndex','entryId','sha256','category','family','sourceUrl']);
    if (Object.keys(matches[index]).some(key=>match[key] !== matches[index][key])) fail(400,'Coincidencia del catálogo alterada o no respaldada por identidad de archivo.');
  }
  return {id:DRIVER_CATALOGUE.id,revision:DRIVER_CATALOGUE.revision,license:DRIVER_CATALOGUE.license,matchType:'sha256-file',entryCount:DRIVER_CATALOGUE.entries.length,matchCount:matches.length,matches,assessment:'component-risk-not-cheating-verdict',derivation:'server-match-of-untrusted-collector-sha256'};
}

function assertGameEventLinks(data, gamePids, {policy,targetTicks,completedAtUtc}) {
  const links = data.gameEventLinks ?? [];
  if (!Array.isArray(links) || links.length > 80 || (policy.endsWith('.2') && (links.length || data.eventDataCollected === true))) fail(400,'La correlación de eventos exige el consentimiento .3 y límites válidos.');
  if ((Object.hasOwn(data,'eventDataCollected') && data.eventDataCollected !== (links.length > 0)) || (links.length > 0 && data.eventDataCollected !== true)) fail(400,'La declaración de proyección de eventos no coincide con sus enlaces.');
  if (data.gameEventLinkCoverage != null) {
    const coverage = data.gameEventLinkCoverage;
    onlyKeys(coverage,['maximumLinks','returnedLinks','examinedSysmonRecords','selectedGamePids','status','identityPolicy','historicalProcessIdentityAttested','rawEventDataStored']);
    if (coverage.maximumLinks !== 80 || coverage.returnedLinks !== links.length || !integer(coverage.examinedSysmonRecords,100) || coverage.selectedGamePids !== gamePids.length || !['available','not-selected','unavailable','partial'].includes(coverage.status) || coverage.identityPolicy !== 'pid-and-creation-window-with-case-hmac-guids' || coverage.historicalProcessIdentityAttested !== false || coverage.rawEventDataStored !== false || (links.length && !['available','partial'].includes(coverage.status)) || (!gamePids.length && coverage.status !== 'not-selected')) fail(400,'Cobertura de correlación de eventos no válida.');
  } else if (links.length) fail(400,'Falta la cobertura de los enlaces de eventos.');
  const pseudonym = value => value === null || (typeof value === 'string' && /^case-hmac:[0-9a-f]{64}$/.test(value));
  const relations = {7:'image-load',8:'remote-thread-target',10:'process-access-target',25:'image-tampering'};
  const completed = utcTicks(completedAtUtc), until = data.windowUntilUtc ? utcTicks(data.windowUntilUtc) : completed;
  const from = data.windowFromUtc ? utcTicks(data.windowFromUtc) : null;
  for (const link of links) {
    onlyKeys(link,['eventId','atUtc','gamePid','gameStartedAtUtc','relation','sourcePid','sourceProcessKey','gameProcessKey','sourceExecutable','modulePath','grantedAccess']);
    if (!integer(link.eventId,25) || !Object.hasOwn(relations,link.eventId) || relations[link.eventId] !== link.relation || !gamePids.includes(link.gamePid) || !targetTicks.has(link.gamePid) || targetTicks.get(link.gamePid) <= 0n || !pseudonym(link.sourceProcessKey) || !pseudonym(link.gameProcessKey) || (link.sourcePid !== null && (!integer(link.sourcePid,2147483647) || link.sourcePid === 0))) fail(400,'Enlace de evento fuera de identidad o campos permitidos.');
    const started = utcTicks(link.gameStartedAtUtc), at = utcTicks(link.atUtc);
    if (started !== targetTicks.get(link.gamePid) || at < started || at > completed + 10000000n || at > until + 10000000n || (from !== null && at < from)) fail(400,'El evento no corresponde a la ventana temporal del proceso elegido.');
    for (const key of ['sourceExecutable','modulePath']) if (link[key] !== null) {
      text(link[key],1,2000);
      // NormalPath replaces only the user directory with this literal marker. Accept that
      // projection without allowing other angle brackets or an unredacted path metacharacter.
      const checkedPath = link[key].replace(/^([A-Za-z]:\\(?:Users|Documents and Settings)\\)<user>(?=\\|$)/i,'$1user');
      if (/^\\\\|^[a-z][a-z0-9+.-]*:\/\//i.test(link[key]) || /["<>|]/.test(checkedPath)) fail(400,'Ruta de evento fuera del protocolo local.');
    }
    if ((link.eventId !== 7 && link.modulePath !== null) || (![8,10].includes(link.eventId) && (link.sourcePid !== null || link.sourceProcessKey !== null || link.sourceExecutable !== null)) || (link.grantedAccess !== null && (link.eventId !== 10 || !/^0x[0-9a-fA-F]{1,8}$/.test(link.grantedAccess)))) fail(400,'Campos incompatibles con el tipo de evento.');
  }
}
