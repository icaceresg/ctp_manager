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
  CTP_AUTH_ENABLED,
  AUTH_CONFIG,
  loginCtp,
} from '../auth.js';

export const authRouter = Router();

authRouter.get('/auth/status', async (req, res) => {
  const user = await currentUser(req);
  res.json({ setup: CTP_AUTH_ENABLED || hasUsers(), authenticated: Boolean(user), user,
    provider: CTP_AUTH_ENABLED ? 'ctp' : 'local', ...(CTP_AUTH_ENABLED ? { web_origin: AUTH_CONFIG.origin } : {}) });
});

// Primera vez: se crea la cuenta del administrador.
authRouter.post('/auth/setup', (req, res) => {
  const id = setupAdmin(req.body || {});
  createSession(res, id);
  res.json({ ok: true });
});

authRouter.post('/auth/login', async (req, res) => {
  if (CTP_AUTH_ENABLED) return res.json({ ok: true, user: await loginCtp(req.body?.email ?? req.body?.username, req.body?.password, res) });
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
