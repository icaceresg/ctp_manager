import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TEAM_ROSTER_ERRORS, TEAM_ROSTER_WRITES, teamRosterPayload, teamRosterProblem, teamRosterQuery, teamRosterRead, teamRosterResponse } from '../server/team-roster-contract.js';

const team = randomUUID(), user = randomUUID(), revision = 'a'.repeat(32), reason = 'Corrección pedida por el club';
const write = extra => ({ expected_revision: revision, reason, ...extra });
const roster = extra => ({
  team: { id: team, name: 'Alpha', tag: 'ALP', logo: null, created_at: '2026-11-01T10:00:00Z' },
  members: [{ user_id: user, username: 'captain', avatar: null, role: 'lider', joined_at: '2026-11-01T10:00:00Z', email: 'leak@example.com' }],
  requests: [{ id: randomUUID(), user_id: randomUUID(), username: 'applicant', kind: 'solicitud', created_at: '2026-11-02T10:00:00Z' }],
  max_members: 6, revision, ...extra,
});

test('every club manager action has a bounded payload', () => {
  assert.deepEqual(Object.keys(TEAM_ROSTER_WRITES), ['add', 'remove', 'set_role', 'transfer', 'resolve_request', 'invite', 'dissolve']);
  assert.deepEqual(teamRosterPayload(team, write({ action: 'add', user_id: user, role: 'suplente', move: true })),
    { action: 'add', team_id: team, expected_revision: revision, reason, user_id: user, role: 'suplente', move: true });
  assert.deepEqual(teamRosterPayload(team, write({ action: 'remove', user_id: user, new_leader_id: null })),
    { action: 'remove', team_id: team, expected_revision: revision, reason, user_id: user });
  assert.equal(teamRosterPayload(team, write({ action: 'remove', user_id: user, new_leader_id: team })).new_leader_id, team);
  assert.equal(teamRosterPayload(team, write({ action: 'set_role', user_id: user, role: 'jugador' })).role, 'jugador');
  assert.equal(teamRosterPayload(team, write({ action: 'resolve_request', request_id: user, accept: false })).accept, false);
  assert.equal(teamRosterPayload(team, write({ action: 'dissolve', confirm_name: ' Alpha ' })).confirm_name, 'Alpha');
  assert.deepEqual(teamRosterRead(team), { action: 'get', team_id: team });
  assert.deepEqual(teamRosterQuery(' cap '), { action: 'candidates', query: 'cap' });
});

test('leadership is never granted by role, and foreign or malformed fields are rejected', () => {
  for (const body of [
    write({ action: 'set_role', user_id: user, role: 'lider' }), write({ action: 'add', user_id: user, role: 'lider' }),
    write({ action: 'set_role', user_id: user }), write({ action: 'add', user_id: user, points: 3 }), write({ action: 'transfer', user_id: 'nope' }),
    write({ action: 'remove', user_id: user, move: true }), write({ action: 'resolve_request', request_id: user }),
    write({ action: 'delete', user_id: user }), write({ action: 'constructor', user_id: user }), write({ action: 'dissolve', confirm_name: '   ' }),
    { action: 'add', user_id: user, reason }, write({ action: 'add', user_id: user, reason: 'short' }),
  ]) assert.throws(() => teamRosterPayload(team, body), error => error.message.startsWith('manager.teamRoster.error.'));
  assert.throws(() => teamRosterPayload('nope', write({ action: 'transfer', user_id: user })));
  assert.throws(() => teamRosterQuery('ab'));
});

test('responses expose only public roster data', () => {
  const read = teamRosterResponse(roster(), { action: 'get', team_id: team });
  assert.equal(read.members[0].username, 'captain');
  assert.equal(read.members[0].email, undefined);
  assert.equal(read.requests.length, 1);
  const changed = teamRosterResponse(roster({ action: 'transfer', applied: true }), { action: 'transfer', team_id: team });
  assert.equal(changed.applied, true);
  assert.deepEqual(teamRosterResponse({ applied: true, action: 'dissolve', dissolved: true, team_id: team }, { action: 'dissolve', team_id: team }), { dissolved: true, team_id: team });
  const candidates = teamRosterResponse({ items: [{ id: user, username: 'free', avatar: null, team_id: null }, { id: randomUUID(), username: 'busy', team_id: team, team_name: 'Alpha', team_role: 'jugador' }] }, { action: 'candidates' });
  assert.deepEqual(candidates.items.map(item => item.team_name), [null, 'Alpha']);
  for (const value of [roster({ revision: 'x' }), roster({ team: { id: randomUUID(), name: 'A', tag: 'A' } }), roster({ members: [{ user_id: user, username: 'x', role: 'admin', joined_at: '2026-11-01' }] })])
    assert.throws(() => teamRosterResponse(value, { action: 'get', team_id: team }));
  assert.throws(() => teamRosterResponse(roster(), { action: 'add', team_id: team }), /unavailable/);
});

test('only known CTP machine codes become messages, all translated in six languages', () => {
  assert.equal(teamRosterProblem('team_roster_full'), 'manager.teamRoster.error.full');
  assert.equal(teamRosterProblem('team_roster_unknown'), null);
  assert.equal(teamRosterProblem('constructor'), null);
  const source = ['server/team-roster-contract.js', 'server/integration.js', 'client/src/operations/TeamRosterDialog.jsx', 'client/src/pages/AdministrationPage.jsx']
    .map(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  const keys = new Set([...source.matchAll(/'(manager\.teamRoster\.[A-Za-z.]+[A-Za-z])'/g)].map(match => match[1]));
  for (const value of Object.values(TEAM_ROSTER_ERRORS)) keys.add(`manager.teamRoster.error.${value}`);
  for (const role of ['lider', 'jugador', 'suplente']) keys.add(`manager.teamRoster.role.${role}`);
  assert.ok(keys.size > 60);
  for (const lang of ['es', 'en', 'it', 'fr', 'pt', 'de']) {
    const catalogue = JSON.parse(fs.readFileSync(new URL(`../client/src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of keys) assert.equal(typeof catalogue[key], 'string', `${lang}: ${key}`);
  }
});

test('roster routes are admin-only and writes respect CTP_ENABLE_WRITES', () => {
  const routes = fs.readFileSync(new URL('../server/routes/administration.js', import.meta.url), 'utf8');
  assert.match(routes, /administrationRouter\.use\('\/administration',requireAuth,requireAdmin\)/);
  assert.match(routes, /get\('\/administration\/clubs\/:id\/roster'/);
  assert.match(routes, /post\('\/administration\/clubs\/:id\/roster'/);
  const integration = fs.readFileSync(new URL('../server/integration.js', import.meta.url), 'utf8');
  assert.match(integration, /teamRosterService[\s\S]*ctp_role !== 'admin'[\s\S]*!config\.writes[\s\S]*service: 'team_roster'/);
});
