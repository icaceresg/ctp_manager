import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {useApp} from '../context.jsx';
import {createSafetyResource} from './safetyResource.js';

export function useSafetyResource(key,load,accept) {
  const {me,version}=useApp(),callbacks=useRef({load,accept});callbacks.current={load,accept};
  const actor=JSON.stringify([me?.auth_mode,me?.ctp_user_id||me?.id,me?.is_admin,me?.ctp_role]);
  const resource=useMemo(()=>createSafetyResource({load:()=>callbacks.current.load(),accept:value=>callbacks.current.accept(value)}),[key,actor]);
  const state=useSyncExternalStore(resource.subscribe,resource.getSnapshot,resource.getSnapshot);
  useEffect(()=>{resource.activate();void resource.read();return()=>resource.dispose();},[resource,version]);
  return {...state,scope:resource,reload:resource.read,mutate:resource.mutate};
}
