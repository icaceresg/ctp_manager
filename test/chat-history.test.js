import test from 'node:test';
import assert from 'node:assert/strict';
import {readWholeChat,createChatReader,chatHistoryNotice,CHAT_MAX_PAGES,CHAT_MAX_MESSAGES} from '../client/src/operations/chatHistory.js';
const byId=(a,b)=>a.id-b.id;
const range=(from,to)=>Array.from({length:to-from+1},(_,i)=>from+i);
const deferred=()=>{let resolve;const promise=new Promise(accept=>{resolve=accept;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function chat(ids,size=50,transform=id=>({id})){
 const calls=[];
 const fetchPage=async(cursor,options)=>{
  calls.push({cursor,signal:options?.signal});
  const older=cursor===null?ids:ids.filter(id=>id<cursor),selected=older.slice(-size);
  return{value:{can_decide:true,cursor},messages:selected.map(transform),next:older.length>size?selected[0]:null};
 };
 return{fetchPage,calls};
}

test('publishes the current match and newest messages before the second page resolves',async()=>{
 const second=deferred(),published=[];
 const read=readWholeChat(async cursor=>cursor===null?{value:{can_decide:true},messages:[{id:2}],next:2}:second.promise,byId,{onPage:value=>published.push(value)});
 await tick();assert.equal(published.length,1);assert.equal(published[0].value.can_decide,true);
 assert.deepEqual(published[0].messages,[{id:2}]);assert.equal(published[0].partialReason,'loading');
 second.resolve({value:{can_decide:false},messages:[{id:1}],next:null});
 const result=await read;assert.equal(result.value.can_decide,true);assert.equal(result.complete,true);assert.deepEqual(result.messages,[{id:1},{id:2}]);
});

test('a failed historical page leaves the first-page match actionable and explicitly partial',async()=>{
 const read=await readWholeChat(async cursor=>{if(cursor!==null)throw new Error('older unavailable');return{value:{can_decide:true},messages:[{id:2}],next:2};},byId);
 assert.equal(read.value.can_decide,true);assert.equal(read.complete,false);assert.equal(read.partialReason,'failed');assert.deepEqual(read.messages,[{id:2}]);
 assert.match(chatHistoryNotice(read),/No se ha podido completar/);
});

test('full refresh revalidates every page and removes historical rows outside the newest page',async()=>{
 const reader=createChatReader(),published=[];
 await reader.read({scope:'actor:lobby',...chat(range(1,120)),older:byId,onPage:read=>published.push(read)});
 const peer=chat(range(1,120).filter(id=>id!==10),50,id=>({id,text:id===11?'corrected':'unchanged'}));
 await reader.read({scope:'actor:lobby',...peer,older:byId,onPage:read=>published.push(read)});
 const read=published.at(-1);assert.equal(peer.calls.length,3);assert.equal(read.complete,true);
 assert.equal(read.messages.length,119);assert.equal(read.messages.some(message=>message.id===10),false);
 assert.equal(read.messages.find(message=>message.id===11).text,'corrected');
 assert.equal(published.at(-3).messages.some(message=>message.id===10),false,'first fresh page already discards the old history');
});

test('automatic poll reads one page with explicit cached history; manual refresh cannot resurrect its removed old row',async()=>{
 const reader=createChatReader();let read;
 const options={scope:'actor:lobby',older:byId,onPage:next=>{read=next;}};
 await reader.read({...options,...chat(range(1,120))});
 const peer=chat(range(1,125).filter(id=>id!==10));await reader.read({...options,...peer,full:false});
 assert.equal(peer.calls.length,1);assert.equal(read.cached,true);assert.equal(read.messages.length,125);assert.match(chatHistoryNotice(read),/volver a comprobar todo el historial/);
 await reader.read({...options,...peer});assert.equal(read.cached,false);assert.equal(read.messages.some(message=>message.id===10),false);assert.equal(read.messages.length,124);
});

test('the 40-page and 2000-message limits cannot be enlarged by a caller',async()=>{
 const peer=chat(range(1,4000));const read=await readWholeChat(peer.fetchPage,byId,{maxPages:100});
 assert.equal(peer.calls.length,CHAT_MAX_PAGES);assert.equal(read.messages.length,CHAT_MAX_MESSAGES);assert.equal(read.complete,false);assert.equal(read.partialReason,'limit');
 assert.match(chatHistoryNotice(read),/parcial/);
});

test('a stalled older read, even ignoring AbortSignal, ends at the budget with recent data retained',async()=>{
 let signal;const started=Date.now();
 const read=await readWholeChat(async(cursor,options)=>{signal=options.signal;if(cursor!==null)return new Promise(()=>{});return{value:{can_decide:true},messages:[{id:2}],next:2};},byId,{budgetMs:20});
 assert(Date.now()-started<1000);assert.equal(signal.aborted,true);assert.equal(read.partialReason,'timeout');assert.equal(read.value.can_decide,true);
});

test('a first-page timeout reports an error, while cancellation is silent AbortError',async()=>{
 await assert.rejects(readWholeChat(()=>new Promise(()=>{}),byId,{budgetMs:15}),/no ha respondido a tiempo/);
 const controller=new AbortController();const pending=readWholeChat(()=>new Promise(()=>{}),byId,{signal:controller.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;
});

test('401/403/404 on an older page invalidate the read rather than retaining authorized-looking stale data',async()=>{
 for(const status of[401,403,404])await assert.rejects(readWholeChat(async cursor=>{if(cursor!==null)throw Object.assign(new Error('revoked'),{status});return{value:{can_decide:true},messages:[{id:2}],next:2};},byId),{status});
});

test('a repeating or empty cursor page stops with partial coverage instead of an endless request loop',async()=>{
 let calls=0;const read=await readWholeChat(async()=>{calls++;return{value:{},messages:[{id:2}],next:2};},byId);
 assert.equal(calls,2);assert.equal(read.partialReason,'invalid');assert.equal(read.complete,false);
 const empty=await readWholeChat(async cursor=>cursor===null?{value:{},messages:[{id:2}],next:2}:{value:{},messages:[],next:1},byId);
 assert.equal(empty.partialReason,'invalid');assert.deepEqual(empty.messages,[{id:2}]);
});

test('overlapping timer or manual calls reuse one active full read instead of starting more HTTP work',async()=>{
 const reader=createChatReader(),first=deferred();let calls=0,published=0;
 const options={scope:'actor:lobby',older:byId,fetchPage:()=>{calls++;return first.promise;},onPage:()=>{published++;}};
 const a=reader.read(options),b=reader.read({...options,full:false}),c=reader.read(options);
 assert.strictEqual(a,b);assert.strictEqual(a,c);assert.equal(calls,1);
 first.resolve({value:{},messages:[{id:1}],next:null});await a;assert.equal(published,1);
});

for(const nextScope of ['actor:lobby-B','other-actor:lobby'])test(`switching to ${nextScope} cancels old work and cannot publish its rows`,async()=>{
 const reader=createChatReader(),old=deferred(),published=[];let oldSignal,oldCalls=0;
 const pending=reader.read({scope:'actor:lobby',older:byId,fetchPage:(_cursor,{signal})=>{oldCalls++;oldSignal=signal;return old.promise;},onPage:read=>published.push({owner:'old',read})});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await reader.read({scope:nextScope,older:byId,...chat([99]),onPage:read=>published.push({owner:'new',read})});
 assert.equal(oldSignal.aborted,true);await rejected;
 old.resolve({value:{},messages:[{id:1}],next:1});await tick();
 assert.equal(oldCalls,1);assert.deepEqual(published.map(entry=>entry.owner),['new']);assert.deepEqual(published[0].read.messages,[{id:99}]);
});

test('an explicit full refresh replaces an in-flight poll and does not accept its late cached result',async()=>{
 const reader=createChatReader(),poll=deferred(),published=[];
 await reader.read({scope:'actor:lobby',older:byId,...chat(range(1,120))});
 const pending=reader.read({scope:'actor:lobby',older:byId,full:false,fetchPage:()=>poll.promise,onPage:read=>published.push(read)});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await reader.read({scope:'actor:lobby',older:byId,...chat([200]),onPage:read=>published.push(read)});await rejected;
 poll.resolve({value:{},messages:[{id:125}],next:125});await tick();
 assert.equal(published.length,1);assert.deepEqual(published[0].messages,[{id:200}]);
});

test('a revoked view clears reusable history before a later allowed read',async()=>{
 const reader=createChatReader();let result;
 await reader.read({scope:'actor:lobby',older:byId,...chat(range(1,120))});
 await assert.rejects(reader.read({scope:'actor:lobby',older:byId,fetchPage:()=>{throw Object.assign(new Error('revoked'),{status:403});}}),{status:403});
 await reader.read({scope:'actor:lobby',older:byId,full:false,...chat(range(101,150)),onPage:read=>{result=read;}});
 assert.equal(result.cached,false);assert.equal(result.messages.length,50);assert.equal(result.messages.some(message=>message.id===10),false);
});


test('repeated recent-page polls never grow the retained history beyond the same 2000-row limit',async()=>{
 const reader=createChatReader(),options={scope:'actor:lobby',older:byId};
 await reader.read({...options,...chat(range(1,2000))});
 let read;
 for(let latest=2050;latest<=2200;latest+=50)read=await reader.read({...options,full:false,...chat(range(1,latest))});
 assert.equal(read.messages.length,CHAT_MAX_MESSAGES);assert.equal(read.messages[0].id,201);assert.equal(read.complete,false);assert.equal(read.partialReason,'limit');
});
