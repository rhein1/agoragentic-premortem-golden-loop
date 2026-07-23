import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');

test('release tag reaches the shell through a quoted environment variable', () => {
  assert.match(workflow, /RELEASE_TAG: \$\{\{ github\.event\.release\.tag_name \}\}/);
  assert.match(workflow, /test "\$\{RELEASE_TAG\}" = "v\$\{package_version\}"/);
  assert.doesNotMatch(workflow, /test "\$\{\{ github\.event\.release\.tag_name \}\}"/);
});
