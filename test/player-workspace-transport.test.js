import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-player-transport-'));
process.env.DATA_DIR=temp;process.env.DB_PATH=path.join(temp,'workspace.db');
process.env.CTP_OPERATIONS_URL='';process.env.CTP_OPERATIONS_TOKEN='';
const {createOperationsTransport}=await import('../server/integration.js');
const {PLAYER_WORKSPACE_ERRORS}=await import('../server/player-workspace-contract.js');
const {db}=await import('../server/db.js');
after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
const config={configured:true,url:'https://example.invalid/functions/v1/manager-operations',token:'fixture-transport-token-only-over-32-characters',signingSecret:'fixture-independent-signature-only-over-32-characters'};
const body={action:'player_workspace',actor_id:'referee.dev',query:{operation:'search',query:''}};
const response=(status,value,contentType='application/json')=>new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'Content-Type':contentType}});

test('private query transport preserves only exact matching missing-account and invalid-query codes',async()=>{
 for(const [status,code]of[[404,'player_workspace_not_found'],[400,'player_workspace_invalid']]){
  let called=0;
  const read=createOperationsTransport(config,async(_,options)=>{called++;assert.deepEqual(JSON.parse(options.body),body);return response(status,{ok:false,code,error:'private upstream SQL account',details:'private row',hint:'private hint'});});
  await assert.rejects(()=>read(body),error=>error.status===status&&error.remoteRejected===true&&error.message===PLAYER_WORKSPACE_ERRORS[code]&&!error.message.includes('private'));
  assert.equal(called,1);
 }
});
test('unknown, oversized, malformed and mismatched reader errors use the safe legacy fallback',async()=>{
 for(const [status,value,type]of[[404,{ok:false,code:'private_sql'},'application/json'],[404,{ok:false,code:'player_workspace_invalid'},'application/json'],
  [400,{ok:false,code:'player_workspace_not_found'},'application/json'],[404,{ok:true,code:'player_workspace_not_found'},'application/json'],
  [404,'private malformed SQL','application/json'],[404,{ok:false,code:'player_workspace_not_found'},'text/html'],
  [404,{ok:false,code:'player_workspace_not_found',private:'x'.repeat(9000)},'application/json']]){
  const read=createOperationsTransport(config,async()=>response(status,value,type));
  await assert.rejects(()=>read(body),error=>error.status===422&&!/private|SQL|x{10}/.test(error.message));
 }
});
test('player reader mapping does not change other actions or successful reader DTOs',async()=>{
 const legacy=createOperationsTransport(config,async()=>response(404,{ok:false,code:'player_workspace_not_found'}));
 await assert.rejects(()=>legacy({action:'ranked_monitor',actor_id:'referee.dev'}),error=>error.status===422);
 const state={schema_version:1,operation:'search',items:[],total:0};
 assert.deepEqual(await createOperationsTransport(config,async()=>response(200,{ok:true,data:state}))(body),state);
});
