import { api } from '../api.js';
import { useData } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { Field, FormDialog } from '../operations/ui.jsx';
import { dateTime } from '../operations/model.js';
import { profileChanges } from './userProfileModel.js';

const ROLE={admin:'Administrador',referee:'Árbitro',player:'Jugador'};
const PLATFORMS=[['PC','PC'],['PlayStation','PlayStation'],['Xbox','Xbox'],['Switch','Switch'],['Movil','Móvil'],['Otra','Otra']];
/** Direct, versioned correction of a CTP account; CTP validates and audits each change. */
export default function UserProfileDialog({id,onClose,onSaved}){
  const {data:profile,loading,error,reload}=useData(()=>api.get(`/administration/users/${id}`),[id]);
  if(!profile)return <FormDialog title="Editar datos de la cuenta" onClose={onClose} submitLabel="Guardar cambios" submit={()=>{throw new Error(error?'Vuelve a cargar la cuenta.':'Espera a que se cargue la cuenta.');}}>
    {loading?<p role="status"><Spinner/> Cargando cuenta…</p>:<p className="op-error" role="alert">{error?.message||'No se ha podido cargar la cuenta.'}<button className="btn" type="button" onClick={reload}>Reintentar</button></p>}
  </FormDialog>;
  return <FormDialog title="Editar datos de la cuenta" onClose={onClose} submitLabel="Guardar cambios" help="Los cambios se aplican en CTP al guardar y quedan registrados en la auditoría. El rol se gestiona desde la asignación de staff." submit={async body=>{
    const changes=profileChanges(profile,body);
    if(!Object.keys(changes).length)throw new Error('No hay cambios que guardar.');
    if(changes.email&&body.confirm_email!=='on')throw new Error('Confirma el cambio de correo de acceso.');
    await api.patch(`/administration/users/${id}`,{expected_version:profile.manager_version,changes});
    onSaved();
  }}>
    <p><strong>{profile.username}</strong> · {ROLE[profile.role]||profile.role} · alta {dateTime(profile.created_at)}</p>
    {profile.meta?.content_omitted&&<p className="muted">Hay contenido original omitido por tamaño. Puedes corregir los campos visibles; sólo se sustituye un campo omitido si escribes un valor nuevo.</p>}
    <div className="op-form-grid">
      <Field label="Nombre de usuario" hint="Entre 3 y 20 caracteres. También sirve para iniciar sesión."><input name="username" required minLength={3} maxLength={20} defaultValue={profile.username}/></Field>
      <Field label="Correo de acceso" hint={profile.email_confirmed?'Correo verificado.':'Correo sin verificar.'}><input name="email" type="email" required maxLength={254} defaultValue={profile.email||''}/></Field>
      <Field label="Gamertag"><input name="gamertag" required maxLength={50} defaultValue={profile.gamertag}/></Field>
      <Field label="ActivisionID" hint="El nombre sin # ni números finales es válido. Si la cuenta tiene #número, consérvalo. Entre 2 y 16 caracteres de nombre; vacío para quitarlo."><input name="activision_id" maxLength={40} defaultValue={profile.activision_id||''}/></Field>
      <Field label="Plataforma"><select name="platform" defaultValue={profile.platform}>{PLATFORMS.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></Field>
      <Field label="Fecha de nacimiento"><input name="birthdate" type="date" min="1900-01-01" defaultValue={profile.birthdate||''}/></Field>
      <Field label="Discord"><input name="discord" maxLength={100} defaultValue={profile.discord||''}/></Field>
      <Field label="X (Twitter)" hint="Sin @."><input name="twitter" maxLength={50} defaultValue={profile.twitter||''}/></Field>
    </div>
    <Field label="Biografía"><textarea name="bio" rows={3} maxLength={500} defaultValue={profile.bio||''}/></Field>
    <label className="op-check"><input type="checkbox" name="confirm_email"/> Si cambio el correo, el jugador pasará a iniciar sesión con el nuevo inmediatamente.</label>
  </FormDialog>;
}

