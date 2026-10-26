import test from 'node:test';
import assert from 'node:assert/strict';
import { OP_TABS } from '../client/src/operations/model.js';
import { managerNavigation, matchReturnPath, navigationSearch } from '../client/src/navigation.js';
import { metricsAllowedHost } from '../client/src/pages/metricsModel.js';

test('all permitted operational areas are discoverable without granting another role', () => {
  for (const section of ['arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones', 'operaciones']) {
    const items = managerNavigation(value => value === section, false);
    assert.deepEqual(items.map(item => item.id), OP_TABS.filter(tab => tab.sections.includes(section)).map(tab => tab.id));
    assert.equal(items.some(item => ['usuarios', 'integracion'].includes(item.id)), false);
    assert(items.every(item => item.group && item.to.startsWith('/')));
  }
});
test('editorial staff and a staff account without operations keep their own tools', () => {
  assert.deepEqual(managerNavigation(value => ['calendario', 'disponibilidad'].includes(value), false).map(item => item.id), ['disponibilidad', 'calendario']);
  assert.deepEqual(managerNavigation(() => false, false), []);
});
test('admin tools occur once and navigation targets remain unique', () => {
  const items = managerNavigation(() => true, true);
  assert.equal(new Set(items.map(item => item.to)).size, items.length);
  assert.equal(items.filter(item => item.id === 'integracion').length, 1);
});

test('private metrics are discoverable once for administrators on PRE and PROD only', () => {
  for (const hostname of ['pre.manager.playctp.com', 'manager.playctp.com', 'localhost', '127.0.0.1', '[::1]', '::1']) {
    assert.equal(metricsAllowedHost(hostname), true);
    assert.equal(managerNavigation(() => true, true, false, false, hostname).filter(item => item.id === 'metrics').length, 1);
    for (const managesUsers of [false, true]) {
      assert.equal(managerNavigation(() => true, false, managesUsers, true, hostname).some(item => item.id === 'metrics'), false);
    }
  }
  for (const hostname of ['evil.manager.playctp.com', 'manager.playctp.com.evil.invalid', 'ruleta.playctp.com', 'pre.playctp.com']) {
    assert.equal(metricsAllowedHost(hostname), false);
    assert.equal(managerNavigation(() => true, true, false, false, hostname).some(item => item.id === 'metrics'), false);
  }
});

test('Ranked supervision adds only the monitor without granting admin tools', () => {
  const items = managerNavigation(() => false, false, false, true);
  assert.deepEqual(items.map(item => item.id), ['ranked-monitor']);
  assert.equal(items[0].to, '/ranked/monitor');
});

test('coordination receives only delegated user management in addition to its own tools', () => {
  const normal = managerNavigation(value => ['operaciones', 'tablero', 'disponibilidad'].includes(value), false);
  const delegated = managerNavigation(value => ['operaciones', 'tablero', 'disponibilidad'].includes(value), false, true);
  assert.deepEqual(delegated.filter(item => !normal.some(existing => existing.id === item.id)).map(item => item.id), ['usuarios']);
  assert.equal(delegated.find(item => item.id === 'usuarios').to, '/usuarios');
  assert.equal(delegated.some(item => ['administracion', 'crm', 'integracion'].includes(item.id)), false);
  assert.equal(new Set(managerNavigation(() => true, true, true).map(item => item.to)).size, managerNavigation(() => true, true, true).length);
});
test('tool search matches accents and multiple words only within allowed tools', () => {
  const items = managerNavigation(value => value === 'arbitraje', false);
  assert.deepEqual(navigationSearch(items, 'ESTADISTICAS').map(item => item.id), ['estadisticas']);
  assert.deepEqual(navigationSearch(items, 'competicion arbitraje').map(item => item.id), ['incidencias','arbitraje']);
  assert.deepEqual(navigationSearch(items, 'usuarios'), []);
});
test('match return links preserve filters but reject external or unknown targets', () => {
  assert.equal(matchReturnPath('/operaciones/incidencias?case=one&bucket=mine'), '/operaciones/incidencias?case=one&bucket=mine');
  for (const value of [null, '//evil.example', 'https://evil.example', '/operaciones/partidos/one', '/operaciones/jornada\\evil', '/operaciones/jornada-extra']) assert.equal(matchReturnPath(value), '/operaciones/jornada');
});
test('the draw wheel links to its own host in deployments and to /ruleta locally', async () => {
  const { ruletaNavigation } = await import('../client/src/navigation.js');
  assert.equal(ruletaNavigation('localhost').href, '/ruleta');
  assert.equal(ruletaNavigation('manager.playctp.com').href, 'https://ruleta.playctp.com');
});
