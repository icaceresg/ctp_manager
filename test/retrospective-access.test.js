import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccess, canManageRetrospectives, canUseRetrospectives, STAFF_KINDS } from '../shared/access.js';
import { managerNavigation, navigationSearch } from '../client/src/navigation.js';

const staff = kind => ({ id: 4, auth_mode: 'ctp', ctp_user_id: '11111111-1111-4111-8111-111111111111', ctp_role: 'staff', staff_kind: kind, is_admin: false, roles: [], sections: [] });

test('every admitted CTP staff function can participate without receiving other section grants', () => {
  for (const kind of STAFF_KINDS) {
    const user = staff(kind.id);
    assert.equal(canUseRetrospectives(user), true, kind.id);
    assert.equal(canAccess(user, 'retrospectivas'), true);
    assert.equal(canAccess(user, 'tablero'), false);
    assert.deepEqual(user.sections, []);
    assert.equal(canManageRetrospectives(user), ['operations', 'executive'].includes(kind.id));
    const items = managerNavigation(section => canAccess(user, section), false);
    assert.equal(items.filter(item => item.id === 'retrospectivas').length, 1);
    assert.equal(navigationSearch(items, 'criticas anonimo')[0]?.to, '/retrospectivas');
  }
});

test('players, disabled users and unbound or invented staff identities cannot enter', () => {
  for (const user of [null, { ...staff('caster'), active: false }, { ...staff('caster'), active: 0 },
    { ...staff('caster'), ctp_role: 'player', roles: [{ staff_kind: 'executive' }], sections: ['retrospectivas'] },
    { ...staff('caster'), ctp_user_id: null }, staff('invented'),
    { id: 8, is_admin: false, roles: [], sections: ['retrospectivas'] }]) {
    assert.equal(canUseRetrospectives(user), false);
    assert.equal(canManageRetrospectives(user), false);
    assert.equal(canAccess(user, 'retrospectivas'), false);
  }
});

test('referees participate while only reviewed coordination, direction and admin manage reviews', () => {
  assert.equal(canUseRetrospectives({ ...staff('referee'), ctp_role: 'referee' }), true);
  assert.equal(canManageRetrospectives({ ...staff('referee'), ctp_role: 'referee' }), false);
  const admin = { ...staff('executive'), ctp_role: 'admin', is_admin: true };
  assert.equal(canManageRetrospectives(admin), true);
  assert.equal(canUseRetrospectives({ ...admin, is_admin: false }), false);
  const local = { id: 9, roles: [{ staff_kind: 'communications' }], sections: [] };
  assert.equal(canUseRetrospectives(local), true);
  assert.equal(canManageRetrospectives(local), false);
  assert.equal(canManageRetrospectives({ ...local, roles: [{ staff_kind: 'operations' }] }), true);
});
