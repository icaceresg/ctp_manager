import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createPcCheckStore } from '../server/pc-check.js';
import { createPcCheckRouters } from '../server/pc-check-http.js';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const owner={id:1,name:'Árbitro fixture',username:'ref-one',is_admin:false,sections:['arbitraje']};
const other={id:2,name:'Otro árbitro fixture',username:'ref-two',is_admin:false,sections:['arbitraje']};
const admin={id:3,name:'Admin fixture',username:'admin',is_admin:true,sections:[]};
const playerId='77777777-7777-4777-8777-777777777777';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture({configured=true,live=false}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,username TEXT); INSERT INTO users VALUES(1,\'Árbitro fixture\',\'ref-one\'),(2,\'Otro árbitro fixture\',\'ref-two\'),(3,\'Admin fixture\',\'admin\');');
  let at=Date.UTC(2026,9,26,2,0,0);
  const key=crypto.randomBytes(32);
  const store=createPcCheckStore(db,{origin:live?'https://manager.playctp.com':'http://localhost:3210',now:()=>live?Date.now():at,key:configured?key:undefined,reviewers:()=>[owner,other,admin]});
  return {db,store,key,advance:milliseconds=>at+=milliseconds,close:()=>db.close()};
}
function create(store,allowedScopes=511,playerAlias='Jugador fixture') { return store.create(owner,{playerId,playerAlias,purpose:'Revisión consentida de prueba sintética',retentionDays:7,allowedScopes}); }
function packageFor(item,{scopes=1,state='complete',data={},status='complete',rawFiles={},consentPatch={},requestPatch={},collectors={},manifestPatch={}}={}) {
  const consent={policyVersion:'ctp-pc-check/2026-10-26.2',acceptedAtUtc:item.createdAtUtc,request:{caseId:item.id,operatorAlias:item.operatorAlias,playerAlias:item.playerAlias,purpose:item.purpose,locale:'es',scopes,gameProcessIds:[],retentionDays:item.retentionDays,playerId:item.playerId,managerCaseId:item.id,uploadToManager:true,...requestPatch},acknowledgedBy:item.playerAlias,playerPresent:true,understandsLimits:true,authorizesSelectedScopes:true,agreesLocalEvidenceStorage:true,agreesManagerUpload:true,...consentPatch};
  const files=new Map([['consent.json',Buffer.from(JSON.stringify(consent))],['report.html',Buffer.from('<!doctype html><title>FIXTURE SINTÉTICA</title>')]]);
  for(const [id,bit] of Object.entries({hardware:1,security:2,persistence:4,processes:8,network:16,events:32,memory:72})) if((scopes&bit)===bit) files.set(`${id}.json`,Buffer.from(JSON.stringify({collectorId:id,status,startedAtUtc:item.createdAtUtc,completedAtUtc:item.createdAtUtc,data,findings:[],limitations:[],truncated:false,...collectors[id]})));
  for(const [name,bytes] of Object.entries(rawFiles)) files.set(name,Buffer.isBuffer(bytes)?bytes:Buffer.from(JSON.stringify(bytes)));
  const manifest={format:'ctp-pc-check-evidence/v1',toolVersion:'0.1.0',caseId:item.id,createdAtUtc:item.createdAtUtc,deleteAfterUtc:item.expiresAtUtc,state,syntheticFixture:true,integrityLimitation:'Synthetic validation only; local hashes are not a trusted signature.',artifacts:[...files].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha(bytes)})),...manifestPatch};
  files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
  return {format:'ctp-pc-check-upload/v1',caseId:item.id,manifestSha256:sha(files.get('manifest.json')),artifacts:[...files].map(([name,bytes])=>({name,base64:bytes.toString('base64')}))};
}
const gameTitle='Call of Duty: Modern Warfare 4';
const currentConsent={policyVersion:'ctp-pc-check/2026-10-26.3'};
const currentRequest={gameTitle,gameDistribution:'xbox-pc',gameBuildLabel:null};
const catalogue=JSON.parse(fs.readFileSync(new URL('../server/pc-check-vulnerable-drivers.catalog.json',import.meta.url),'utf8'));
function fileIdentity(patch={}) { return {status:'complete',reason:null,sha256:catalogue.entries[0].sha256,sizeBytes:4096,fileVersion:'1.0',productVersion:'1.0',productName:'Synthetic driver',companyName:'Synthetic fixture',peMetadataSource:'self-declared-version-resource',signatureStatus:'ValidCachedPolicy',signaturePolicy:'winverifytrust-cache-only-no-url-retrieval-local-trust-policy',hashCoverage:'full-file',...patch}; }
function catalogueData(drivers,entries=[]) { return {systemDrivers:drivers,driverCatalogue:{id:catalogue.id,revision:catalogue.revision,license:catalogue.license,matchType:'sha256-file',entryCount:6,matches:entries.map(([driverIndex,entry])=>({driverIndex,...entry,sourceUrl:`https://github.com/magicsword-io/LOLDrivers/blob/${catalogue.revision}/yaml/${entry.entryId}.yaml`})),matchCount:entries.length,assessment:'component-risk-not-cheating-verdict'}}; }

test('MW4 context is strictly typed, declared rather than attested, and absent legacy context stays unknown',t=>{
  const f=fixture();t.after(f.close);
  const legacy=create(f.store),old=f.store.issue(owner,legacy.id);
  f.store.upload(legacy.id,old.accessToken,packageFor(legacy));
  const unknown=f.store.detail(owner,legacy.id).case.summary.gameContext;
  assert.equal(unknown.title,null);assert.equal(unknown.legacyContextMissing,true);
  const item=create(f.store),assignment=f.store.issue(owner,item.id);
  for(const requestPatch of [{...currentRequest,gameTitle:'Call of Duty: Black Ops 7'},{...currentRequest,gameDistribution:'game-pass'},{...currentRequest,gameBuildLabel:'x'.repeat(81)},{...currentRequest,gameBuildLabel:'bad\nlabel'},{}]) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{consentPatch:currentConsent,requestPatch})),{status:400});
  f.store.upload(item.id,assignment.accessToken,packageFor(item,{consentPatch:currentConsent,requestPatch:{...currentRequest,gameBuildLabel:'operador: versión observada'}}));
  const context=f.store.detail(owner,item.id).case.summary.gameContext;
  assert.deepEqual(context,{title:gameTitle,distribution:'xbox-pc',buildLabel:'operador: versión observada',source:'operator-declared-not-game-attestation',legacyContextMissing:false});
});

test('player acknowledgement follows Core Trim while assignment aliases and evidence remain literal',t=>{
  const f=fixture();t.after(f.close);
  for(const alias of ['   ','\u00a0  ','\u0085Jugador']) assert.throws(()=>create(f.store,1,alias),{status:400});
  const item=create(f.store,1,' Jugador '),assignment=f.store.issue(owner,item.id);
  assert.equal(item.playerAlias,' Jugador ');assert.equal(assignment.playerAlias,' Jugador ');
  const options={consentPatch:{...currentConsent,acknowledgedBy:'Jugador'},requestPatch:currentRequest};
  for(const acknowledgedBy of ['Otro jugador','Juga dor','   ','\tJugador','\u0085Jugador','\ufeffJugador']) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,consentPatch:{...currentConsent,acknowledgedBy}})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,requestPatch:{...currentRequest,playerAlias:'Jugador'}})),{status:400});
  const payload=packageFor(item,options);f.store.upload(item.id,assignment.accessToken,payload);
  const stored=f.store.evidence(owner,item.id).evidence.artifacts.find(artifact=>artifact.name==='consent.json');
  assert.equal(stored.base64,payload.artifacts.find(artifact=>artifact.name==='consent.json').base64);
  const consent=JSON.parse(Buffer.from(stored.base64,'base64').toString('utf8'));
  assert.equal(consent.request.playerAlias,' Jugador ');assert.equal(consent.acknowledgedBy,'Jugador');
});

test('unrecognised envelope and nested fields cannot be smuggled into an accepted package',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const options=[{consentPatch:{contactEmail:'unrequested@example.invalid'}},{requestPatch:{browserHistory:[]}},{manifestPatch:{sessionTokens:['not-permitted']}},{manifestPatch:{toolVersion:{unrequested:'object'}}},{collectors:{hardware:{notes:'unrequested'}}},{collectors:{hardware:{findings:[null]}}},{collectors:{hardware:{findings:[17]}}},{data:{baseboards:[{serial:null,contactEmail:'unrequested@example.invalid'}]}},{data:{pciInterpretation:{unrequested:'object'}}},{collectors:{hardware:{limitations:['RAW PRIVATE TEXT SHOULD NOT BE A COVERAGE CODE']}}}];
  for(const option of options) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,option)),{status:400});
  const extra=packageFor(item);extra.unrequested=true;assert.throws(()=>f.store.upload(item.id,assignment.accessToken,extra),{status:400});
  const artifact=packageFor(item);artifact.artifacts[0].unrequested=true;assert.throws(()=>f.store.upload(item.id,assignment.accessToken,artifact),{status:400});
  assert.equal(f.store.detail(owner,item.id).case.receiptId,null);
});

test('selected module and memory details cannot reference a PID outside consent',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const options={scopes:72,requestPatch:{gameProcessIds:[123]},rawFiles:{'targets.json':Buffer.from('{"123":638999999999999999}')}};
  for(const collectors of [{processes:{data:{selectedGameModules:[{pid:999,coverage:'available',modules:[]}]}}},{memory:{data:{targets:[{pid:999,coverage:'unknown-access-denied-or-exited'}]}}},{memory:{data:{targets:[{pid:123,privateExecutableRegions:-1}]}}},{memory:{data:{targets:[{pid:123,reviewRegions:[{addressPseudonym:'0x1234',regionBytes:4096,protection:'0x00000040',allocationProtection:'0x00000040',state:'committed',type:'private'}]}]}}}]) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,collectors})),{status:400});
  f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,collectors:{processes:{data:{selectedGameModules:[{pid:123,coverage:'available',modules:[]}]}},memory:{data:{targets:[{pid:123,coverage:'unknown-access-denied-or-exited'}]}}}}));
});

test('driver catalogue matches are recomputed from complete file SHA256 and remain component risk',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const drivers=catalogue.entries.map((entry,index)=>({name:`synthetic-${index}`,state:'Running',fileIdentity:fileIdentity({sha256:entry.sha256})}));
  const data=catalogueData(drivers,catalogue.entries.map((entry,index)=>[index,entry]));
  const options={consentPatch:currentConsent,requestPatch:currentRequest,data};
  for(const mutate of [d=>d.driverCatalogue.matches[0].category='malicious-driver',d=>d.driverCatalogue.matches[0].family='Different family',d=>d.driverCatalogue.matches[0].sourceUrl='https://example.invalid/',d=>d.driverCatalogue.matches[0].driverIndex=255,d=>d.systemDrivers[0].fileIdentity.status='partial',d=>d.systemDrivers[0].fileIdentity.hashCoverage='not-complete',d=>d.driverCatalogue.matchCount=0,d=>d.systemDrivers[0].fileIdentity.companyName={secret:'not-permitted'}]) {
    const altered=structuredClone(data);mutate(altered);assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,data:altered})),{status:400});
  }
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{data})),{status:400});
  f.store.upload(item.id,assignment.accessToken,packageFor(item,options));
  const hardware=f.store.detail(owner,item.id).case.summary.collectors[0];
  assert.equal(hardware.driverCatalogue.matchCount,6);assert.equal(hardware.fileIdentitySummary.completeFiles,6);
  assert.equal(hardware.driverCatalogue.assessment,'component-risk-not-cheating-verdict');
  assert.equal(hardware.driverCatalogue.derivation,'server-match-of-untrusted-collector-sha256');
  assert.equal(hardware.findings[0].code,'HARDWARE_VULNERABLE_DRIVER_REVIEW');
  assert.equal(hardware.findings[0].count,6);assert.ok(hardware.driverCatalogue.matches.every(match=>match.category==='vulnerable-driver'));
});

test('incomplete or uninspected identities cannot acquire a catalogue match',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const data=catalogueData([{name:'partial',fileIdentity:fileIdentity({status:'partial'})},{name:'not-inspected',fileIdentity:fileIdentity({status:'not-collected',sha256:null,sizeBytes:null,signatureStatus:'not-inspected',hashCoverage:'not-complete'})}]);
  f.store.upload(item.id,assignment.accessToken,packageFor(item,{consentPatch:currentConsent,requestPatch:currentRequest,data}));
  const hardware=f.store.detail(owner,item.id).case.summary.collectors[0];
  assert.equal(hardware.driverCatalogue.matchCount,0);assert.equal(hardware.findings.length,0);assert.equal(hardware.fileIdentitySummary.partialFiles,1);assert.equal(hardware.fileIdentitySummary.notCollectedFiles,1);
});

test('module identity projections must agree and finding PIDs stay within the selected targets',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const identity=fileIdentity(),module={name:'synthetic.dll',path:'C:\\Synthetic\\synthetic.dll',sha256:identity.sha256,sizeBytes:identity.sizeBytes,signatureStatus:identity.signatureStatus,fileIdentity:identity};
  const options={scopes:8,consentPatch:currentConsent,requestPatch:{...currentRequest,gameProcessIds:[123]},rawFiles:{'targets.json':Buffer.from('{"123":638999999999999999}')}};
  for(const patch of [{sha256:'0'.repeat(64)},{sizeBytes:8192},{signatureStatus:'NotSigned'}]) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,data:{selectedGameModules:[{pid:123,coverage:'available',modules:[{...module,...patch}]}]}})),{status:400});
  const findings=[{code:'PROCESS_MODULE_SIGNATURE_REVIEW',level:'review',explanationKey:'finding.process.moduleSignatureReview',facts:{pid:'999',count:'1'}}];
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,collectors:{processes:{findings}}})),{status:400});
  f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,data:{selectedGameModules:[{pid:123,coverage:'available',modules:[module]}]}}));
  assert.equal(f.store.detail(owner,item.id).case.summary.collectors[0].fileIdentitySummary.completeFiles,1);
});

test('Sysmon links bind exact consent ticks and event relation without claiming historical attestation',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const gameStartedAtUtc='2026-10-26T01:59:59.1234567Z';
  const ticks=621355968000000000n+BigInt(Date.parse('2026-10-26T01:59:59Z'))*10000n+1234567n;
  const link={eventId:10,atUtc:item.createdAtUtc,gamePid:123,gameStartedAtUtc,relation:'process-access-target',sourcePid:456,sourceProcessKey:`case-hmac:${'a'.repeat(64)}`,gameProcessKey:null,sourceExecutable:'C:\\Windows\\Synthetic.exe',modulePath:null,grantedAccess:'0x1010'};
  const data={windowFromUtc:'2026-10-25T02:00:00Z',windowUntilUtc:item.createdAtUtc,gameEventLinks:[link],gameEventLinkCoverage:{maximumLinks:80,returnedLinks:1,examinedSysmonRecords:1,selectedGamePids:1,status:'available',identityPolicy:'pid-and-creation-window-with-case-hmac-guids',historicalProcessIdentityAttested:false,rawEventDataStored:false},eventDataCollected:true,eventMessagesCollected:false};
  const options={scopes:40,consentPatch:currentConsent,requestPatch:{...currentRequest,gameProcessIds:[123]},rawFiles:{'targets.json':Buffer.from(`{"123":${ticks}}`)},collectors:{events:{data}}};
  for(const mutate of [d=>d.gameEventLinks[0].gamePid=999,d=>d.gameEventLinks[0].gameStartedAtUtc='2026-10-26T01:59:59.1234568Z',d=>d.gameEventLinks[0].atUtc='2026-10-26T01:59:58Z',d=>d.gameEventLinks[0].atUtc='2026-10-26T02:00:02Z',d=>d.gameEventLinks[0].eventId=7,d=>d.gameEventLinks[0].sourceProcessKey='raw-guid',d=>d.gameEventLinks[0].User='private user',d=>d.gameEventLinkCoverage.historicalProcessIdentityAttested=true,d=>d.eventDataCollected=false,d=>d.eventMessagesCollected=true]) {
    const altered=structuredClone(data);mutate(altered);assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,collectors:{events:{data:altered}}})),{status:400});
  }
  for(const sourceExecutable of ['C:\\Users\\<other>\\fake.exe','C:\\Users\\<user>\\<bad>\\fake.exe','C:\\Users\\<user>\\fake.exe|arguments','"C:\\Windows\\fake.exe"']) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,collectors:{events:{data:{...data,gameEventLinks:[{...link,sourceExecutable}]}}}})),{status:400});
  for(const root of ['C:\\Users\\<user>','C:\\Documents and Settings\\<user>']) for(const eventId of [7,10]) {
    const contextCase=create(f.store),capability=f.store.issue(owner,contextCase.id),normalizedPath=`${root}\\AppData\\Local\\Synthetic\\fixture.dll`;
    const projected={...link,eventId,relation:eventId===7?'image-load':'process-access-target',sourcePid:eventId===7?null:456,sourceProcessKey:null,sourceExecutable:eventId===7?null:normalizedPath,modulePath:eventId===7?normalizedPath:null,grantedAccess:eventId===7?null:'0x1010'};
    f.store.upload(contextCase.id,capability.accessToken,packageFor(contextCase,{...options,collectors:{events:{data:{...data,gameEventLinks:[projected]}}}}));
    assert.equal(f.store.detail(owner,contextCase.id).case.summary.collectors.find(row=>row.id==='events').gameEventLinkSummary.returnedLinks,1);
  }
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{...options,consentPatch:{policyVersion:'ctp-pc-check/2026-10-26.2'}})),{status:400});
  f.store.upload(item.id,assignment.accessToken,packageFor(item,options));
  const summary=f.store.detail(owner,item.id).case.summary.collectors.find(row=>row.id==='events').gameEventLinkSummary;
  assert.equal(summary.returnedLinks,1);assert.equal(summary.relationCounts['process-access-target'],1);assert.equal(summary.historicalProcessIdentityAttested,false);assert.equal(summary.assessment,'event-correlation-not-cheating-verdict');
});

test('case assignment enforces staff section, owner isolation and server-owned operator identity',t=>{
  const f=fixture();t.after(f.close);
  const body={playerId,playerAlias:'Jugador fixture',purpose:'Finalidad de fixture sintética',retentionDays:7,allowedScopes:63,assignedOperatorId:2};
  assert.throws(()=>f.store.create(null,body),{status:401});
  assert.throws(()=>f.store.create({...other,sections:['casters']},body),{status:403});
  const item=f.store.create(owner,body);
  assert.equal(item.assignedOperatorId,owner.id);
  assert.equal(item.operatorAlias,owner.name);
  assert.equal(item.identityBinding,'staff-assignment-not-player-authentication');
  assert.throws(()=>f.store.detail(other,item.id),{status:403});
  assert.deepEqual(f.store.list(other).cases,[]);
  assert.equal(f.store.detail(admin,item.id).case.id,item.id);
  assert.throws(()=>f.store.issue(other,item.id),{status:403});
  assert.throws(()=>f.store.evidence(other,item.id),{status:403});
  assert.throws(()=>f.store.review(other,item.id,{text:'No permitido'}),{status:403});
});

test('missing custody key disables PC Check without plaintext fallback or schema side effects',t=>{
  const f=fixture({configured:false});t.after(f.close);
  assert.throws(()=>create(f.store),{status:503});
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='pc_check_cases'").get().n,0);
});

test('scoped capability is hash-only, binds server assignment and reissue revokes previous token',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store);
  const first=f.store.issue(owner,item.id),second=f.store.issue(owner,item.id);
  assert.match(first.accessToken,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.accessToken,second.accessToken);
  assert.throws(()=>f.store.getAssignment(item.id,first.accessToken),{status:401});
  const verified=f.store.getAssignment(item.id,second.accessToken);
  assert.equal(verified.accessToken,undefined);
  assert.equal(verified.playerId,item.playerId);
  const row=f.db.prepare('SELECT * FROM pc_check_cases WHERE id=?').get(item.id);
  assert.equal(row.token_hash,sha(second.accessToken));
  assert.equal(JSON.stringify(row).includes(second.accessToken),false);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM pc_check_audit').all()).includes(second.accessToken),false);
  const another=create(f.store);
  assert.throws(()=>f.store.getAssignment(another.id,second.accessToken),{status:401});
  f.advance(86400001);assert.throws(()=>f.store.getAssignment(item.id,second.accessToken),{status:410});
});

test('encrypted immutable evidence supports exact retry and preserves original bytes as inert base64',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id),payload=packageFor(item);
  const first=f.store.upload(item.id,assignment.accessToken,payload);
  assert.equal(first.playerId,item.playerId);
  assert.deepEqual(f.store.upload(item.id,assignment.accessToken,payload),first);
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{data:{unsignedDriverCount:1}})),{status:409});
  assert.throws(()=>f.store.issue(owner,item.id),{status:409});
  const row=f.db.prepare('SELECT * FROM pc_check_cases WHERE id=?').get(item.id);
  assert.ok(row.evidence_ciphertext.length>0&&row.evidence_nonce.length===12&&row.evidence_tag.length===16);
  assert.equal(Buffer.from(row.evidence_ciphertext).includes(Buffer.from('consent.json')),false);
  const stored=f.store.evidence(owner,item.id);
  assert.equal(stored.evidence.htmlExecution,'never-rendered-stored-as-base64-only');
  for(const original of payload.artifacts) assert.equal(stored.evidence.artifacts.find(x=>x.name===original.name).base64,original.base64);
  assert.equal(f.store.detail(owner,item.id).case.summary.assessment,'evidence-for-human-review-not-cheating-verdict');
  assert.equal(f.store.detail(owner,item.id).case.summary.syntheticFixture,true);
  const altered=Buffer.from(row.evidence_ciphertext);altered[0]^=1;
  f.db.prepare('UPDATE pc_check_cases SET evidence_ciphertext=? WHERE id=?').run(altered,item.id);
  assert.throws(()=>f.store.evidence(owner,item.id),{status:500});
});

test('retention excludes expired list rows and returns 410 for case, evidence, note and capability',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  f.store.upload(item.id,assignment.accessToken,packageFor(item));f.advance(7*86400000+1);
  assert.equal(f.store.list(owner).cases.length,0);
  for(const fn of [()=>f.store.detail(owner,item.id),()=>f.store.evidence(owner,item.id),()=>f.store.review(owner,item.id,{text:'Nota'}),()=>f.store.getAssignment(item.id,assignment.accessToken)]) assert.throws(fn,{status:410});
});

test('explicit reviewer delegation allows later analysis, excludes peers, and can be revoked',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  f.store.upload(item.id,assignment.accessToken,packageFor(item));
  assert.throws(()=>f.store.assignReviewer(other,item.id,{reviewerId:other.id}),{status:403});
  assert.throws(()=>f.store.assignReviewer(owner,item.id,{reviewerId:999}),{status:400});
  f.store.assignReviewer(owner,item.id,{reviewerId:other.id});
  assert.equal(f.store.list(other).cases[0].id,item.id);
  assert.equal(f.store.evidence(other,item.id).receipt.caseId,item.id);
  assert.equal(f.store.detail(other,item.id).canAssignReviewers,false);
  assert.throws(()=>f.store.issue(other,item.id),{status:403});
  const note=f.store.review(other,item.id,{text:'Lectura posterior del árbitro; sin sanción automática.'});
  assert.equal(note.authorId,other.id);assert.equal(note.authorAlias,other.name);assert.ok(note.createdAtUtc);
  f.store.assignReviewer(owner,item.id,{reviewerId:other.id,enabled:false});
  assert.throws(()=>f.store.detail(other,item.id),{status:403});
  assert.equal(f.store.detail(owner,item.id).reviews.length,1);
});

test('rejects tamper, invalid manifest, extras, duplicate names and traversal before receipt',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  let payload=packageFor(item);payload.manifestSha256='0'.repeat(64);assert.throws(()=>f.store.upload(item.id,assignment.accessToken,payload),{status:400});
  payload=packageFor(item);payload.artifacts.find(x=>x.name==='hardware.json').base64=Buffer.from('{}').toString('base64');assert.throws(()=>f.store.upload(item.id,assignment.accessToken,payload),{status:400});
  payload=packageFor(item);payload.artifacts.push({...payload.artifacts[0]});assert.throws(()=>f.store.upload(item.id,assignment.accessToken,payload),{status:400});
  payload=packageFor(item);payload.artifacts[0].name='../consent.json';assert.throws(()=>f.store.upload(item.id,assignment.accessToken,payload),{status:400});
  payload=packageFor(item);payload.artifacts.push({name:'network.json',base64:'e30='});assert.throws(()=>f.store.upload(item.id,assignment.accessToken,payload),{status:400});
  assert.equal(f.store.detail(owner,item.id).case.receiptId,null);
});

test('consent identity, transfer acknowledgement, policy and maximum scope cannot be forged',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store,1),assignment=f.store.issue(owner,item.id);
  for(const requestPatch of [{playerId:crypto.randomUUID()},{managerCaseId:crypto.randomUUID()},{playerAlias:'Otra persona'},{operatorAlias:'Otro staff'},{purpose:'Otro propósito largo'},{uploadToManager:false}]) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{requestPatch})),{status:400});
  for(const consentPatch of [{agreesManagerUpload:false},{policyVersion:'ctp-pc-check/2026-10-26.1'},{playerPresent:false}]) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{consentPatch})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{scopes:2})),{status:400});
  const payload=packageFor(item,{requestPatch:{scopes:'Hardware'}});
  assert.ok(f.store.upload(item.id,assignment.accessToken,payload).receiptId);
});

test('raw hardware, network addresses and unbounded JSON are rejected outside consent',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{data:{baseboards:[{serial:'RAW-SERIAL'}]}})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{scopes:16,data:{tcp:[{localAddress:'192.0.2.1'}],udp:[]}})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{data:{password:'not-permitted'}})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{data:{baseboards:{serial:'not-an-array'}}})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{scopes:64|8,requestPatch:{gameProcessIds:[123]},rawFiles:{'targets.json':Buffer.from('{"123":0}')},data:{targets:'not-an-array'}})),{status:400});
  assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{rawFiles:{'report.html':Buffer.alloc(8*1024*1024)}})),{status:413});
  assert.ok(f.store.upload(item.id,assignment.accessToken,packageFor(item,{scopes:129,data:{baseboards:[{serial:'RAW-SERIAL'}]}})).receiptId);
});

test('partial and cancelled summaries are derived from per-collector coverage',t=>{
  const f=fixture();t.after(f.close);
  for(const [status,state,expected] of [['unavailable','complete','partial'],['cancelled','cancelled','cancelled'],['complete','partial','partial'],['complete','failed','failed']]) {
    const item=create(f.store),assignment=f.store.issue(owner,item.id);
    f.store.upload(item.id,assignment.accessToken,packageFor(item,{status,state}));
    assert.equal(f.store.detail(owner,item.id).case.summary.state,expected);
  }
});

test('targets reject secrets, unconsented PIDs, invalid ticks and retain original Int64 bytes',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store),assignment=f.store.issue(owner,item.id);
  for(const bytes of ['{"password":1}','{"999":0}','{"123":"123"}','{"123":3155378976000000000}']) assert.throws(()=>f.store.upload(item.id,assignment.accessToken,packageFor(item,{scopes:8,requestPatch:{gameProcessIds:[123]},rawFiles:{'targets.json':Buffer.from(bytes)}})),{status:400});
  const original=Buffer.from('{"123":638999999999999999}');
  const payload=packageFor(item,{scopes:8,requestPatch:{gameProcessIds:[123]},rawFiles:{'targets.json':original}});
  f.store.upload(item.id,assignment.accessToken,payload);
  assert.deepEqual(Buffer.from(f.store.evidence(owner,item.id).evidence.artifacts.find(x=>x.name==='targets.json').base64,'base64'),original);
});

test('a deleted creator cannot leak cases when a numeric user id is reused',t=>{
  const f=fixture();t.after(f.close);const item=create(f.store);
  f.db.prepare('DELETE FROM users WHERE id=1').run();
  f.db.prepare("INSERT INTO users VALUES(1,'Replacement','replacement')").run();
  assert.throws(()=>f.store.detail({...owner,name:'Replacement'},item.id),{status:403});
  assert.equal(f.store.detail(admin,item.id).case.assignedOperatorId,null);
});

test('a canonical CTP player filter narrows the existing case ACL before the list limit',t=>{
  const f=fixture();t.after(f.close);
  const chosen=create(f.store);
  const differentPlayer='abcdefab-cdef-4abc-8def-abcdefabcdef';
  for(let i=0;i<101;i++) {
    f.advance(1000);
    f.store.create(owner,{playerId:differentPlayer,playerAlias:'Otro jugador fixture',purpose:'Revisión de contrato sintético',retentionDays:7,allowedScopes:1});
  }
  assert.equal(f.store.list(owner).cases.length,100);
  assert.equal(f.store.list(owner).cases.some(row=>row.id===chosen.id),false);
  const filtered=f.store.list(owner,{user_id:playerId});
  assert.deepEqual(filtered.cases.map(row=>row.id),[chosen.id]);
  assert.deepEqual(filtered.filters,{user_id:playerId});
  assert.equal(f.store.list(owner,{user_id:differentPlayer.toUpperCase()}).filters.user_id,differentPlayer);
  assert.equal(f.store.list(other,{user_id:playerId}).cases.length,0);
  assert.deepEqual(f.store.list(admin,{user_id:playerId}).cases.map(row=>row.id),[chosen.id]);
  f.store.assignReviewer(owner,chosen.id,{reviewerId:other.id});
  assert.deepEqual(f.store.list(other,{user_id:playerId}).cases.map(row=>row.id),[chosen.id]);
  f.store.assignReviewer(owner,chosen.id,{reviewerId:other.id,enabled:false});
  assert.equal(f.store.list(other,{user_id:playerId}).cases.length,0);
  for(const query of [{user_id:''},{user_id:'not-a-player'},{user_id:[playerId,playerId]},{user_id:1},{player_id:playerId}]) assert.throws(()=>f.store.list(owner,query),{status:400});
  f.advance(7*86400000);
  assert.equal(f.store.list(admin,{user_id:playerId}).cases.length,0);
});

test('HTTP capability is checked before upload parser; native bearer never grants staff evidence reads',async t=>{
  const f=fixture();t.after(f.close);const app=express();
  const requireAuth=(req,res,next)=>{req.user=({'fixture-owner':owner,'fixture-peer':other,'fixture-admin':admin})[req.get('x-fixture-user')];return req.user?next():res.status(401).json({error:'fixture-auth-required'});};
  const allow=()=> (req,res,next)=> req.user.is_admin||req.user.sections.includes('arbitraje')?next():res.status(403).json({error:'fixture-forbidden'});
  const {uploadRouter,router}=createPcCheckRouters({store:f.store,requireAuth,allow});
  app.use('/api',uploadRouter);app.use(express.json({limit:'1mb'}));app.use('/api',router);
  app.use((req,res)=>res.status(404).json({error:'not-found'}));
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/pc-check`;
  const request=(url,{method='GET',user,accessToken,body}={})=>fetch(`${base}${url}`,{method,headers:{...(user?{'x-fixture-user':user}:{}),...(accessToken?{authorization:`Bearer ${accessToken}`}:{ }),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await request('/cases')).status,401);
  const item=create(f.store),assignment=f.store.issue(owner,item.id);
  const ownCases=await request(`/cases?user_id=${playerId}`,{user:'fixture-owner'});
  assert.equal(ownCases.status,200);assert.deepEqual((await ownCases.json()).cases.map(row=>row.id),[item.id]);
  const peerCases=await request(`/cases?user_id=${playerId}`,{user:'fixture-peer'});
  assert.equal(peerCases.status,200);assert.equal((await peerCases.json()).cases.length,0);
  for(const query of ['user_id=invalid',`user_id=${playerId}&user_id=${playerId}`,`user_id[]=${playerId}`,'player_id='+playerId]) assert.equal((await request('/cases?'+query,{user:'fixture-owner'})).status,400);
  const tooLarge={padding:'x'.repeat(13*1024*1024)};
  assert.equal((await request(`/assignments/${item.id}/evidence`,{method:'PUT',body:tooLarge})).status,401);
  assert.equal((await request(`/assignments/${item.id}/evidence`,{method:'PUT',accessToken:assignment.accessToken,body:tooLarge})).status,413);
  const payload=packageFor(item,{rawFiles:{'report.html':Buffer.from('<!doctype html>'+ 'x'.repeat(1100000))}});
  const upload=await request(`/assignments/${item.id}/evidence`,{method:'PUT',accessToken:assignment.accessToken,body:payload});
  assert.equal(upload.status,200);assert.ok((await upload.json()).receiptId);
  const native=await request(`/assignments/${item.id}`,{accessToken:assignment.accessToken});
  assert.equal(native.status,200);assert.equal((await native.json()).accessToken,undefined);
  assert.equal((await request(`/cases/${item.id}/evidence`,{accessToken:assignment.accessToken})).status,401);
  assert.equal((await request(`/cases/${item.id}/evidence`,{user:'fixture-peer'})).status,403);
  const evidence=await request(`/cases/${item.id}/evidence`,{user:'fixture-owner'});
  assert.equal(evidence.status,200);assert.match(evidence.headers.get('content-disposition'),/^attachment;/);
  assert.match(evidence.headers.get('content-type'),/^application\/json/);
  assert.equal((await request(`/assignments/${item.id}/evidence`,{accessToken:assignment.accessToken})).status,404);
  for(let i=0;i<30;i++) await request(`/assignments/${item.id}/evidence`,{method:'PUT',accessToken:assignment.accessToken,body:{}});
  const limited=await fetch(`${base}/assignments/${item.id}/evidence`,{method:'PUT',headers:{authorization:`Bearer ${assignment.accessToken}`,'content-type':'application/json'},body:'invalid-json-not-parsed'});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
});

test('real .NET serializer and upload builder interoperate without collectors or external requests',t=>{
  const dll=process.env.PC_CHECK_INTEROP_DLL;
  if(!dll||!fs.existsSync(dll)){t.skip('Set PC_CHECK_INTEROP_DLL to the built Ctp.PcCheck.Tests.dll for the cross-language fixture.');return;}
  const f=fixture({live:true});t.after(f.close);
  const item=create(f.store,63,' Jugador fixture '),assignment=f.store.issue(owner,item.id);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-pc-check-interop-'));
  t.after(()=>{const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});
  const assignmentPath=path.join(directory,'assignment.json'),uploadPath=path.join(directory,'upload.json');
  fs.writeFileSync(assignmentPath,JSON.stringify(assignment),{mode:0o600});
  const built=spawnSync('dotnet',[dll,'--interop',assignmentPath,uploadPath],{encoding:'utf8',timeout:20000,windowsHide:true});
  assert.equal(built.status,0,'Cross-language fixture builder must finish without collecting host evidence.');
  const payload=JSON.parse(fs.readFileSync(uploadPath,'utf8'));
  const receipt=f.store.upload(item.id,assignment.accessToken,payload);
  assert.ok(receipt.receiptId);
  const detail=f.store.detail(owner,item.id);
  assert.equal(detail.case.summary.state,'partial');assert.equal(detail.case.summary.collectors.length,6);
  assert.equal(detail.case.summary.gameContext.title,gameTitle);
  const hardware=detail.case.summary.collectors.find(row=>row.id==='hardware');
  assert.equal(hardware.driverCatalogue.matchCount,1);
  assert.equal(hardware.findings.find(row=>row.code==='HARDWARE_VULNERABLE_DRIVER_REVIEW').count,1);
  const restored=f.store.evidence(owner,item.id).evidence.artifacts;
  assert.equal(JSON.parse(Buffer.from(restored.find(artifact=>artifact.name==='consent.json').base64,'base64').toString('utf8')).request.playerAlias,' Jugador fixture ');
  for(const original of payload.artifacts) assert.equal(restored.find(x=>x.name===original.name).base64,original.base64,'Every original artifact remains byte-exact through encrypted custody.');
});
