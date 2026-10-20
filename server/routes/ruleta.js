import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { draw, listDraws, listParticipants } from '../ruleta.js';

// Todo lo de la ruleta exige sesión iniciada: entra quien tenga cuenta en el manager.
export const ruletaRouter = Router();
ruletaRouter.use('/ruleta', requireAuth);

ruletaRouter.get('/ruleta/participants', (req, res) => res.json(listParticipants()));

ruletaRouter.post('/ruleta/draw', (req, res) => res.status(201).json(draw(req.body, req.user.id)));

ruletaRouter.get('/ruleta/draws', (req, res) => res.json(listDraws()));
