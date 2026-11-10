/** Root service configuration only. Never derived from a request or a cookie. */
export function migrationShadowEnabled(env = process.env) {
  const value = env.CTP_MANAGER_MIGRATION_SHADOW;
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new Error('manager_migration_shadow_configuration_invalid');
}

/** A shadow instance serves its build but cannot authenticate or operate CTP. */
export function migrationShadowBoundary(enabled, auth) {
  return (req, res, next) => {
    if (!enabled || !req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-store');
    if (['GET', 'HEAD'].includes(req.method) && req.path === '/api/auth/status') {
      return res.json({ setup: true, authenticated: false, user: null,
        provider: auth.mode === 'ctp' ? 'ctp' : 'local',
        ...(auth.mode === 'ctp' ? { web_origin: auth.origin } : {}),
        migration_shadow: true });
    }
    res.set('Retry-After', '60');
    return res.status(503).json({ error: 'migration_shadow', code: 'migration_shadow' });
  };
}
