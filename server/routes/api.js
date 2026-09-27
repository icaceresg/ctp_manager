import { Router } from 'express';
import { allow, requireAdmin, requireAuth } from '../auth.js';
import {
  addResource,
  createContent,
  deleteContent,
  deleteResource,
  duplicateContent,
  getContent,
  listContents,
  listOwners,
  patchContent,
  setResourceDone,
  updateContent,
} from '../contents.js';
import {
  addPart,
  createRundown,
  deletePart,
  deleteRundown,
  duplicateRundown,
  getRundown,
  listRundowns,
  reorderParts,
  updatePart,
  updateRundown,
} from '../rundowns.js';
import { deleteEventDay, listAvailability, saveEventDay, setAvailability } from '../availability.js';

export const apiRouter = Router();
apiRouter.use(requireAuth);

// Permisos por sección: "calendario" gestiona las tarjetas; "recursos" puede
// ver las tarjetas que tienen recursos y marcarlos; "escaleta" las escaletas.
const calendario = allow('calendario');
const recursos = allow('calendario', 'recursos');
const escaleta = allow('escaleta');
const disponibilidad = allow('disponibilidad');

// ---------- Contenido para redes ----------

apiRouter.get('/contents', (req, res, next) => (req.query.with_resources === '1' ? recursos : calendario)(req, res, next));

apiRouter.get('/contents', (req, res) => {
  const { from, to, unscheduled, with_resources: withResources } = req.query;
  res.json(listContents({ from, to, unscheduled: unscheduled === '1', withResources: withResources === '1' }));
});

apiRouter.get('/contents/:id', recursos, (req, res) => res.json(getContent(req.params.id)));

apiRouter.get('/owners', recursos, (req, res) => res.json(listOwners()));

apiRouter.post('/contents', calendario, (req, res) => res.status(201).json(getContent(createContent(req.body))));

apiRouter.put('/contents/:id', calendario, (req, res) => res.json(getContent(updateContent(req.params.id, req.body))));

apiRouter.patch('/contents/:id', calendario, (req, res) => res.json(getContent(patchContent(req.params.id, req.body))));

apiRouter.post('/contents/:id/duplicate', calendario, (req, res) => res.status(201).json(getContent(duplicateContent(req.params.id))));

apiRouter.delete('/contents/:id', calendario, (req, res) => {
  deleteContent(req.params.id);
  res.json({ ok: true });
});

apiRouter.post('/contents/:id/resources', recursos, (req, res) =>
  res.status(201).json(getContent(addResource(req.params.id, req.body?.text))),
);

apiRouter.patch('/resources/:id', recursos, (req, res) => res.json(getContent(setResourceDone(req.params.id, req.body?.done))));

apiRouter.delete('/resources/:id', recursos, (req, res) => res.json(getContent(deleteResource(req.params.id))));

// ---------- Escaletas ----------

apiRouter.use(['/rundowns', '/parts'], escaleta);

apiRouter.get('/rundowns', (req, res) => res.json(listRundowns()));

apiRouter.get('/rundowns/:id', (req, res) => res.json(getRundown(req.params.id)));

apiRouter.post('/rundowns', (req, res) => res.status(201).json(getRundown(createRundown(req.body))));

apiRouter.put('/rundowns/:id', (req, res) => res.json(getRundown(updateRundown(req.params.id, req.body))));

apiRouter.post('/rundowns/:id/duplicate', (req, res) => res.status(201).json(getRundown(duplicateRundown(req.params.id))));

apiRouter.delete('/rundowns/:id', (req, res) => {
  deleteRundown(req.params.id);
  res.json({ ok: true });
});

apiRouter.post('/rundowns/:id/parts', (req, res) => res.status(201).json(getRundown(addPart(req.params.id, req.body))));

apiRouter.put('/rundowns/:id/order', (req, res) => res.json(getRundown(reorderParts(req.params.id, req.body?.ids))));

apiRouter.patch('/parts/:id', (req, res) => res.json(updatePart(req.params.id, req.body)));

apiRouter.delete('/parts/:id', (req, res) => res.json(getRundown(deletePart(req.params.id))));

// ---------- Disponibilidad ----------

apiRouter.get('/availability', disponibilidad, (req, res) => res.json(listAvailability(req.user)));

// Días de evento en los que se pide disponibilidad (solo administradores).
apiRouter.post('/availability/days', requireAdmin, (req, res) => res.json(saveEventDay(req.body)));

apiRouter.delete('/availability/days/:date', requireAdmin, (req, res) => res.json(deleteEventDay(req.params.date)));

apiRouter.put('/availability/:date', disponibilidad, (req, res) => res.json({ entry: setAvailability(req.user, req.params.date, req.body) }));
