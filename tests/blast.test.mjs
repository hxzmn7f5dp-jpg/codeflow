// Unit tests for the blast-radius / impact-analysis core logic (calcBlast) and
// circular-dependency detection (detectCircular), exercised on small synthetic
// codebases. The sync-blast-with-html.test.mjs test guarantees calcBlast here
// stays equivalent to the copy shipped inside index.html.
//
// Edge convention (from index.html): {source, target} means `target` imports
// from `source`. So the dependents (blast radius) of a file are the edges where
// it is the `source`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBlast, detectCircular } from './blast.mjs';

// --- Synthetic codebase: A -> B -> C (A imports B, B imports C) -------------
// Encoded as edges (source = the imported/depended-on file):
//   C is imported by B  => {source:'C', target:'B'}
//   B is imported by A  => {source:'B', target:'A'}
const files = ['A.js', 'B.js', 'C.js'].map((p) => ({ path: p, functions: [] }));
const conns = [
  { source: 'C.js', target: 'B.js', fn: 'fromC', count: 2 },
  { source: 'B.js', target: 'A.js', fn: 'fromB', count: 1 },
];

test('calcBlast: direct dependents of B are exactly A', () => {
  const b = calcBlast('B.js', conns, files);
  assert.deepStrictEqual(b.affected.sort(), ['A.js']);
  assert.equal(b.count, 1);
});

test('calcBlast: changing C has blast radius reaching A and B (transitive)', () => {
  const c = calcBlast('C.js', conns, files);
  // Direct dependent of C is B.
  assert.deepStrictEqual(c.affected.sort(), ['B.js']);
  assert.equal(c.count, 1);
  // Transitively, A also depends on C (A -> B -> C).
  const reachable = new Set([...c.affected, ...c.transitive]);
  assert.ok(reachable.has('B.js'), 'B should be in C blast radius');
  assert.ok(reachable.has('A.js'), 'A should be transitively in C blast radius');
  assert.equal(c.transitiveCount, 2, 'B (depth1) and A (depth2) are transitive');
  assert.equal(c.depth, 2, 'deepest transitive dependent is at depth 2');
});

test('calcBlast: a leaf consumer (A) has no dependents', () => {
  const a = calcBlast('A.js', conns, files);
  assert.deepStrictEqual(a.affected, []);
  assert.equal(a.count, 0);
  assert.equal(a.transitiveCount, 0);
  // A imports from B, so B is in A's dependencies (its own risk surface).
  assert.deepStrictEqual(a.dependencies.sort(), ['B.js']);
  assert.equal(a.level, 'low');
});

test('calcBlast: fnsUsed and totalCalls reflect how a file is consumed', () => {
  const c = calcBlast('C.js', conns, files);
  assert.equal(c.fnsUsed, 1, 'C exposes one consumed function (fromC)');
  assert.equal(c.totalCalls, 2, 'fromC is called 2 times');
});

test('calcBlast: severity level escalates with number of direct dependents', () => {
  // hub.js imported by 8 files => critical
  const dependents = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => n + '.js');
  const hubFiles = dependents.concat(['hub.js']).map((p) => ({ path: p, functions: [] }));
  const hubConns = dependents.map((d, i) => ({ source: 'hub.js', target: d, fn: 'h' + i, count: 1 }));
  const hub = calcBlast('hub.js', hubConns, hubFiles);
  assert.equal(hub.count, 8);
  assert.equal(hub.level, 'critical');

  // Trim to 2 dependents => medium.
  const twoConns = hubConns.slice(0, 2);
  const med = calcBlast('hub.js', twoConns, hubFiles);
  assert.equal(med.count, 2);
  assert.equal(med.level, 'medium');
});

test('calcBlast: object-shaped edge endpoints are unwrapped via .id', () => {
  const f = ['x.js', 'y.js'].map((p) => ({ path: p, functions: [] }));
  const c = [{ source: { id: 'x.js' }, target: { id: 'y.js' }, fn: 'fn', count: 1 }];
  const x = calcBlast('x.js', c, f);
  assert.deepStrictEqual(x.affected, ['y.js']);
  assert.equal(x.count, 1);
});

test('calcBlast: empty connection set yields an all-zero report', () => {
  const r = calcBlast('A.js', [], files);
  assert.deepStrictEqual(r.affected, []);
  assert.equal(r.count, 0);
  assert.equal(r.transitiveCount, 0);
  assert.equal(r.fnsUsed, 0);
  assert.equal(r.impactScore, 0);
  assert.equal(r.centrality, 0);
  assert.equal(r.level, 'low');
});

// --- Circular dependency detection -----------------------------------------

test('detectCircular: finds a mutual A <-> B cycle as one canonical pair', () => {
  const cyc = [
    { source: 'A.js', target: 'B.js', fn: 'a', count: 1 },
    { source: 'B.js', target: 'A.js', fn: 'b', count: 1 },
  ];
  const found = detectCircular(cyc);
  assert.deepStrictEqual(found, ['A.js|B.js']);
});

test('detectCircular: an acyclic A -> B -> C chain has no cycles', () => {
  assert.deepStrictEqual(detectCircular(conns), []);
});

test('detectCircular: reports each distinct cycle once, no duplicates', () => {
  const many = [
    { source: 'A.js', target: 'B.js', fn: 'a', count: 1 },
    { source: 'B.js', target: 'A.js', fn: 'b', count: 1 },
    { source: 'C.js', target: 'D.js', fn: 'c', count: 1 },
    { source: 'D.js', target: 'C.js', fn: 'd', count: 1 },
  ];
  const found = detectCircular(many).sort();
  assert.deepStrictEqual(found, ['A.js|B.js', 'C.js|D.js']);
});

test('detectCircular: unwraps object-shaped edge endpoints', () => {
  const cyc = [
    { source: { id: 'A.js' }, target: { id: 'B.js' }, fn: 'a', count: 1 },
    { source: { id: 'B.js' }, target: { id: 'A.js' }, fn: 'b', count: 1 },
  ];
  assert.deepStrictEqual(detectCircular(cyc), ['A.js|B.js']);
});
