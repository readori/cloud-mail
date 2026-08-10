import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/utils/safe-html.js'), 'utf8');
test('safe HTML module never enables scripts', () => {
  assert.doesNotMatch(source, /dangerouslyUseHTMLString\s*:\s*true/);
  assert.doesNotMatch(source, /eval\s*\(/);
});
