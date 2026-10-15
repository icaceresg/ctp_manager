// Isolated staff workflow QA. Never uses the normal database or remote CTP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-manager-staff-qa-'));
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'qa.sqlite'), PORT: process.env.QA_PORT || '3228', PUBLIC_ORIGIN: '', CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', CTP_ENABLE_WRITES: 'false', OBS_ENABLE_CONTROL: 'false' });
const { db } = await import('../server/db.js');
const { hashPassword, describeUser } = await import('../server/auth.js');
const { ingestSnapshot, createAssignment } = await import('../server/operations.js');
const { createRundown } = await import('../server/rundowns.js');
const { madridDay, shiftDay } = await import('../client/src/operations/staffModel.js');
const now = Date.now();
const password = 'Qa-Only-Staff-2026!';
for (const user of [{ id:1,username:'qa_staff_admin',name:'QA Coordinación',admin:1 },{ id:2,username:'qa_staff_referee',name:'QA Árbitra A',role:'ÁRBITROS' },{ id:3,username:'qa_staff_referee_b',name:'QA Árbitro B',role:'ÁRBITROS' },{ id:4,username:'qa_staff_producer',name:'QA Producción',role:'PRODUCCIÓN' }]) {
  db.prepare('INSERT INTO users(id,username,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?,?)').run(user.id,user.username,user.name,hashPassword(password),user.admin||0,now);
  if (user.role) db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(user.id,db.prepare('SELECT id FROM roles WHERE name=?').get(user.role).id);
  for (let n=0;n<3;n++) db.prepare("INSERT INTO availability(user_id,date,status,note,updated_at) VALUES(?,?,'disponible','Prueba aislada',?)").run(user.id,shiftDay(madridDay(now),n),now);
}
const schedule = new Date(now + 2*3600000).toISOString();
const base = {kind:'tournament',title:'QA · Staff Cup',status:'scheduled',scheduled_at:schedule,team_a:{id:'qa-a',name:'QA Ámbar'},team_b:{id:'qa-b',name:'QA Marfil'},score_a:null,score_b:null,confirmed:false,web_path:'/torneos/qa',roster:[],statistics:[],maps:[]};
ingestSnapshot({generated_at:new Date().toISOString(),matches:[{...base,id:'qa-staff-match-1'},{...base,id:'qa-staff-match-2',title:'QA · Partido simultáneo'}],incidents:[{id:'qa-staff-incident-1',kind:'tournament',match_id:'qa-staff-match-1',title:'QA · Revisar marcador comunicado',reason:'Expediente sintético para comprobar filtros y seguimiento. No representa una incidencia real.',status:'open',priority:'urgent',version:1,created_at:new Date(now-3*3600000).toISOString()}],stats:[],clubs:[],deliveries:[]});
const admin=describeUser(db.prepare('SELECT * FROM users WHERE id=1').get());
createAssignment(admin,{match_id:'qa-staff-match-1',user_id:2,role:'referee',starts_at:new Date(now+3600000).toISOString(),ends_at:new Date(now+4*3600000).toISOString()});
createAssignment(admin,{match_id:'qa-staff-match-1',user_id:4,role:'producer',starts_at:new Date(now+3600000).toISOString(),ends_at:new Date(now+4*3600000).toISOString()});
createRundown({title:'QA · Preparación staff',description:'Solo pruebas'});
db.close();
const server=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server/index.js'],{cwd:root,env:{...process.env,OPEN_BROWSER:'0'},stdio:'inherit',windowsHide:true});
console.log(`Staff QA only: ${directory}; http://localhost:${process.env.PORT}; accounts qa_staff_admin / qa_staff_referee / qa_staff_referee_b / qa_staff_producer; password ${password}`);
process.on('SIGINT',()=>server.kill());process.on('SIGTERM',()=>server.kill());server.on('exit',(code)=>{process.exitCode=code||0;});
