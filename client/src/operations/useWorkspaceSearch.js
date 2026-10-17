import {useEffect,useRef,useState} from 'react';

// Keep typing synchronous. Router navigation can otherwise restore an older
// controlled value while the next keystroke is already being processed.
export function useWorkspaceSearch(params,setParams,key='q') {
  const value=params.get(key)||'';
  const [search,setSearch]=useState(value);
  const committed=useRef(value);
  const timer=useRef(null);
  useEffect(()=>{if(value!==committed.current){clearTimeout(timer.current);committed.current=value;setSearch(value);}},[value]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const update=next=>{
    setSearch(next);clearTimeout(timer.current);
    timer.current=setTimeout(()=>{
      committed.current=next;
      setParams(previous=>{const result=new URLSearchParams(previous);next?result.set(key,next):result.delete(key);for(const field of ['op_page','op_match_page','op_revision'])result.delete(field);return result;},{replace:true});
    },250);
  };
  return[search,update];
}
