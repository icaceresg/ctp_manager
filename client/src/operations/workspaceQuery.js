const FILTERS=['q','state','bucket','order','scope','period','match','case','club','review','person','week','role','closed','coverage','include_closed','resource_type','resource_id'];
export function workspaceRequest(view,matchId,params) {
  const query=new URLSearchParams({view:matchId?'partido':view,limit:'30'});
  for(const key of FILTERS){const value=params.get(key);if(value)query.set(key,value);}
  if(matchId)query.set('match',matchId);
  if(params.get('op_page'))query.set('page',params.get('op_page'));
  if(params.get('op_match_page'))query.set('match_page',params.get('op_match_page'));
  if(params.get('op_revision'))query.set('revision',params.get('op_revision'));
  return `/operations/bootstrap?${query}`;
}
export function workspacePageParams(previous,page,revision,key='op_page') {
  const next=new URLSearchParams(previous);
  if(page>0){next.set(key,String(page));next.set('op_revision',revision);}else{next.delete(key);if(!next.has('op_page')&&!next.has('op_match_page'))next.delete('op_revision');}
  return next;
}
export function workspaceFirstPageParams(previous){const next=new URLSearchParams(previous);for(const key of ['op_page','op_match_page','op_revision'])next.delete(key);return next;}
