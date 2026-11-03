// Synthetic DTOs only. No shared DEV account, database or provider is used.
export const HISTORY_NOW = Date.parse('2026-11-03T12:00:00Z');
export const HISTORY_PLAYER = '11000000-0000-4000-8000-000000000001';
export const HISTORY_OTHER_PLAYER = '11000000-0000-4000-8000-000000000002';
export const HISTORY_CLUB = '31000000-0000-4000-8000-000000000001';

const row = (n, changes = {}) => ({
  source: 'sanction', id: `21000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: 'suspension', scopes: ['ranked', 'challenges'], subject_type: 'player',
  subject_id: HISTORY_PLAYER, subject_name: 'Jugador sintético A',
  reason: 'Motivo documentado de una medida sintética.',
  starts_at: '2026-11-02T12:00:00Z', ends_at: '2026-11-05T12:00:00Z',
  created_at: '2026-11-02T12:00:00Z', status: 'active', version: 1,
  issued_by_name: 'Staff sintético', incident_id: null, lobby_id: null,
  revoked_at: null, revoke_reason: null, revoked_by_name: null,
  appeal_status: 'none', appeal_reason: null, appealed_at: null,
  review_reason: null, reviewed_at: null, reviewed_by_name: null,
  minutes: null, lifted: false, ...changes,
});

export function sanctionHistoryFixture(userId = HISTORY_PLAYER) {
  const personal = item => ({ ...item, subject_id: userId });
  return {
    user: { id: userId, username: 'Jugador sintético A', gamertag: 'QA Historial',
      avatar: '🎮', role: 'player', platform: 'PC', created_at: '2026-10-01T12:00:00Z', closed: false },
    clubs: [{ id: HISTORY_CLUB, name: 'Club sintético A', role: 'jugador' }],
    items: [
      personal(row(1, { reason: 'Suspensión personal vigente por una resolución sintética.' })),
      personal(row(2, { kind: 'warning', scopes: [], status: 'scheduled', starts_at: '2026-11-04T12:00:00Z',
        ends_at: '2026-11-11T12:00:00Z', created_at: '2026-11-02T10:00:00Z', reason: 'Amonestación sintética programada para el futuro.' })),
      personal(row(3, { status: 'revoked', created_at: '2026-11-02T09:00:00Z', revoked_at: '2026-11-03T09:00:00Z',
        revoke_reason: 'La revisión revocó esta medida antes de su vencimiento.', revoked_by_name: 'Revisor sintético' })),
      personal(row(4, { source: 'ranked_ban', kind: 'ranked_ban', scopes: ['ranked'], lifted: true, minutes: 1440,
        starts_at: '2026-11-01T12:00:00Z', ends_at: '2026-11-04T12:00:00Z', created_at: '2026-11-01T12:00:00Z',
        reason: 'Bloqueo sintético levantado antes del fin previsto.' })),
      personal(row(5, { kind: 'warning', scopes: [], status: 'active', starts_at: '2026-10-24T12:00:00Z',
        ends_at: '2026-11-01T12:00:00Z', created_at: '2026-10-24T12:00:00Z',
        reason: 'Amonestación cumplida con el estado almacenado todavía activo.' })),
      row(6, { subject_type: 'club', subject_id: HISTORY_CLUB, subject_name: 'Club sintético A',
        scopes: ['tournament_registration'], created_at: '2026-10-23T12:00:00Z',
        reason: 'Medida de club: no es una sanción personal del jugador.' }),
    ],
  };
}
