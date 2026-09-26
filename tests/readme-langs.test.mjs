// Guards against drift between README's "Supported Languages" table and
// Parser.codeExts in index.html. The table once claimed extensions the app
// never read (and omitted ones it did); this keeps the two sets identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

test('README Supported Languages lists exactly Parser.codeExts', () => {
  const m = html.match(/codeExts:\[([^\]]*)\]/);
  assert.ok(m, 'Parser.codeExts not found in index.html');
  const code = new Set(m[1].split(',').map(s => s.replace(/'/g, '').trim().toLowerCase()));
  const section = readme.split('## Supported Languages')[1].split('\n---\n')[0];
  const doc = new Set([...section.matchAll(/`(\.[A-Za-z0-9]+)`/g)].map(x => x[1].toLowerCase()));
  assert.deepEqual([...doc].filter(e => !code.has(e)).sort(), [], 'in README but not codeExts');
  assert.deepEqual([...code].filter(e => !doc.has(e)).sort(), [], 'in codeExts but not README');
});
