import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, UserMinus, UserPlus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { Field, FormDialog } from './ui.jsx';
import { translate, getIntlLocale } from '../i18n/runtime.js';
import { teamAdminError, teamAdministratorIntent, teamAccessLabel, teamRegistrationStatus } from './teamAdministrators.js';

function useResource(path) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const reload=useCallback(()=>{setData(null);setError('');setLoading(Boolean(path));setRevision(v=>v+1);},[path]);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    setData(null);setError('');setLoading(Boolean(path));
    if(!path)return()=>controller.abort();
    void api.get(path,{signal:controller.signal}).then(value=>{if(active)setData(value);}).catch(cause=>{if(active&&cause.name!=='AbortError')setError(teamAdminError(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[path,revision]);
  return{data,loading,error,reload};
}
export function AdministratorPicker({value,onChange,disabled=false}) {
  const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0);
  useEffect(()=>{
    const serial=++sequence.current,controller=new AbortController();setRows([]);setError('');
    if(value||query.trim().length<3){setBusy(false);return()=>controller.abort();}
    setBusy(true);
    const timer=setTimeout(()=>void api.get(`/administration/team-administrators/candidates?query=${encodeURIComponent(query.trim())}`,{signal:controller.signal}).then(result=>{if(serial===sequence.current)setRows(result.items);}).catch(cause=>{if(serial===sequence.current&&cause.name!=='AbortError')setError(teamAdminError(cause));}).finally(()=>{if(serial===sequence.current)setBusy(false);}),300);
    return()=>{++sequence.current;clearTimeout(timer);controller.abort();};
  },[query,value]);
  return <div className="op-team-admin-search"><Field label={translate('manager.teamAdmins.responsible')} hint={translate('manager.teamAdmins.administrativeHint')}><div className="op-actions"><Search size={15}/><input disabled={disabled} maxLength={40} value={value?.username??query} aria-label={translate('manager.teamAdmins.searchLabel')} placeholder={translate('manager.teamAdmins.searchPlaceholder')} onChange={event=>{setQuery(event.target.value);onChange(null);}}/></div></Field>
    {busy&&<p role="status">{translate('manager.teamAdmins.searching')}</p>}{error&&<p role="alert" className="op-error">{error}</p>}
    {!value&&<div className="op-actions">{rows.map(row=><button type="button" className="btn" disabled={disabled} key={row.user_id} onClick={()=>onChange(row)}>{row.username}</button>)}</div>}
    {!busy&&!value&&!error&&query.trim().length>=3&&!rows.length&&<p className="muted">{translate('manager.teamAdmins.noCandidates')}</p>}
  </div>;
}
export function AdministratorOverview({user}) {
  const {data,loading,error,reload}=useResource(user?`/administration/team-administrators/${user.user_id}`:null);
  const current=data?.user_id===user?.user_id?data:null;
  if(!user)return null;
  return <div className="op-team-admin-overview"><div className="op-section-title"><h3>{translate('manager.teamAdmins.overviewTitle',{name:user.username})}</h3><button type="button" className="btn" disabled={loading} onClick={reload}><RefreshCw size={14}/>{translate('manager.teamAdmins.refresh')}</button></div>
    {loading&&<p role="status">{translate('manager.teamAdmins.loading')}</p>}{error&&<p className="op-error" role="alert">{error}</p>}
    {current&&!current.teams.length&&<p className="muted">{translate('manager.teamAdmins.noManagedTeams')}</p>}
    <div className="op-team-admin-grid">{current?.teams.map(team=><article className="op-team-admin-card" key={team.team_id}><h4>{team.name} <small>{team.tag}</small></h4><p>{translate('manager.teamAdmins.players',{count:team.member_count})}</p>
      <ul>{team.entitlements.length?team.entitlements.map((entry,i)=><li key={`${entry.kind}:${entry.tournament_id??entry.season??i}`}>{teamAccessLabel(entry)}</li>):<li>{translate('manager.teamAdmins.noPass')}</li>}</ul>
      <h5>{translate('manager.teamAdmins.registrations')}</h5>{team.registrations.length?<ul>{team.registrations.map(entry=><li key={entry.tournament_id}>{entry.name} · {teamRegistrationStatus(entry.status)} · {translate('manager.teamAdmins.rosterCount',{count:entry.roster_count})}</li>)}</ul>:<p className="muted">{translate('manager.teamAdmins.noRegistrations')}</p>}
      <Link className="btn" to={`/administracion/accesos?team=${encodeURIComponent(team.team_id)}`}>{translate('manager.teamAdmins.reviewAccess')}</Link>
    </article>)}</div>
  </div>;
}
export function TeamAdministratorDirectory() {
  const {me}=useApp();const [person,setPerson]=useState(null);
  if(!me?.is_admin)return null;
  return <section className="op-card"><div className="op-section-title"><div><h2>{translate('manager.teamAdmins.directoryTitle')}</h2><p>{translate('manager.teamAdmins.directoryHelp')}</p></div></div><AdministratorPicker value={person} onChange={setPerson}/><AdministratorOverview user={person}/></section>;
}
export function TeamAdministratorsDialog({club,onClose}) {
  const {me,toast}=useApp();
  const {data,loading,error,reload}=useResource(`/administration/clubs/${club.id}/managers`);
  const current=data?.team_id===club.id?data:null;
  const [person,setPerson]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[problem,setProblem]=useState(''),[pending,setPending]=useState(null),[uncertain,setUncertain]=useState(false),[converting,setConverting]=useState(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  if(!me?.is_admin)return null;
  async function send(action,body) {
    if(busy)return false;setBusy(true);setProblem('');setPending({action,body});
    try{
      const result=await api.post(`/administration/clubs/${club.id}/managers${action==='convert'?'/convert':''}`,body);
      if(!mounted.current)return false;
      setPending(null);setUncertain(false);setReason('');setPerson(null);reload();
      toast(translate(result.changed?'manager.teamAdmins.saved':'manager.teamAdmins.unchanged'));
      return true;
    }catch(cause){
      if(!mounted.current)return false;
      setProblem(teamAdminError(cause));
      if([400,401,403,409,422].includes(cause.status)){setPending(null);setUncertain(false);reload();}
      else setUncertain(true);
      return false;
    }finally{if(mounted.current)setBusy(false);}
  }
  function change(userId,enabled) {
    if(!current||loading||error||busy||uncertain)return;
    try{void send('set',teamAdministratorIntent(current.version,userId,enabled,reason,crypto.randomUUID()));}catch(cause){setProblem(teamAdminError(cause));}
  }
  const locked=busy||uncertain;
  const ready=!!current&&!loading&&!error&&!locked&&reason.trim().length>=12;
  return <Modal title={translate('manager.teamAdmins.manageTitle',{team:club.name})} onClose={busy?undefined:onClose} size="wide" closeLabel={translate('manager.teamAdmins.close')}><div className="op-form">
    <p className="op-help">{translate('manager.teamAdmins.administrativeHint')}</p>
    {loading&&<p role="status">{translate('manager.teamAdmins.loading')}</p>}{error&&<p className="op-error" role="alert">{error}<button className="btn" disabled={busy} onClick={reload}>{translate('manager.teamAdmins.refresh')}</button></p>}
    {current&&!current.items.length&&<p className="muted">{translate('manager.teamAdmins.noAdministrators')}</p>}
    <ul className="op-team-admin-list">{current?.items.map(item=><li key={item.user_id}><span><strong>{item.username}</strong><small>{new Intl.DateTimeFormat(getIntlLocale(),{dateStyle:'medium'}).format(new Date(item.created_at))}</small></span><button className="btn" type="button" onClick={()=>setPerson(item)} disabled={locked}>{translate('manager.teamAdmins.viewTeams')}</button><button type="button" className="btn danger" disabled={!ready} onClick={()=>change(item.user_id,false)}><UserMinus size={15}/>{translate('manager.teamAdmins.revoke')}</button></li>)}</ul>
    {current?.competitive_members?.filter(member=>member.role==='lider').map(member=><div className="op-notice" key={member.user_id}><p>{translate('manager.teamAdmins.notAdministrativeYet',{name:member.username})}</p><button type="button" className="btn" disabled={locked||loading||Boolean(error)} onClick={()=>setConverting(member)}>{translate('manager.teamAdmins.convertAction')}</button></div>)}
    <Field label={translate('manager.teamAdmins.reason')} hint={translate('manager.teamAdmins.reasonHint')}><textarea minLength={12} maxLength={500} value={reason} disabled={locked} onChange={event=>setReason(event.target.value)} rows={2}/></Field>
    <AdministratorPicker value={person} onChange={setPerson} disabled={locked}/>
    <button className="btn primary" type="button" disabled={!ready||!person||current?.items.some(item=>item.user_id===person.user_id)} onClick={()=>change(person.user_id,true)}><UserPlus size={15}/>{translate('manager.teamAdmins.assign')}</button>
    {problem&&<p className="op-error" role="alert">{problem}</p>}
    {uncertain&&pending&&<div className="op-notice" role="status"><p>{translate('manager.teamAdmins.uncertainHelp')}</p><button className="btn" type="button" disabled={busy} onClick={()=>void send(pending.action,pending.body)}>{translate('manager.teamAdmins.retrySame')}</button></div>}
    <AdministratorOverview user={person}/><p className="muted"><ShieldCheck size={14}/> {translate('manager.teamAdmins.independentAccess')}</p>
    {converting&&current&&<ConvertAdministratorDialog member={converting} members={current.competitive_members} version={current.version} initialReason={reason} onClose={()=>setConverting(null)} submit={async body=>{if(uncertain)throw new Error(translate('manager.teamAdmins.uncertainHelp'));await send('convert',body);setConverting(null);}}/>}
  </div></Modal>;
}
function ConvertAdministratorDialog({member,members,version,initialReason,onClose,submit}){
  const others=members.filter(row=>row.user_id!==member.user_id);
  const requestId=useRef(crypto.randomUUID());
  return <FormDialog title={translate('manager.teamAdmins.convertTitle',{name:member.username})} onClose={onClose} submitLabel={translate('manager.teamAdmins.convertSubmit')} cancelLabel={translate('manager.teamAdmins.cancel')} closeLabel={translate('manager.teamAdmins.close')} help={translate('manager.teamAdmins.convertDescription')} submit={async input=>{
    if(input.confirm!=='on')throw new Error(translate('manager.teamAdmins.convertConfirm'));
    if(others.length&&!input.captain_id)throw new Error(translate('manager.teamAdmins.chooseCaptain'));
    await submit({user_id:member.user_id,captain_id:others.length?input.captain_id:null,expected_version:version,request_id:requestId.current,reason:input.reason});
  }}>
    {others.length?<Field label={translate('manager.teamAdmins.chooseCaptain')}><select name="captain_id" required defaultValue=""><option value="">{translate('manager.teamAdmins.captainPlaceholder')}</option>{others.map(row=><option key={row.user_id} value={row.user_id}>{row.username}</option>)}</select></Field>:<p>{translate('manager.teamAdmins.noReplacementNeeded')}</p>}
    <Field label={translate('manager.teamAdmins.reason')}><textarea name="reason" minLength={12} maxLength={500} required defaultValue={initialReason}/></Field>
    <label className="op-check"><input type="checkbox" name="confirm" required/>{translate('manager.teamAdmins.convertConfirm')}</label>
  </FormDialog>;
}
