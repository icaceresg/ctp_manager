import { Router } from 'express';
import { allow, requireAdmin, requireAuth } from '../auth.js';
import { getIncidentContext, integrationStatus, sendOperationCommand, syncOperations, getCompetitionData, getOperationHistory, getOfficialMatchDossier, getGuardState, getRankedState, getClubCandidates } from '../integration.js';
import { getCommand, prepareGuardCommand, prepareRankedCommand, prepareManualClubCommand } from '../operations.js';
import { GUARD_ACTIONS } from '../guard-contract.js';
import { HttpError } from '../auth.js';
import { getCaseData,getOfficialIncident } from '../integration.js';
import { prepareCaseCommand } from '../operations.js';

export const integrationRouter = Router();
integrationRouter.get('/operations/matches/:id',requireAuth,allow('operaciones','arbitraje','casters','realizacion'),async(req,res)=>res.json(await getOfficialMatchDossier(req.user,req.params.id)));
integrationRouter.get('/operations/cases',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getCaseData(req.user,req.query)));
integrationRouter.get('/operations/incidents/:id',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getOfficialIncident(req.user,req.params.id)));
integrationRouter.post('/operations/cases/commands',requireAuth,allow('arbitraje'),(req,res)=>res.json(prepareCaseCommand(req.user,req.body||{})));
integrationRouter.use('/operations/integration', requireAuth);
integrationRouter.get('/operations/integration', allow('operaciones', 'arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones'), (req, res) => res.json(integrationStatus()));
integrationRouter.post('/operations/integration/sync', allow('operaciones'), async (req, res) => res.json(await syncOperations()));
integrationRouter.post('/operations/integration/commands/:id/send', requireAdmin, async (req, res) => res.json(await sendOperationCommand(req.params.id)));
integrationRouter.get('/operations/incidents/:id/context', requireAuth, allow('arbitraje'), async (req, res) => res.json(await getIncidentContext(req.user, req.params.id, req.query.cursor)));
integrationRouter.get('/operations/competition', requireAuth, allow('operaciones', 'arbitraje'), async (req, res) => res.json(await getCompetitionData(req.user, req.query)));
integrationRouter.get('/operations/history', requireAuth, allow('operaciones', 'arbitraje'), async (req, res) => res.json(await getOperationHistory(req.user, req.query)));
integrationRouter.get('/operations/matches/:id/guard',requireAuth,allow('arbitraje'),async(req,res)=>res.json(await getGuardState(req.user,req.params.id)));
integrationRouter.get('/operations/ranked', requireAuth, requireAdmin, async (req, res) => res.json(await getRankedState(req.user)));
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
