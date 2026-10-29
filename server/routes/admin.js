import { Router } from 'express';
import { requireAdmin, requireAuth, HttpError } from '../auth.js';
import { canManageStaff } from '../../shared/access.js';
import { getStaffDirectory, setStaffAccess, setRankedStatisticsAccess } from '../integration.js';
import { rememberStaffAccess, rememberStaffDirectory } from '../ruleta.js';
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
const staffManager = (req, res, next) => {
  if (!canManageStaff(req.user)) throw new HttpError(403, 'La gestión de staff requiere administración o coordinación de CTP.');
  next();
};
// Lo que se lee o cambia aquí se apunta también en la copia de la ruleta,
// para que el distintivo de staff cambie sin esperar a la siguiente recarga.
adminRouter.get('/staff-access', requireAuth, staffManager, async (req, res) => {
  const directory = await getStaffDirectory(req.user, req.query);
  rememberStaffDirectory(directory.items);
  res.json(directory);
});
adminRouter.patch('/staff-access/:id', requireAuth, staffManager, async (req, res) => {
  const change = await setStaffAccess(req.user, req.params.id, req.body);
  rememberStaffAccess(change);
  res.json(change);
});
adminRouter.patch('/staff-access/:id/ranked-statistics', requireAuth, staffManager, async (req, res) => {
  if (Object.keys(req.query).length) throw new HttpError(400, 'El permiso de estadísticas no admite parámetros.');
  res.json(await setRankedStatisticsAccess(req.user, req.params.id, req.body));
});
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
