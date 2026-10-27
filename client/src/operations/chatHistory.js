// One bounded, cancellable read. Historical failure never discards the newest page.
export const CHAT_MAX_PAGES = 40;
export const CHAT_MAX_MESSAGES = 2000;
export const CHAT_READ_BUDGET_MS = 12000;
const aborted = () => new DOMException('Chat read cancelled', 'AbortError');
const fatal = error => [401,403,404].includes(error?.status);
const ordered = (messages, older) => [...new Map(messages.map(message=>[String(message.id),message])).values()].sort(older);

export async function readWholeChat(fetchPage, older, options = {}) {
  const {signal,onPage,latestOnly=false} = options;
  const maxPages=Number.isSafeInteger(options.maxPages)&&options.maxPages>0?Math.min(CHAT_MAX_PAGES,options.maxPages):CHAT_MAX_PAGES;
  const budget=Number.isFinite(options.budgetMs)&&options.budgetMs>0?Math.min(CHAT_READ_BUDGET_MS,options.budgetMs):CHAT_READ_BUDGET_MS;
  const controller=new AbortController();
  let timedOut=false, rejectAbort;
  const cancellation=new Promise((_,reject)=>{rejectAbort=reject;});
  const cancel=()=>{controller.abort();rejectAbort(aborted());};
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;cancel();},budget);
  let cursor=null,value,pages=0,messages=[],complete=false,partialReason='loading';
  const cursors=new Set();
  const snapshot=()=>({value,messages:ordered(messages,older).slice(-CHAT_MAX_MESSAGES),complete,partialReason,pages,cached:false});
  try {
    if(signal?.aborted)throw aborted();
    for(;;){
      let page;
      try{page=await Promise.race([fetchPage(cursor,{signal:controller.signal}),cancellation]);}
      catch(error){
        if(signal?.aborted||fatal(error))throw error;
        if(!pages){if(timedOut)throw new Error('CTP no ha respondido a tiempo. Vuelve a actualizar la conversación.');throw error;}
        partialReason=timedOut?'timeout':'failed';break;
      }
      if(signal?.aborted)throw aborted();
      if(!page||!Array.isArray(page.messages)||page.messages.length>50){
        if(!pages)throw new Error('CTP ha devuelto una conversación incompleta.');
        partialReason='invalid';break;
      }
      if(!pages)value=page.value;
      pages++;messages.push(...page.messages);
      const next=page.next??null;
      if(next===null||next===''){complete=true;partialReason=null;break;}
      if(!page.messages.length||cursors.has(String(next))){partialReason='invalid';break;}
      cursors.add(String(next));cursor=next;
      partialReason=latestOnly?'latest':pages>=maxPages?'limit':'loading';
      if(latestOnly||pages>=maxPages)break;
      onPage?.(snapshot());
    }
    const result=snapshot();onPage?.(result);return result;
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
  }
}

// A poll updates only the newest page. Older rows are explicitly cached until a
// full/manual refresh replaces them exclusively with pages freshly read from CTP.
function withCachedHistory(fresh, known, older){
  if(fresh.complete||!known?.messages.length||!fresh.messages.length)return fresh;
  const oldest=fresh.messages[0],past=known.messages.filter(message=>older(message,oldest)<0);
  const all=ordered([...past,...fresh.messages],older),limited=all.length>CHAT_MAX_MESSAGES;
  return {...fresh,messages:all.slice(-CHAT_MAX_MESSAGES),complete:!limited&&known.complete,
    partialReason:limited?'limit':known.partialReason==='loading'?'latest':known.partialReason,cached:past.length>0};
}

/** One flight per view; switching actor/lobby cancels and discards its history. */
export function createChatReader(){
  let scope=null,active=null,known=null;
  const cancel=()=>{const previous=active;active=null;previous?.controller.abort();};
  return {
    cancel,
    read({scope:nextScope,fetchPage,older,full=true,onPage,...options}){
      if(scope!==nextScope){cancel();scope=nextScope;known=null;}
      if(active){
        if(!full||active.full)return active.promise;
        cancel();
      }
      const token={controller:new AbortController(),full};active=token;
      const previous=known;
      const publish=read=>{
        if(active!==token||scope!==nextScope||token.controller.signal.aborted)return;
        const result=full?read:withCachedHistory(read,previous,older);
        known=result;onPage?.(result);
      };
      token.promise=readWholeChat(fetchPage,older,{...options,signal:token.controller.signal,latestOnly:!full,onPage:publish})
        .then(read=>full?read:withCachedHistory(read,previous,older))
        .catch(error=>{if(active===token&&fatal(error))known=null;throw error;})
        .finally(()=>{if(active===token)active=null;});
      return token.promise;
    },
  };
}

export function chatHistoryNotice(chat){
  if(!chat)return '';
  if(chat.partialReason==='loading')return 'Cargando el historial. Los mensajes recientes ya están disponibles.';
  if(['failed','timeout','invalid'].includes(chat.partialReason))return 'No se ha podido completar el historial. Se muestran los mensajes consultados; puedes reintentar sin afectar a la partida.';
  if(chat.partialReason==='latest')return 'Se muestran los mensajes recientes. Pulsa «Actualizar» para comprobar el historial.';
  if(chat.partialReason==='limit')return 'Esta conversación supera el límite de lectura. Se muestran hasta 2.000 mensajes; el historial es parcial.';
  return chat.cached?'Los mensajes recientes están actualizados. Pulsa «Actualizar» para volver a comprobar todo el historial.':'';
}
