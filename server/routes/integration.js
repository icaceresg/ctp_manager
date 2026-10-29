import { Router } from 'express';
import { allow, requireAdmin, requireAuth } from '../auth.js';
import { getIncidentContext, integrationStatus, sendOperationCommand, syncOperations, getCompetitionData, getOperationHistory, getOfficialMatchDossier, getGuardState, getRankedState, getRankedMonitor, getRankedStatistics, getRankedLobbyDetail, sendRankedLobbyChat, decideRankedLobby, banRankedPlayer, getClubCandidates, getProViewState } from '../integration.js';
import { canManageRanked, canReadRankedStatistics } from '../../shared/access.js';
import { getCommand, prepareGuardCommand, prepareRankedCommand, prepareManualClubCommand, prepareProViewCommand } from '../operations.js';
import { PRO_VIEW_ACTION } from '../pro-view-contract.js';
import { GUARD_ACTIONS } from '../guard-contract.js';
import { HttpError } from '../auth.js';
import {getPlayerWorkspace} from '../integration.js';
import { getCaseData,getOfficialIncident,getTicketThread,ticketAction,getDisciplineOverview,getDisciplineUsers,getDisciplineHistory,writeDiscipline } from '../integration.js';
import { prepareCaseCommand } from '../operations.js';

export const integrationRouter = Router();
const requireRanked=(req,res,next)=>canManageRanked(req.user)?next():res.status(403).json({error:'La supervisión de Ranked requiere ser administrador o árbitro de CTP.'});
const requireRankedStatistics=(req,res,next)=>canReadRankedStatistics(req.user)?next():res.status(403).json({error:'No tienes permiso para consultar las estadísticas de Ranked.'});
integrationRouter.get('/operations/pro-view', requireAuth, allow('realizacion'), async (req, res) => res.json(await getProViewState(req.user)));
integrationRouter.post('/operations/pro-view/commands', requireAuth, allow('realizacion'), async (req, res) => {
  const state = await getProViewState(req.user);
  res.json(prepareProViewCommand(req.user, req.body || {}, state));
});
integrationRouter.post('/operations/pro-view/commands/:id/send', requireAuth, allow('realizacion'), async (req, res) => {
  const command = getCommand(req.params.id);
  if (command.type !== PRO_VIEW_ACTION || (!req.user.is_admin && command.actor_id !== req.user.id)) throw new HttpError(403, 'Solo puedes enviar tus propias propuestas de Pro View.');
  res.json(await sendOperationCommand(command.id));
});
integrationRouter.get('/operations/matches/:id',requireAuth,allow('operaciones','arbitraje','casters','realizacion'),async(req,res)=>res.json(await getOfficialMatchDossier(req.user,req.params.id)));
integrationRouter.get('/operations/cases',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getCaseData(req.user,req.query)));
integrationRouter.get('/operations/incidents/:id',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getOfficialIncident(req.user,req.params.id)));
integrationRouter.post('/operations/cases/commands',requireAuth,allow('arbitraje'),(req,res)=>res.json(prepareCaseCommand(req.user,req.body||{})));
integrationRouter.use('/operations/integration', requireAuth);
integrationRouter.get('/operations/integration', allow('operaciones', 'arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones'), (req, res) => res.json(integrationStatus()));
integrationRouter.post('/operations/integration/sync', allow('operaciones'), async (req, res) => res.json(await syncOperations()));
integrationRouter.post('/operations/integration/commands/:id/send', requireAdmin, async (req, res) => res.json(await sendOperationCommand(req.params.id)));
integrationRouter.get('/operations/tickets/:id',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getTicketThread(req.user,req.params.id)));
integrationRouter.post('/operations/tickets/:id/actions',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await ticketAction(req.user,req.params.id,req.body||{})));
// Sanciones: read straight from CTP; each write is applied by CTP at once.
integrationRouter.get('/operations/discipline/overview',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getDisciplineOverview(req.user)));
integrationRouter.get('/operations/discipline/users',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getDisciplineUsers(req.user,req.query)));
integrationRouter.get('/operations/discipline/users/:id',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getDisciplineHistory(req.user,req.params.id)));
integrationRouter.post('/operations/discipline/sanctions',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await writeDiscipline(req.user,'sanction',null,req.body||{})));
for(const action of ['revoke','review'])integrationRouter.post(`/operations/discipline/sanctions/:id/${action}`,requireAuth,allow('arbitraje'),async(req,res)=>res.json(await writeDiscipline(req.user,action,req.params.id,req.body||{})));
integrationRouter.post('/operations/discipline/bans/:id/lift',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await writeDiscipline(req.user,'lift',req.params.id,req.body||{})));
integrationRouter.get('/operations/incidents/:id/context', requireAuth, allow('arbitraje'), async (req, res) => res.json(await getIncidentContext(req.user, req.params.id, req.query.cursor)));
integrationRouter.get('/operations/competition', requireAuth, allow('operaciones', 'arbitraje'), async (req, res) => res.json(await getCompetitionData(req.user, req.query)));
integrationRouter.get('/operations/history', requireAuth, allow('operaciones', 'arbitraje'), async (req, res) => res.json(await getOperationHistory(req.user, req.query)));
integrationRouter.get('/operations/matches/:id/guard',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getGuardState(req.user,req.params.id)));
integrationRouter.get('/operations/ranked', requireAuth, requireAdmin, async (req, res) => res.json(await getRankedState(req.user)));
integrationRouter.get('/operations/ranked/monitor', requireAuth, requireRanked, async (req, res) => res.json(await getRankedMonitor(req.user)));
integrationRouter.get('/operations/ranked/statistics', requireAuth, requireRankedStatistics, async (req, res) => {
  if (Object.keys(req.query).some(key => key !== 'period')) throw new HttpError(400, 'La consulta de estadísticas no es válida.');
  res.json(await getRankedStatistics(req.user, req.query.period));
});
integrationRouter.get('/operations/ranked/lobbies/:id',requireAuth,requireRanked,async(req,res)=>{
  if(Object.keys(req.query).some(key=>key!=='before'))throw new HttpError(400,'La consulta del chat no es válida.');
  res.json(await getRankedLobbyDetail(req.user,req.params.id,req.query.before));
});
integrationRouter.post('/operations/ranked/lobbies/:id/chat',requireAuth,requireRanked,async(req,res)=>{
 if(Object.keys(req.query).length)throw new HttpError(400,'La solicitud del mensaje no admite parámetros.');
 res.json(await sendRankedLobbyChat(req.user,req.params.id,req.body));
});
integrationRouter.post('/operations/ranked/lobbies/:id/decision',requireAuth,requireRanked,async(req,res)=>{
 if(Object.keys(req.query).length)throw new HttpError(400,'La decisión no admite parámetros.');
 res.json(await decideRankedLobby(req.user,req.params.id,req.body));
});
integrationRouter.post('/operations/ranked/lobbies/:id/ban',requireAuth,requireRanked,async(req,res)=>{
 if(Object.keys(req.query).length)throw new HttpError(400,'El bloqueo no admite parámetros.');
 res.json(await banRankedPlayer(req.user,req.params.id,req.body));
});
integrationRouter.get('/operations/clubs/candidates', requireAuth, requireAdmin, async (req, res) => res.json(await getClubCandidates(req.user, req.query.query)));
integrationRouter.post('/operations/clubs/create', requireAuth, requireAdmin, (req, res) => res.json(prepareManualClubCommand(req.user, req.body)));
integrationRouter.post('/operations/ranked/commands', requireAuth, requireAdmin, async (req, res) => {
  const state = await getRankedState(req.user); res.json(prepareRankedCommand(req.user, req.body, state));
});
integrationRouter.post('/operations/matches/:id/guard/commands',requireAuth,allow('arbitraje'),async(req,res)=>{
 const state=await getGuardState(req.user,req.params.id);
 res.json(prepareGuardCommand(req.user,req.body,state));
});
integrationRouter.post('/operations/guard/commands/:id/send',requireAuth,allow('arbitraje'),async(req,res)=>{
 const command=getCommand(req.params.id);
 if(!GUARD_ACTIONS.includes(command.type)||(!req.user.is_admin&&command.actor_id!==req.user.id))throw new HttpError(403,'Solo puedes enviar tus propias decisiones Guard.');
 res.json(await sendOperationCommand(req.params.id));
});

const playerQuery=(query,keys)=>{
 if(Object.keys(query).some(key=>!keys.includes(key)))throw new HttpError(400,'La consulta de jugadores no es válida.');
 const out={...query};
 for(const key of keys.filter(key=>key==='limit'||key.endsWith('offset'))){
  if(out[key]!==undefined){if(typeof out[key]!=='string'||!/^(0|[1-9][0-9]{0,5})$/.test(out[key]))throw new HttpError(400,'La paginación no es válida.');out[key]=Number(out[key]);}
 }
 return out;
};
integrationRouter.get('/players',requireAuth,requireRanked,async(req,res)=>{
 res.json(await getPlayerWorkspace(req.user,{...playerQuery(req.query,['query','offset','limit']),operation:'search'}));
});
integrationRouter.get('/players/:userId',requireAuth,requireRanked,async(req,res)=>{
 res.json(await getPlayerWorkspace(req.user,{...playerQuery(req.query,['limit','results_offset','tickets_offset','sanctions_offset']),operation:'detail',user_id:req.params.userId}));
});
