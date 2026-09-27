import { Router } from 'express';
import {
  changeOwnPassword,
  createSession,
  currentUser,
  describeUser,
  destroySession,
  hasUsers,
  login,
  readSessionToken,
  requireAuth,
  setupAdmin,
} from '../auth.js';

export const authRouter = Router();

authRouter.get('/auth/status', (req, res) => {
  const user = currentUser(req);
  res.json({ setup: hasUsers(), authenticated: Boolean(user), user });
});

// Primera vez: se crea la cuenta del administrador.
authRouter.post('/auth/setup', (req, res) => {
  const id = setupAdmin(req.body || {});
  createSession(res, id);
  res.json({ ok: true });
});

authRouter.post('/auth/login', (req, res) => {
  const user = login(req.body?.username, req.body?.password);
  createSession(res, user.id);
  res.json({ ok: true, user: describeUser(user) });
});

authRouter.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json(req.user));

authRouter.post('/me/password', requireAuth, (req, res) => {
  changeOwnPassword(req.user.id, req.body?.current, req.body?.next, readSessionToken(req));
  res.json({ ok: true });
});
