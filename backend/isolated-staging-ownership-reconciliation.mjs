const freeze = Object.freeze;

export const ISOLATED_STAGING_OWNERSHIP_RECONCILIATION_PROTOCOL =
  'uvenaro-isolated-staging-ownership-reconciliation-v1';

const TARGET_DATABASES = freeze([
  {name: 'uvenaro-chat-staging', role: 'billing'},
  {name: 'uvenaro-gateway-receipts-staging', role: 'gateway-receipts'},
  {name: 'uvenaro-adapter-evidence-staging', role: 'adapter-evidence'}
]);
const TARGET_WORKERS = freeze([
  'uvenaro-bounded-provider-adapter-staging',
  'uvenaro-metered-gateway-staging'
]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function sameDatabaseIdentity(observed, accepted) {
  const observedId = observed?.uuid || observed?.id;
  // Cloudflare inventory returns the identifier as `id`; deployment receipts
  // retain it as `uuid`. Role is derived from the accepted name, not API data.
  return observed?.name === accepted?.name &&
    observedId === accepted?.uuid &&
    UUID.test(observedId || '');
}

function uniqueNames(rows) {
  const names = rows.map(row => row?.name || row?.id).filter(Boolean);
  return names.length === new Set(names).size;
}

export function reconcileIsolatedStagingOwnership({
  acceptedRecord = {},
  accountId = '',
  pilotId = '',
  inventory = {},
  remoteChangesPerformed = false,
  providerRequestsPerformed = false,
  workersFreePlanVerified = false
} = {}) {
  const acceptedDatabases = Array.isArray(acceptedRecord.databases) ? acceptedRecord.databases : [];
  const acceptedWorkers = Array.isArray(acceptedRecord.workers) ? acceptedRecord.workers : [];
  const observedDatabases = Array.isArray(inventory.databases) ? inventory.databases : [];
  const observedWorkers = Array.isArray(inventory.workers) ? inventory.workers : [];
  const observedWorkerNames = observedWorkers.map(worker => worker?.name || worker?.id).filter(Boolean);
  const expectedWorkerNames = acceptedWorkers.length
    ? acceptedWorkers.map(worker => worker.name).filter(Boolean)
    : TARGET_WORKERS;

  const checks = {
    acceptedProtocol: acceptedRecord.protocol === 'uvenaro-verified-private-isolated-deployment-v1',
    accountBound: typeof accountId === 'string' && accountId.length === 32 &&
      acceptedRecord.accountId === accountId,
    completeInventory: inventory.complete === true,
    pilotPreserved: inventory.pilotPreserved === true &&
      observedDatabases.some(db => (db.uuid || db.id) === pilotId && db.name === 'uvenaro-account-staging'),
    targetDatabaseRoles: acceptedDatabases.length === TARGET_DATABASES.length &&
      acceptedDatabases.every(db => TARGET_DATABASES.some(target => target.name === db.name && target.role === db.role)),
    exactDatabaseIdentities: acceptedDatabases.length === TARGET_DATABASES.length &&
      acceptedDatabases.every(accepted => observedDatabases.some(observed => sameDatabaseIdentity(observed, accepted))),
    noUnexpectedTargetDatabases: observedDatabases.filter(db =>
      TARGET_DATABASES.some(target => target.name === db?.name)).length === TARGET_DATABASES.length,
    uniqueDatabaseNames: uniqueNames(observedDatabases),
    exactWorkerIdentities: expectedWorkerNames.length === TARGET_WORKERS.length &&
      TARGET_WORKERS.every(name => observedWorkerNames.includes(name)),
    uniqueWorkerNames: uniqueNames(observedWorkers),
    privateEndpoints: acceptedRecord.privateEndpointsVerified === true,
    safeOff: acceptedRecord.providerCallsPermitted === false &&
      acceptedRecord.productionActivated === false &&
      acceptedRecord.publicLaunchAccepted === false,
    noRemoteWrites: remoteChangesPerformed === false &&
      inventory.writePermissionsExercised === false,
    noProviderRequests: providerRequestsPerformed === false &&
      inventory.providerRequestsPerformed === false
  };

  const ownershipVerified = Object.values(checks).every(Boolean);
  const blockers = [];
  if (!ownershipVerified) blockers.push('OWNERSHIP_RECONCILIATION_REQUIRED');
  if (!workersFreePlanVerified) blockers.push('WORKERS_FREE_PLAN_UNVERIFIED');

  return {
    protocol: ISOLATED_STAGING_OWNERSHIP_RECONCILIATION_PROTOCOL,
    status: ownershipVerified ? 'OWNERSHIP_RECONCILIATION_PASS' : 'OWNERSHIP_RECONCILIATION_BLOCKED',
    ownershipVerified,
    provisioningAllowed: false,
    activationAllowed: false,
    safeOff: checks.safeOff,
    blockers,
    checks
  };
}

export function requireIsolatedStagingOwnershipReconciliation(input = {}) {
  const result = reconcileIsolatedStagingOwnership(input);
  if (!result.ownershipVerified) throw new Error('ISOLATED_STAGING_OWNERSHIP_UNVERIFIED');
  return freeze({...result});
}
