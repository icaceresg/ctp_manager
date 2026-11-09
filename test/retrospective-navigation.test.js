import test from 'node:test';
import assert from 'node:assert/strict';
import { managerNavigation, managerNavigationPathMatches, navigationSearch, splitManagerNavigation } from '../client/src/navigation.js';
import { canAccess } from '../shared/access.js';

test('retrospective direct links keep the tool title, discovery entry and its containing navigation group open', () => {
  const staff = { id: 17, auth_mode: 'local', is_admin: false, roles: [{ staff_kind: 'production' }], sections: ['realizacion'] };
  const items = managerNavigation(section => canAccess(staff, section), false);
  const path = '/retrospectivas/11111111-1111-4111-8111-111111111111';
  const current = items.find(item => managerNavigationPathMatches(item, path));
  assert.equal(current?.title, 'Retrospectivas');
  assert.equal(current?.to, '/retrospectivas');
  assert.equal(navigationSearch(items, 'anonimo').some(item => item.id === current.id), true);
  const containingGroup = splitManagerNavigation(items).groups.find(group => group.items.some(item => managerNavigationPathMatches(item, path)));
  assert.equal(containingGroup?.title, 'Equipo CTP');
  assert.equal(managerNavigationPathMatches(current, '/retrospectivas'), true);
  assert.equal(managerNavigationPathMatches(current, '/retrospectivas/otro-detalle'), true);
  assert.equal(managerNavigationPathMatches(current, '/retrospectivas-administracion'), false);
});

test('nested route discovery does not grant access or change matching for unrelated tools and external links', () => {
  const noStaff = { id: 18, auth_mode: 'local', is_admin: false, roles: [], sections: [] };
  const items = managerNavigation(section => canAccess(noStaff, section), false);
  assert.equal(items.some(item => managerNavigationPathMatches(item, '/retrospectivas/secret')), false);
  assert.equal(managerNavigationPathMatches({ to: '/jugadores' }, '/jugadores/some-player'), false);
  assert.equal(managerNavigationPathMatches({ href: 'https://ruleta.example.test' }, '/retrospectivas'), false);
  assert.equal(managerNavigationPathMatches(null, '/retrospectivas'), false);
});
