import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth.js';
import {
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  getUser,
  listRoles,
  listUsers,
  updateRole,
  updateUser,
} from '../users.js';

export const adminRouter = Router();
adminRouter.use('/users', requireAuth, requireAdmin);
adminRouter.use('/roles', requireAuth, requireAdmin);

adminRouter.get('/users', (req, res) => res.json(listUsers()));

adminRouter.post('/users', (req, res) => res.status(201).json(getUser(createUser(req.body))));

adminRouter.patch('/users/:id', (req, res) => res.json(getUser(updateUser(req.params.id, req.body, req.user.id))));

adminRouter.delete('/users/:id', (req, res) => {
  deleteUser(req.params.id, req.user.id);
  res.json({ ok: true });
});

adminRouter.get('/roles', (req, res) => res.json(listRoles()));

adminRouter.post('/roles', (req, res) => res.status(201).json(createRole(req.body)));

adminRouter.patch('/roles/:id', (req, res) => res.json(updateRole(req.params.id, req.body)));

adminRouter.delete('/roles/:id', (req, res) => {
  deleteRole(req.params.id);
  res.json({ ok: true });
});
