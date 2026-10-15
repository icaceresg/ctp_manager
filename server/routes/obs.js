import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { obsStatus, queueObsCommand, requireObsAgent, claimObsCommand, acknowledgeObsCommand } from '../obs.js';

export const obsRouter = Router();
obsRouter.get('/operations/obs/status', requireAuth, (req, res) => res.json(obsStatus(req.user)));
obsRouter.post('/operations/obs/commands', requireAuth, (req, res) => res.status(202).json(queueObsCommand(req.user, req.body || {})));
obsRouter.post('/agent/obs/claim', requireObsAgent, (req, res) => res.json(claimObsCommand()));
obsRouter.post('/agent/obs/ack', requireObsAgent, (req, res) => res.json(acknowledgeObsCommand(req.body || {})));
