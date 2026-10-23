import test,{after}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
import{lobbyFixture,lobbyId}from'./fixtures/ranked-lobby.js';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-detail-'));process.env.DATA_DIR=temp;process.env.DB_PATH='';process.env.PUBLIC_ORIGIN='';process.env.CTP_AUTH_MODE='local';
const{rankedLobbyDetail,rankedLobbyId,rankedChatCursor}=await import('../server/ranked-lobby-contract.js');const{getRankedLobbyDetail}=await import('../server/integration.js');const{db}=await import('../server/db.js');
after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
test('detail projects only requested lobby, roster, votes and shared chat without secrets',()=>{
 const raw=lobbyFixture();raw.service_role='secret';raw.lobby.room_code='secret';raw.players[0].email='secret';raw.players[0].user_id='secret';raw.chat.messages[0].private_token='secret';
 const clean=rankedLobbyDetail(raw,lobbyId);assert.equal(JSON.stringify(clean).includes('secret'),false);assert.equal(clean.players.length,8);assert.equal(clean.chat.messages[0].id,'9007199254740993');assert.equal(clean.chat.messages[0].message,'<img src=x onerror=alert(1)>');assert.equal(clean.lobby.id,lobbyId);
});
test('unknown lobby is explicit, and another lobby response cannot be substituted',()=>{
 assert.equal(rankedLobbyDetail({schema_version:1,found:false,lobby_id:lobbyId},lobbyId),null);
 assert.throws(()=>rankedLobbyDetail(lobbyFixture(),'30000000-0000-4000-8000-000000000001'),{status:502});
});
test('invalid bounds and unordered or cross-page chat fail closed',()=>{
 for(const mutate of[r=>r.players=Array(9).fill(r.players[0]),r=>r.players=[null],r=>r.players[1].slot=1,r=>r.chat.messages[0].id=9007199254740993,r=>r.chat.messages[0].message='x'.repeat(801),r=>r.chat.has_more=true,r=>r.chat.messages.push(r.chat.messages[0]),r=>r.result.votes_a=9,r=>r.lobby.queue_id='bad']){const raw=lobbyFixture();mutate(raw);assert.throws(()=>rankedLobbyDetail(raw,lobbyId),{status:502});}
});
test('system copy is translated only for system messages; user content is untouched',()=>{
 const raw=lobbyFixture();raw.chat.messages[0].message='ranked.system.xpAwarded';assert.equal(rankedLobbyDetail(raw,lobbyId).chat.messages[0].message,'ranked.system.xpAwarded');raw.chat.messages[0].is_system=true;assert.equal(rankedLobbyDetail(raw,lobbyId).chat.messages[0].message,'Resultado confirmado. XP actualizados.');
});
test('valid PostgreSQL-length Unicode chat and resolution do not make the detail unavailable',()=>{
 const raw=lobbyFixture();raw.chat.messages[0].message='🔥'.repeat(800);raw.result.resolution='🛡'.repeat(2000);
 assert.equal(Array.from(rankedLobbyDetail(raw,lobbyId).chat.messages[0].message).length,800);
 assert.equal(Array.from(rankedLobbyDetail(raw,lobbyId).result.resolution).length,2000);
 raw.chat.messages[0].message+='🔥';assert.throws(()=>rankedLobbyDetail(raw,lobbyId),{status:502});
});
test('caller ids/cursors are bounded and no unauthorized request reaches transport',async()=>{
 assert.equal(rankedLobbyId(lobbyId.toUpperCase()),lobbyId);assert.equal(rankedChatCursor('9223372036854775807'),'9223372036854775807');
 for(const v of['0','-1','1.0','9223372036854775808',[],{},1])assert.throws(()=>rankedChatCursor(v),{status:400});
 await assert.rejects(getRankedLobbyDetail(null,lobbyId),{status:401});await assert.rejects(getRankedLobbyDetail({id:1,is_admin:false},lobbyId),{status:403});await assert.rejects(getRankedLobbyDetail({id:1,is_admin:true,auth_mode:'ctp',ctp_role:'player'},lobbyId),{status:403});await assert.rejects(getRankedLobbyDetail({id:1,is_admin:true},'bad'),{status:400});
});
