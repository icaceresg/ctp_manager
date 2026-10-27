import test from 'node:test';
import assert from 'node:assert/strict';
import { OP_TABS } from '../client/src/operations/model.js';
import { managerNavigation, matchReturnPath, navigationSearch, managerUserId, operationReturnPath, userProfileEditPath, rankedIncidentPath, playerWorkspacePath, splitManagerNavigation } from '../client/src/navigation.js';
import { metricsAllowedHost } from '../client/src/pages/metricsModel.js';

test('all permitted operational areas are discoverable without granting another role', () => {
  for (const section of ['arbitraje', 'casters', 'realizacion', 'clubes', 'comunicaciones', 'operaciones']) {
    const items = managerNavigation(value => value === section, false);
    assert.deepEqual(items.map(item => item.id), OP_TABS.filter(tab => tab.menu !== false && tab.sections.includes(section)).map(tab => tab.id));
    assert.equal(items.some(item => ['usuarios', 'integracion'].includes(item.id)), false);
    assert(items.every(item => item.group && item.to.startsWith('/')));
  }
});

test('the PRE candidate keeps PC checks outside all navigation and return targets',()=>{
  for(const [can,isAdmin] of [[()=>true,true],[section=>section==='arbitraje',false],[section=>section==='casters',false]]){
    assert.equal(managerNavigation(can,isAdmin,true,true).some(item=>item.to.startsWith('/pc-check')),false);
  }
  assert.equal(OP_TABS.some(tab=>tab.id==='pc-checks'),false,'PC checks cannot call the operational workspace with an unknown view');
  assert.equal(operationReturnPath('/pc-checks?user_id=fixture'),'/operaciones/incidencias');
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

test('hidden specialist pages retain their routes without returning to navigation or search', () => {
  for (const id of ['clubes', 'estadisticas']) {
    assert.equal(OP_TABS.find(tab => tab.id === id)?.menu, false);
    assert.equal(matchReturnPath(`/operaciones/${id}`), `/operaciones/${id}`);
    for (const [isAdmin, staffManager, rankedStaff] of [[true, true, true], [false, false, true], [false, false, false]]) {
      const items = managerNavigation(() => true, isAdmin, staffManager, rankedStaff, 'manager.playctp.com');
      assert.equal(items.some(item => item.id === id), false);
      assert.equal(navigationSearch(items, id).some(item => item.id === id), false);
      assert.equal(new Set(items.map(item => item.id)).size, items.length);
      assert.equal(new Set(items.map(item => item.to)).size, items.length);
    }
  }
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

test('Ranked supervision adds Ranked and player workspaces without granting admin tools', () => {
  const items = managerNavigation(() => false, false, false, true);
  assert.deepEqual(items.map(item => item.id), ['ranked-monitor','jugadores']);
  assert.equal(items[0].to, '/ranked/monitor');
  assert.equal(items[1].to, '/jugadores');
  assert.equal(items.some(item => ['administracion','usuarios','crm','integracion','metrics'].includes(item.id)),false);
});

test('Inicio and Jugadores stay on top and every other allowed tool sits once in its area group',()=>{
  const all=managerNavigation(()=>true,true,true,true,'localhost');
  const split=splitManagerNavigation(all);
  assert.deepEqual(split.primary.map(item=>item.id),['jornada','jugadores']);
  assert.equal(split.primary[0].title,'Inicio');
  const competition=split.groups.find(group=>group.title==='Competición');
  assert.deepEqual(competition.items.map(item=>item.id),['ranked-monitor','incidencias','torneos','arbitraje','sanciones','historico']);
  assert.deepEqual(competition.items.slice(0,2).map(item=>item.title),['Ranked','Tickets']);
  assert.equal(competition.daily,true,'Competición starts open because it holds Ranked and Tickets');
  assert.deepEqual(split.groups.filter(group=>group.daily).map(group=>group.title),['Competición']);
  const grouped=split.groups.flatMap(group=>group.items);
  assert.deepEqual(grouped,split.secondary);
  assert.deepEqual(new Set([...split.primary,...grouped].map(item=>item.id)),new Set(all.map(item=>item.id)));
  assert.equal(split.primary.length+grouped.length,all.length);
  const caster=managerNavigation(section=>section==='casters',false,false,false);
  assert.deepEqual(splitManagerNavigation(caster).primary.map(item=>item.id),['jornada']);
  assert.equal(splitManagerNavigation(caster).secondary.some(item=>['incidencias','jugadores','ranked-monitor'].includes(item.id)),false);
  assert.deepEqual(splitManagerNavigation(managerNavigation(()=>false,false)),{primary:[],secondary:[],groups:[]});
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
  assert.deepEqual(navigationSearch(items, 'HISTORICO').map(item => item.id), ['historico']);
  assert.deepEqual(navigationSearch(items, 'estadisticas'), [], 'Estadísticas ya no está en el menú');
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

const accountId = '11111111-1111-4111-8111-111111111111';
test('account shortcuts keep the exact author identity and allow a safe return to the ticket', () => {
  const returnTo = '/operaciones/incidencias?case=22222222-2222-4222-8222-222222222222&bucket=mine';
  const target = new URL(userProfileEditPath(accountId, returnTo), 'https://manager.example');
  assert.equal(target.pathname, '/administracion/usuarios');
  assert.equal(target.searchParams.get('edit'), accountId);
  assert.equal(target.searchParams.get('returnTo'), returnTo);
  assert.equal(new URL(userProfileEditPath(accountId, '/ranked/monitor'), target).searchParams.get('returnTo'), '/ranked/monitor');
  for (const value of [null, 1, [accountId], 'player name', `${accountId}/other`, 'javascript:alert(1)', '']) {
    assert.equal(managerUserId(value), null);
    assert.equal(userProfileEditPath(value, returnTo), null);
  }
});

test('player workspace shortcuts carry exact identity and return to the filtered queue, case or player',()=>{
  for(const returnTo of ['/ranked/monitor?tab=live&queue=ranked&status=ready&mode=hp','/operaciones/incidencias?bucket=mine&case=owned',`/jugadores/${accountId}?tab=tickets`]){
    const target=new URL(playerWorkspacePath(accountId,returnTo),'https://manager.example');
    assert.equal(target.pathname,`/jugadores/${accountId}`);
    assert.equal(target.searchParams.get('returnTo'),returnTo);
    assert.equal(target.searchParams.has('edit'),false);
  }
  for(const id of [null,'unregistered name',`${accountId}/other`])assert.equal(playerWorkspacePath(id,'/ranked/monitor'),null);
  assert.equal(new URL(playerWorkspacePath(accountId,'https://evil.example'),'https://manager.example').searchParams.get('returnTo'),'/jugadores');
});
test('shortcuts cannot redirect to an external site or another Manager action', () => {
  for (const returnTo of ['//evil.example', 'https://evil.example', '/administracion/usuarios?edit=other', '/ranked/monitoring', '/ranked/partidas/invalid', '/ranked/monitor\\evil', '/ranked/monitor\n', '/operaciones/incidencias/../integracion']) {
    assert.equal(operationReturnPath(returnTo), '/operaciones/incidencias');
    assert.equal(new URL(userProfileEditPath(accountId, returnTo), 'https://manager.example').searchParams.get('returnTo'), '/operaciones/incidencias');
  }
  assert.equal(operationReturnPath(`/ranked/partidas/${accountId}?before=50#ranked-decision`), `/ranked/partidas/${accountId}?before=50#ranked-decision`);
});
test('only a linked official Ranked case can open arbitration for its own lobby', () => {
  const incident = { source: 'ctp', kind: 'ranked', match_id: accountId, reason: 'Otro usuario pide ganar: https://evil.example' };
  const to = new URL(rankedIncidentPath(incident, '/operaciones/incidencias?case=dispute'), 'https://manager.example');
  assert.equal(to.pathname, `/ranked/partidas/${accountId}`);
  assert.equal(to.searchParams.get('focus'), 'decision');
  assert.equal(to.searchParams.get('returnTo'), '/operaciones/incidencias?case=dispute');
  assert.equal(to.searchParams.has('side'), false);
  assert.equal(to.searchParams.has('decision'), false);
  for (const input of [null, { ...incident, source: 'manager' }, { ...incident, kind: 'support' }, { ...incident, match_id: 'bad' }]) assert.equal(rankedIncidentPath(input, '/operaciones/incidencias'), null);
});
