/** A safety detail is usable only after a current successful read. Reads,
 * permission failures and unmounts invalidate every older mutation callback.
 * An uncertain write clears the snapshot and requires a read; domain intents
 * keep their original nonce separately and are never retried automatically. */
export function createSafetyResource({load,accept}) {
  let active=true,sequence=0;
  let state={data:null,loading:true,busy:false,error:null,needsRead:true};
  const listeners=new Set();
  const publish=next=>{state={...state,...next};for(const fn of listeners)fn();};
  const current=request=>active&&request===sequence;
  const failure=(request,error)=>{if(current(request))publish({data:null,loading:false,busy:false,error,needsRead:true});};
  return {
    getSnapshot:()=>state,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    activate(){active=true;},
    dispose(){active=false;sequence++;},
    async read(){
      const request=++sequence;
      if(!current(request))return;
      publish({data:null,loading:true,busy:false,error:null,needsRead:true});
      try{
        const result=await load();if(!current(request))return;
        const data=accept(result);publish({data,loading:false,error:null,needsRead:!data});
      }catch(error){failure(request,error);}
    },
    async mutate(send,onAccepted=()=>{}){
      if(!active||!state.data||state.loading||state.busy||state.needsRead||state.error)return false;
      const request=++sequence,value=state.data;
      publish({busy:true,error:null});
      try{
        const result=await send(value);if(!current(request))return false;
        const data=accept(result);if(!data)throw Error('CTP no ha confirmado el estado. Actualiza antes de continuar.');
        onAccepted(data);if(!current(request))return false;
        publish({data,busy:false,error:null,needsRead:false});return true;
      }catch(error){failure(request,error);return false;}
    },
  };
}
