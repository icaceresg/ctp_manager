import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedMaps, canSendCommand, displayNumber, officialResult, playerInsights, safeWebUrl, matchName } from '../client/src/operations/model.js';

test('caster ratios exclude pending maps, deduplicate revisions and state incomplete sample', () => {
  const approved = { id:'map-1',status:'approved',mode:'Hardpoint',players:[{id:'p1',username:'Player',kills:20,deaths:10}] };
  const partial = { id:'map-2',status:'approved',mode:'Control',players:[{id:'p1',kills:50,deaths:null}] };
  const pending = { id:'map-3',status:'pending',mode:'Hardpoint',players:[{id:'p1',kills:900,deaths:1}] };
  const matches = [{ id:'match',statistics:[approved,partial,pending] },{ id:'match',statistics:[approved] }];
  const [player] = playerInsights(matches,['p1']);
  assert.equal(player.maps,2);
  assert.equal(player.complete_maps,1);
  assert.equal(player.kd,2);
  assert.equal(player.kills,20);
  assert.deepEqual(player.modes,[{name:'Hardpoint',maps:1},{name:'Control',maps:1}]);
  assert.equal(approvedMaps([approved,pending]).length,1);
});
test('unknown values and a zero denominator never become fake zero statistics', () => {
  assert.equal(displayNumber(null),'—');
  assert.equal(displayNumber('12'),'—');
  assert.equal(displayNumber(0),0);
  const [player] = playerInsights([{id:'match',statistics:[{id:'map',status:'approved',players:[{id:'p',kills:12,deaths:0}]}]}],['p']);
  assert.equal(player.kd,null);
  assert.equal(player.complete_maps,1);
});
test('CTP links cannot redirect to another origin or execute script', () => {
  assert.equal(safeWebUrl('https://playctp.com','/app/retos/abc'),'https://playctp.com/app/retos/abc');
  for(const path of ['//evil.example','/\\evil.example','javascript:alert(1)','https://evil.example']) assert.equal(safeWebUrl('https://playctp.com',path),null);
  assert.equal(safeWebUrl('javascript:alert(1)','/app'),null);
});
test('winner-only matches do not invent a numeric score', () => {
  const match={confirmed:true,team_a:{id:'a',name:'A'},team_b:{id:'b',name:'B'},winner_id:'b',score_a:null,score_b:null};
  assert.equal(officialResult(match),'Gana B');
  assert.equal(officialResult({...match,confirmed:false}),'Pendiente de confirmación');
  assert.equal(officialResult({...match,score_a:0,score_b:3}),'0 – 3');
  assert.equal(matchName({...match,title:'Cup'}),'A · B');
});

test('a lost ACK remains recoverable after the source leaves the pending feed', () => {
  const command = { type:'stats.review',status:'failed',attempts:1,source_available:false,source_version_current:null,expected_version:1 };
  assert.equal(canSendCommand(command,true,true),true);
  assert.equal(canSendCommand({...command,attempts:0},true,true),false);
  assert.equal(canSendCommand({...command,status:'acknowledged'},true,true),false);
  assert.equal(canSendCommand(command,false,true),false);
  assert.equal(canSendCommand(command,true,false),false);
  assert.equal(canSendCommand({...command,source_available:true,source_version_current:2,attempts:0},true,true),false);
});
