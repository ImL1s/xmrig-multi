/**
 * Ensures web-miner-ci path filters cannot silently drop shared modules (#133).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const MUST_TRIGGER = [
  'shared/a11y',
  'shared/artifact-smoke',
  'shared/onboarding',
  'shared/staged-apply',
  'shared/i18n',
  'shared/companion-sync',
  'shared/glance-presentation'
];

test('quality-gate workflow exists and is not path-filtered', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/quality-gate.yml'), 'utf8');
  assert.match(yml, /name:\s*Quality Gate/);
  assert.doesNotMatch(
    yml,
    /pull_request:[\s\S]*paths:/,
    'Quality Gate must not use paths: filters on pull_request'
  );
  assert.match(yml, /find shared/);
  assert.match(yml, /node --test/);
});

test('web-miner-ci covers shared/** or each previously missed module', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/web-miner-ci.yml'), 'utf8');
  if (yml.includes("shared/**")) {
    assert.ok(true, 'broad shared/** trigger present');
    return;
  }
  for (const mod of MUST_TRIGGER) {
    assert.ok(
      yml.includes(mod),
      `web-miner-ci paths must include ${mod} when not using shared/**`
    );
  }
});

test('previously missed shared modules still have tests on disk', () => {
  for (const mod of MUST_TRIGGER) {
    const dir = join(ROOT, mod, 'test');
    assert.ok(existsSync(dir), `${mod}/test missing`);
    const files = readdirSync(dir).filter((f) => f.endsWith('.test.js'));
    assert.ok(files.length > 0, `${mod}/test has no *.test.js`);
  }
});
