import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {monitorFixture} from './fixtures/ranked-monitor.js';
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'ctp-ranked-monitor-contract-'));
process.env.DATA_DIR=temp;process.env.DB_PATH='';process.env.PUBLIC_ORIGIN='';process.env.CTP_AUTH_MODE='local';
const {rankedMonitorState} = await import('../server/ranked-monitor-contract.js');
const {getRankedMonitor} = await import('../server/integration.js');
const {db} = await import('../server/db.js');
after(() => {db.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});

test('monitor projects a bounded payload without player identities or upstream secrets', () => {
  const raw=monitorFixture();raw.credential='private';raw.summary.email='person@example.test';raw.active_lobbies[0].room_code='private';raw.queues[0].players=[{username:'private'}];
  const clean=rankedMonitorState(raw);
  assert.deepEqual(clean,monitorFixture());
  assert.equal(JSON.stringify(clean).includes('private'),false);
  assert.equal(clean.queues[0].game_id,'g_mw4');
});
test('empty activity retains nullable durations and genuine zero counts', () => {
  const raw=monitorFixture();raw.queues=[];raw.active_lobbies=[];raw.lobby_statuses=[];raw.map_activity=[];
  for(const key of Object.keys(raw.summary))raw.summary[key]=0;
  for(const key of Object.keys(raw.activity_24h))raw.activity_24h[key]=key==='duration_avg_seconds'?null:0;
  assert.deepEqual(rankedMonitorState(raw),raw);
});
test('invalid metrics, unbounded rows, unknown states and malformed references fail closed', () => {
  const changes=[raw=>raw.summary.waiting_players=-1,raw=>raw.summary.active_queues=1.2,raw=>raw.queues[0].game_id='../bad',raw=>raw.queues[0].wait_avg_seconds=Infinity,raw=>raw.queues[0].is_open='true',raw=>raw.active_lobbies[0].status='closed',raw=>raw.active_lobbies[0].id='bad',raw=>raw.active_lobbies[0].created_at='bad',raw=>raw.queues=Array(51).fill(raw.queues[0]),raw=>raw.truncated.queues='false',raw=>raw.window_started_at='2030-01-01T00:00:00Z',raw=>raw.lobby_statuses.push(raw.lobby_statuses[0])];
  for(const change of changes){const raw=monitorFixture();change(raw);assert.throws(()=>rankedMonitorState(raw),{status:502});}
});
test('monitor rejects unauthenticated or non-admin users before the transport', async () => {
  await assert.rejects(getRankedMonitor(null),{status:401});
  await assert.rejects(getRankedMonitor({id:1,is_admin:false,sections:['operaciones','arbitraje']}),{status:403});
  await assert.rejects(getRankedMonitor({id:1,is_admin:true,auth_mode:'ctp',ctp_role:'player'}),{status:403});
});
