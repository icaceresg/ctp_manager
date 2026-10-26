import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedCaseContext } from '../client/src/operations/caseSelection.js';
import { rankedIncidentPath } from '../client/src/navigation.js';

const a={id:'case-a',source:'ctp',kind:'ranked',match_id:'10000000-0000-4000-8000-000000000001'};
const b={id:'case-b',source:'ctp',kind:'ranked',match_id:'10000000-0000-4000-8000-000000000002'};
test('a stale case detail cannot create a wrong-lobby link or leak notes under a new case URL',()=>{
  const detail={incident:a,notes:[{id:'note-a',text:'Context A'}],audit:[{id:'audit-a'}]};
  const next=selectedCaseContext(detail,[a,b],'case-b');
  assert.equal(next.incident,b);assert.deepEqual(next.notes,[]);assert.deepEqual(next.audit,[]);
  assert.match(rankedIncidentPath(next.incident,'/operaciones/incidencias?case=case-b'),/000000000002\?/);
  assert.equal(selectedCaseContext(detail,[],'case-b').incident,undefined);
});
test('the selected case retains its own detail and alternative resource envelope',()=>{
  const notes=[{id:'note-b'}],audit=[{id:'audit-b'}];
  assert.deepEqual(selectedCaseContext({resource:b,notes,audit},[a],'case-b'),{incident:b,notes,audit});
  assert.deepEqual(selectedCaseContext(null,[a,{...b,notes}],'case-b'),{incident:{...b,notes},notes,audit:[]});
});
