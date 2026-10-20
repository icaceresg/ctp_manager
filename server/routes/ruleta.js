import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { draw, listDraws, listParticipants } from '../ruleta.js';

// Todo lo de la ruleta exige una sesión válida de staff (la misma comprobación
// que Manager: cuenta CTP con rol admin/referee o staff local en desarrollo).
export const ruletaRouter = Router();
ruletaRouter.use('/ruleta', requireAuth);

ruletaRouter.get('/ruleta/participants', async (req, res) => res.json(await listParticipants(req.user)));

ruletaRouter.post('/ruleta/participants/refresh', async (req, res) => res.json(await listParticipants(req.user, { force: true })));

ruletaRouter.post('/ruleta/draw', async (req, res) => res.status(201).json(await draw(req.user, req.body || {})));

ruletaRouter.get('/ruleta/draws', (req, res) => res.json(listDraws()));
