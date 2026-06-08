// Enforces that the top-level `calcBlast` function embedded in index.html
// produces identical output to the source-of-truth implementation in
// tests/blast.mjs. Mirrors the approach in sync-with-html.test.mjs: extract the
// real function body from index.html, run it in a VM, and assert deep-equality
// of its output against the reference module across a battery of synthetic
// codebases. This keeps the unit tests in blast.test.mjs honest about the real
// shipped logic — if someone edits calcBlast in index.html without updating the
// reference (or vice-versa), this test fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { calcBlast as refBlast } from './blast.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Pull a top-level `function NAME(...) { ... }` declaration out of index.html by
// brace-matching, the same walk sync-with-html.test.mjs uses for object methods.
function sliceFunction(source, name) {
  const needle = `function ${name}(`;
  const start = source.indexOf(needle);
  if (start < 0) throw new Error(`couldn't find function ${name} in index.html`);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  let i = openBrace;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const calcBlastSrc = sliceFunction(html, 'calcBlast');

// Expose the extracted function so we can invoke it directly.
const script = new vm.Script(`${calcBlastSrc}; calcBlast;`);
const htmlCalcBlast = script.runInNewContext({});

// Deep clone through JSON so Sets/Maps in the return are compared by value-shape.
// calcBlast already returns plain arrays/numbers/strings, so this is safe.
const J = (v) => JSON.parse(JSON.stringify(v));

// A few synthetic codebases exercising different graph shapes.
function chain() {
  // A -> B -> C -> D  (each imports from the next)
  return {
    files: ['a.js', 'b.js', 'c.js', 'd.js'].map((p) => ({ path: p, functions: [] })),
    conns: [
      { source: 'b.js', target: 'a.js', fn: 'fnB', count: 2 },
      { source: 'c.js', target: 'b.js', fn: 'fnC', count: 1 },
      { source: 'd.js', target: 'c.js', fn: 'fnD', count: 3 },
    ],
  };
}
function hub() {
  // util.js is imported by 8 files (critical level)
  const dependents = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => n + '.js');
  return {
    files: dependents.concat(['util.js']).map((p) => ({ path: p, functions: [] })),
    conns: dependents.map((d, i) => ({ source: 'util.js', target: d, fn: 'u' + i, count: 1 })),
  };
}
function cycle() {
  // A <-> B mutual import
  return {
    files: ['a.js', 'b.js'].map((p) => ({ path: p, functions: [] })),
    conns: [
      { source: 'a.js', target: 'b.js', fn: 'fnA', count: 1 },
      { source: 'b.js', target: 'a.js', fn: 'fnB', count: 1 },
    ],
  };
}
function objectEdges() {
  // edges given as {source:{id},target:{id}} (post-d3 force layout mutates these)
  return {
    files: ['a.js', 'b.js'].map((p) => ({ path: p, functions: [] })),
    conns: [
      { source: { id: 'b.js' }, target: { id: 'a.js' }, fn: 'fnB', count: 4 },
    ],
  };
}

const fixtures = { chain, hub, cycle, objectEdges };

test('index.html calcBlast matches tests/blast.mjs across graph shapes', () => {
  for (const [name, make] of Object.entries(fixtures)) {
    const { files, conns } = make();
    for (const f of files) {
      const got = J(htmlCalcBlast(f.path, conns, files));
      const want = J(refBlast(f.path, conns, files));
      assert.deepStrictEqual(got, want, `mismatch on fixture "${name}" for file ${f.path}`);
    }
  }
});
