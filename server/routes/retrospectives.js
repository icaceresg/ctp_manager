import { Router } from 'express';
import { db } from '../db.js';
import { HttpError, requireAuth, CTP_AUTH_ENABLED } from '../auth.js';
import { canUseRetrospectives } from '../../shared/access.js';
import { createRetrospectiveStore, RetrospectiveError } from '../retrospectives.js';

/** Internal SQLite feature: no CTP mutation, notification dispatch or author audit. */
export function createRetrospectivesRouter(store, authenticate = requireAuth) {
  const router = Router();
  router.use('/retrospectives', authenticate, (req, res, next) => {
    if (!canUseRetrospectives(req.user)) return res.status(403).json({ error: 'La retrospectiva es exclusiva del staff autorizado.' });
    next();
  });
  const route = (fn, status = 200) => (req, res, next) => {
    try { res.status(status).json(fn(req)); }
    catch (error) {
      next(error instanceof RetrospectiveError ? new HttpError(error.status, error.message) : error);
    }
  };
  router.get('/retrospectives', route(req => store.list(req.user)));
  router.post('/retrospectives', route(req => store.create(req.user, req.body), 201));
  router.get('/retrospectives/:id', route(req => store.detail(req.user, req.params.id)));
  router.patch('/retrospectives/:id', route(req => store.update(req.user, req.params.id, req.body)));
  router.post('/retrospectives/:id/items', route(req => store.createItem(req.user, req.params.id, req.body), 201));
  router.patch('/retrospectives/:id/items/:itemId', route(req => store.updateItem(req.user, req.params.id, req.params.itemId, req.body)));
  router.delete('/retrospectives/:id/items/:itemId', route(req => store.archiveItem(req.user, req.params.id, req.params.itemId, req.body || {})));
  router.post('/retrospectives/:id/items/:itemId/vote', route(req => store.vote(req.user, req.params.id, req.params.itemId, req.body)));
  router.post('/retrospectives/:id/items/:itemId/comments', route(req => store.createComment(req.user, req.params.id, req.params.itemId, req.body), 201));
  router.post('/retrospectives/:id/actions', route(req => store.createAction(req.user, req.params.id, req.body), 201));
  router.patch('/retrospectives/:id/actions/:actionId', route(req => store.updateAction(req.user, req.params.id, req.params.actionId, req.body)));
  router.get('/retrospectives/:id/export', route(req => store.export(req.user, req.params.id)));
  return router;
}

export const retrospectivesRouter = createRetrospectivesRouter(createRetrospectiveStore(db, { authMode: CTP_AUTH_ENABLED ? 'ctp' : 'local' }));
