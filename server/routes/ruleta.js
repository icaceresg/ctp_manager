import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { draw, listDraws, listParticipants } from '../ruleta.js';

// Todo lo de la ruleta exige una sesión válida de staff (la misma comprobación
// que Manager: cuenta CTP con acceso a Manager o staff local en desarrollo).
// La lista se recarga sola en el servidor; no hay botón para recargarla.
export const ruletaRouter = Router();
ruletaRouter.use('/ruleta', requireAuth);

ruletaRouter.get('/ruleta/participants', async (req, res) => res.json(await listParticipants()));

ruletaRouter.post('/ruleta/draw', async (req, res) => res.status(201).json(await draw(req.user, req.body || {})));

ruletaRouter.get('/ruleta/draws', (req, res) => res.json(listDraws()));
