import { db } from '../db.js';
import { requireAuth, allow, HttpError, describeUser } from '../auth.js';
import { APP_ORIGIN } from '../config.js';
import { createPcCheckStore, PcCheckError } from '../pc-check.js';
import { createPcCheckRouters } from '../pc-check-http.js';

const encodedKey = process.env.PC_CHECK_EVIDENCE_KEY || '';
const key = /^[A-Za-z0-9_-]{43}$/.test(encodedKey) ? Buffer.from(encodedKey, 'base64url') : undefined;
const reviewers = () => db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name,username LIMIT 500').all().map(describeUser).filter(x=>x.is_admin||x.sections.includes('arbitraje')).map(x=>({id:x.id,name:x.name}));
const store = createPcCheckStore(db, { origin: APP_ORIGIN, key, reviewers });
const routers = createPcCheckRouters({ store, requireAuth, allow, mapError: error =>
  error instanceof PcCheckError || [401,429].includes(error.status) ? new HttpError(error.status, error.message) : error });
export const pcCheckUploadRouter = routers.uploadRouter;
export const pcCheckRouter = routers.router;
