import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileIsolatedStagingOwnership} from '../backend/isolated-staging-ownership-reconciliation.mjs';

const acceptedRecord = JSON.parse(readFileSync(
  new URL('../deploy/isolated-staging/verified-deployment.json', import.meta.url), 'utf8'
));
const accountId = acceptedRecord.accountId;
const pilotId = '11111111-1111-4111-8111-111111111111';

function validInput(patch = {}) {
  return {
    acceptedRecord,
    accountId,
    pilotId,
    inventory: {
      complete: true,
      pilotPreserved: true,
      writePermissionsExercised: false,
      providerRequestsPerformed: false,
      databases: [
        {name: 'uvenaro-account-staging', uuid: pilotId},
        ...acceptedRecord.databases
      ],
      workers: acceptedRecord.workers.map(worker => ({name: worker.name}))
    },
    remoteChangesPerformed: false,
    providerRequestsPerformed: false,
    workersFreePlanVerified: false,
    ...patch
  };
}

test('exact account inventory proves ownership without authorizing provisioning', () => {
  const result = reconcileIsolatedStagingOwnership(validInput());
  assert.equal(result.status, 'OWNERSHIP_RECONCILIATION_PASS');
  assert.equal(result.ownershipVerified, true);
  assert.equal(result.provisioningAllowed, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.safeOff, true);
  assert.deepEqual(result.blockers, ['WORKERS_FREE_PLAN_UNVERIFIED']);
});

test('database identity drift fails closed', () => {
  const input = validInput();
  input.inventory.databases[1] = {
    ...input.inventory.databases[1],
    uuid: '22222222-2222-4222-8222-222222222222'
  };
  const result = reconcileIsolatedStagingOwnership(input);
  assert.equal(result.status, 'OWNERSHIP_RECONCILIATION_BLOCKED');
  assert.equal(result.ownershipVerified, false);
});

test('missing pilot or worker cannot be treated as owned', () => {
  const missingPilot = validInput();
  missingPilot.inventory.databases.shift();
  assert.equal(reconcileIsolatedStagingOwnership(missingPilot).ownershipVerified, false);

  const missingWorker = validInput();
  missingWorker.inventory.workers.pop();
  assert.equal(reconcileIsolatedStagingOwnership(missingWorker).ownershipVerified, false);
});

test('writes, provider calls and unsafe deployment evidence always block', () => {
  for (const patch of [
    {remoteChangesPerformed: true},
    {providerRequestsPerformed: true},
    {inventory: {...validInput().inventory, writePermissionsExercised: true}},
    {inventory: {...validInput().inventory, providerRequestsPerformed: true}},
    {acceptedRecord: {...acceptedRecord, providerCallsPermitted: true}}
  ]) {
    const result = reconcileIsolatedStagingOwnership(validInput(patch));
    assert.equal(result.ownershipVerified, false);
    assert.equal(result.provisioningAllowed, false);
  }
});
