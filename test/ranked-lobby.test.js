import test,{after}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
import{lobbyFixture,lobbyId}from'./fixtures/ranked-lobby.js';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctp-detail-'));process.env.DATA_DIR=temp;process.env.DB_PATH='';process.env.PUBLIC_ORIGIN='';process.env.CTP_AUTH_MODE='local';
const{rankedLobbyDetail,rankedLobbyId,rankedChatCursor,rankedChatRequest,rankedLobbyChatReceipt,rankedBanRequest,rankedBanReceipt,rankedDecisionReceipt}=await import('../server/ranked-lobby-contract.js');const{getRankedLobbyDetail}=await import('../server/integration.js');const{db}=await import('../server/db.js');
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

test('legacy chat cannot enable writes and staff badges require a non-system snapshot',()=>{
 const raw=lobbyFixture();let clean=rankedLobbyDetail(raw,lobbyId);assert.equal(clean.chat.can_send,false);assert.equal(clean.chat.messages[0].author_role,null);
 raw.chat.can_send=true;raw.chat.messages[0].author_role='referee';clean=rankedLobbyDetail(raw,lobbyId);assert.equal(clean.chat.can_send,true);assert.equal(clean.chat.messages[0].author_role,'referee');
 for(const mutate of[r=>r.chat.can_send='true',r=>r.chat.messages[0].author_role='player',r=>r.chat.messages[0].is_system=true]){const data=structuredClone(raw);mutate(data);assert.throws(()=>rankedLobbyDetail(data,lobbyId),{status:502});}
});

const requestId='30000000-0000-4000-8000-00000000000a';
test('chat request is finite, trimmed and bounded by PostgreSQL Unicode length',()=>{
 assert.deepEqual(rankedChatRequest({message:'  Hola\n🔥  ',request_id:requestId.toUpperCase()}),{message:'Hola\n🔥',request_id:requestId});
 assert.equal(Array.from(rankedChatRequest({message:'🔥'.repeat(800),request_id:requestId}).message).length,800);
 for(const value of[null,[],{}, {message:'x',request_id:'bad'}, {message:' ',request_id:requestId}, {message:'🔥'.repeat(801),request_id:requestId}, {message:'x\u0000',request_id:requestId}, {message:12,request_id:requestId}, {message:'x',request_id:requestId,actor_id:'forged'}, {message:'x',request_id:requestId,author_role:'admin'}])assert.throws(()=>rankedChatRequest(value),{status:400});
});

test('chat receipt proves exact lobby/request/text and projects no upstream secrets',()=>{
 const input={message:'<b>Hola</b>',request_id:requestId},raw={schema_version:1,lobby_id:lobbyId,request_id:requestId,replayed:false,secret:'private',message:{id:'9007199254740994',username:'Árbitro',message:input.message,is_system:false,author_role:'referee',created_at:'2026-10-23T12:00:00Z',token:'private'}};
 const clean=rankedLobbyChatReceipt(raw,lobbyId,input);assert.equal(JSON.stringify(clean).includes('private'),false);assert.equal(clean.message.message,input.message);
 for(const mutate of[r=>r.lobby_id=requestId,r=>r.request_id=lobbyId,r=>r.message.message='otro',r=>r.message.author_role=null,r=>r.message.is_system=true,r=>r.message.id=9007199254740994,r=>r.replayed=undefined]){const data=structuredClone(raw);mutate(data);assert.throws(()=>rankedLobbyChatReceipt(data,lobbyId,input),{status:502});}
});

test('players carry the division, XP and Top 50 they joined with, plus an active Ranked block',()=>{
 const raw=lobbyFixture();raw.lobby.mode='Search & Destroy';raw.lobby.mode_pending=false;raw.can_moderate=true;
 Object.assign(raw.players[0],{division:'gold',xp:1250,top50:false,ranked_ban_until:'2026-10-23T13:00:00Z'});Object.assign(raw.players[1],{division:'iridescent',xp:5400,top50:true,ranked_ban_until:null});
 const clean=rankedLobbyDetail(raw,lobbyId);
 assert.deepEqual(clean.players.slice(0,2).map(p=>[p.division,p.xp,p.top50,p.ranked_ban_until]),[['gold',1250,false,'2026-10-23T13:00:00Z'],['iridescent',5400,true,null]]);
 assert.equal(clean.can_moderate,true);assert.equal(clean.lobby.mode,'Search & Destroy');
 const legacy=rankedLobbyDetail(lobbyFixture(),lobbyId);
 assert.deepEqual([legacy.players[0].division,legacy.players[0].xp,legacy.players[0].top50,legacy.players[0].ranked_ban_until,legacy.can_moderate,legacy.lobby.mode_pending],[null,null,null,null,false,false]);
 for(const mutate of[r=>r.players[0].division='Gold!',r=>r.players[0].xp=-1,r=>r.players[0].xp=1.5,r=>r.players[0].top50='yes',r=>r.players[0].ranked_ban_until='mañana',r=>r.can_moderate='true',r=>r.lobby.mode_pending=1]){const data=lobbyFixture();mutate(data);assert.throws(()=>rankedLobbyDetail(data,lobbyId),{status:502});}
});

test('a Ranked block names a slot and its shown player, 1 minute to 7 days and a real reason',()=>{
 const input={slot:2,username:'Player 2',minutes:60,reason:'  Insultos reiterados en el chat  ',request_id:requestId.toUpperCase()};
 assert.deepEqual(rankedBanRequest(input),{slot:2,username:'Player 2',minutes:60,reason:'Insultos reiterados en el chat',request_id:requestId});
 assert.equal(rankedBanRequest({...input,minutes:10080}).minutes,10080);
 for(const value of[null,[],{...input,slot:0},{...input,slot:9},{...input,slot:'2'},{...input,username:''},{...input,username:'x'.repeat(101)},{...input,username:'a\u0000'},{...input,minutes:0},{...input,minutes:10081},{...input,minutes:1.5},{...input,reason:'corto'},{...input,reason:'x'.repeat(501)},{...input,request_id:'bad'},{...input,user_id:'forged'},{...input,actor_id:'forged'}])
  assert.throws(()=>rankedBanRequest(value),{status:400});
});

test('block and decision receipts must match this lobby, request and input exactly',()=>{
 const ban={slot:2,username:'Player 2',minutes:60,reason:'Insultos reiterados en el chat',request_id:requestId};
 const banReply={schema_version:1,lobby_id:lobbyId,request_id:requestId,slot:2,username:'Player 2',minutes:60,ends_at:'2026-10-23T13:00:00Z',replayed:false,user_id:'private'};
 assert.deepEqual(rankedBanReceipt(banReply,lobbyId,ban),{schema_version:1,lobby_id:lobbyId,request_id:requestId,slot:2,username:'Player 2',minutes:60,ends_at:'2026-10-23T13:00:00Z',replayed:false});
 for(const mutate of[r=>r.lobby_id=requestId,r=>r.request_id=lobbyId,r=>r.slot=3,r=>r.username='Otro',r=>r.minutes=30,r=>r.ends_at='bad',r=>r.replayed=undefined]){const data=structuredClone(banReply);mutate(data);assert.throws(()=>rankedBanReceipt(data,lobbyId,ban),{status:502});}
 const decision={decision:'winner',side:'b',reason:'Captura del marcador final',request_id:requestId};
 const decisionReply={schema_version:1,lobby_id:lobbyId,request_id:requestId,decision:'winner',side:'b',author_role:'referee',replayed:true};
 assert.deepEqual(rankedDecisionReceipt(decisionReply,lobbyId,decision),{applied:true,lobby_id:lobbyId,request_id:requestId,decision:'winner',side:'b'});
 assert.equal(rankedDecisionReceipt({...decisionReply,decision:'cancel',side:null},lobbyId,{...decision,decision:'cancel',side:null}).side,null);
 for(const mutate of[r=>r.side='a',r=>r.decision='cancel',r=>r.author_role='player',r=>r.lobby_id=requestId,r=>r.replayed='no']){const data=structuredClone(decisionReply);mutate(data);assert.throws(()=>rankedDecisionReceipt(data,lobbyId,decision),{status:502});}
});
