import test from 'node:test';
import assert from 'node:assert/strict';
import { playoffTree } from '../client/src/operations/playoffTree.js';

function match(round, position) { return { round, position, id: `${round}-${position}` }; }

test('octavos feed all four cuartos and the same geometry joins semis and final', () => {
  const all = [8,4,2,1].flatMap((size, round) => Array.from({ length: size }, (_, i) => match(round + 1, i + 1)));
  const tree = playoffTree(all.reverse());
  assert.equal(tree.rows, 8);
  assert.deepEqual(tree.columns.map(r => r.joins.length), [4,2,1,0]);
  assert.deepEqual(tree.columns[0].joins.find(j => j.id === '2-1'), {
    id: '2-1', starts: [1.5,0.5], end: 1, top: 0.5, height: 1,
  });
  assert.equal(tree.columns[3].nodes[0].center, 4);
});

test('a missing fixture keeps its slot and a missing round never draws a guessed connector', () => {
  const tree = playoffTree([match(1,3),match(2,2),match(4,1),match(1,0)]);
  assert.deepEqual(tree.columns.map(r => [r.round, r.nodes.map(n => n.center)]), [[1,[2.5]],[2,[3]],[4,[4]]]);
  assert.deepEqual(tree.columns[0].joins, [{ id: '2-2', starts: [2.5], end: 3, top: 2.5, height: 0.5 }]);
  assert.deepEqual(tree.columns[1].joins, []);
});
