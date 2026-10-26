import express, { Router } from 'express';

// Injected dependencies keep route tests isolated from real users, configuration and databases.
export function createPcCheckRouters({ store, requireAuth, allow, mapError = error => error, now = Date.now }) {
  const uploadBudgets = new Map();
  const handler = action => (req, res, next) => {
    try { const result = action(req, res); if (result === undefined && !res.headersSent) return next(); return result; }
    catch (error) { next(mapError(error)); }
  };
  function token(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '');
    if (!match) throw Object.assign(new Error('Necesitas una asignación válida.'), { status:401 });
    return match[1];
  }
  const uploadRouter = Router();
  uploadRouter.put('/pc-check/assignments/:id/evidence', handler((req,res) => {
    store.authenticateAssignment(req.params.id, token(req));
    const at = now();
    for (const [id, budget] of uploadBudgets) if (budget.active === 0 && budget.until <= at) uploadBudgets.delete(id);
    let budget = uploadBudgets.get(req.params.id);
    if (!budget && uploadBudgets.size < 2048) { budget = {until:at+60000,count:0,active:0}; uploadBudgets.set(req.params.id,budget); }
    if (!budget || budget.active >= 2 || (budget.until > at && budget.count >= 30)) {
      res.set('Retry-After','60'); throw Object.assign(new Error('Demasiados intentos de transferencia. Espera antes de reintentar.'),{status:429});
    }
    if (budget.until <= at) { budget.until=at+60000; budget.count=0; }
    budget.count++;budget.active++;
    let released=false;const release=()=>{if(!released){released=true;budget.active--;}};
    res.once('finish',release);res.once('close',release);
  }), express.json({ limit: '12mb' }), handler((req, res) => res.json(store.upload(req.params.id, token(req), req.body))));
  const router = Router();
  router.get('/pc-check/assignments/:id', handler((req, res) => res.json(store.getAssignment(req.params.id, token(req)))));
  router.get('/pc-check/reviewers', requireAuth, allow('arbitraje'), handler((req, res) => res.json(store.reviewerCandidates(req.user))));
  router.use('/pc-check/cases', requireAuth, allow('arbitraje'));
  router.post('/pc-check/cases', handler((req, res) => res.status(201).json(store.create(req.user, req.body))));
  router.get('/pc-check/cases', handler((req, res) => res.json(store.list(req.user, req.query))));
  router.get('/pc-check/cases/:id', handler((req, res) => res.json(store.detail(req.user, req.params.id))));
  router.post('/pc-check/cases/:id/assignment', handler((req, res) => {
    const assignment = store.issue(req.user, req.params.id);
    res.set('Content-Disposition', `attachment; filename="ctp-pc-check-${assignment.caseId}.json"`);
    res.json(assignment);
  }));
  router.get('/pc-check/cases/:id/evidence', handler((req, res) => {
    const evidence = store.evidence(req.user, req.params.id);
    res.set('Content-Disposition', `attachment; filename="ctp-pc-check-evidence-${req.params.id}.json"`);
    res.json(evidence);
  }));
  router.post('/pc-check/cases/:id/review', handler((req, res) => res.status(201).json(store.review(req.user, req.params.id, req.body))));
  router.post('/pc-check/cases/:id/reviewers', handler((req, res) => res.json(store.assignReviewer(req.user, req.params.id, req.body))));
  return { uploadRouter, router };
}
