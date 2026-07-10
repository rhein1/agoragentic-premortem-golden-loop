import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLocalReceipt } from '../src/core.mjs';

const premortem = {
  summary: { score: 100, blockers: 0, warnings: 0, info: 0, risk_count: 0 },
  repo_fingerprint: 'fixture-repo',
};

function goldenLoop(networkCalls) {
  return {
    summary: { pass: 6, warn: 0, fail: 0, skip: 2 },
    boundary: {
      free_to_use: true,
      network_calls: networkCalls,
      repo_contents_uploaded: false,
      credentials_required: false,
      paid_execution: false,
      production_mutation: false,
      real_usdc_transfer: false,
    },
  };
}

test('local receipt preserves the actual Golden Loop network boundary', () => {
  const offline = buildLocalReceipt({
    root: '/fixture',
    premortem,
    goldenLoop: goldenLoop(false),
  });
  const networkEnabled = buildLocalReceipt({
    root: '/fixture',
    premortem,
    goldenLoop: goldenLoop(true),
  });

  assert.equal(offline.boundary.network_calls, false);
  assert.equal(networkEnabled.boundary.network_calls, true);
  assert.notEqual(
    offline.receipt_id,
    networkEnabled.receipt_id,
    'receipt identity must bind whether network checks ran',
  );
});
