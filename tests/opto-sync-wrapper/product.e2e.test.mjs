import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const profilePath = process.env.OPTO_SYNC_PROFILE;
const NO_SYNC = profilePath
  ? false
  : 'run through the isolated Opto-Sync workflow with OPTO_SYNC_PROFILE set';
const require = createRequire(import.meta.url);

let profile;
let sdk;
if (!NO_SYNC) {
  require('fake-indexeddb/auto');
  profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  sdk = require(process.env.OPTO_SYNC_SDK_ENTRY ?? '../dist/index.js');
}

const {
  OptoSyncClient,
  createOptoSyncClient,
  initOptoSync,
  SYNC_STATUS,
  reconcileIncoming,
  engineVersion,
} = sdk ?? {};

const CANONICAL_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function assertCanonicalDecimalString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a decimal string`);
  assert.match(value, CANONICAL_DECIMAL, `${label} must be canonical base-10 decimal text`);
}

async function deleteDatabase(name) {
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function openClient(databaseName) {
  if (typeof initOptoSync === 'function') await initOptoSync();
  if (typeof createOptoSyncClient === 'function') {
    return createOptoSyncClient({
      databaseName,
      stampUpdatedAt: false,
    });
  }
  return new OptoSyncClient({
    databaseName,
    stampUpdatedAt: false,
  });
}

test(
  'the downstream profile keeps product policy above the shared engine',
  { skip: NO_SYNC },
  () => {
    assert.equal(profile.dependency.package, 'opto-sync/opto-sync-clients');
    assert.equal(profile.dependency.range, '^0.2.0');
    assert.ok(profile.collections.length > 0);
    assert.ok(profile.writeStrategies.includes('queuedOptimistic'));
    assert.ok(profile.writeStrategies.includes('remoteConfirmed'));
    assert.ok(profile.domainGuards.length > 0);
    assert.ok(profile.persistence.web.includes('indexeddb'));
    assert.ok(profile.persistence.mobile.includes('sqlite'));
    assert.ok(profile.persistence.backend.includes('postgres'));
    assert.ok(profile.persistence.backend.includes('supabase'));
  },
);

test(
  'a product mutation survives restart, keeps its protocol id, and hides a stale server echo',
  { skip: NO_SYNC },
  async (t) => {
    const databaseName =
      `opto-downstream-${profile.repository.replaceAll('/', '-')}`;
    const collection = profile.collections[0];
    const recordId = 'wrapper-record-1';
    const pendingPayload = {
      id: recordId,
      title: 'edited offline',
      product: profile.repository,
      updatedAt: 5000,
    };

    await deleteDatabase(databaseName);
    t.after(() => deleteDatabase(databaseName));

    const client = await openClient(databaseName);
    const mutationId = await client.queueMutation(
      collection,
      recordId,
      pendingPayload,
    );
    const firstPush = await client.protocolPushRequest();
    const replayedPush = await client.protocolPushRequest();
    assert.deepEqual(
      firstPush.mutations.map((mutation) => mutation.mutationId),
      replayedPush.mutations.map((mutation) => mutation.mutationId),
    );
    client.db.close();

    const reopened = new OptoSyncClient({
      databaseName,
      stampUpdatedAt: false,
    });
    const pendingAfterRestart = await reopened.pendingMutations();
    assert.equal(pendingAfterRestart.length, 1);
    assert.equal(pendingAfterRestart[0].tableName, collection);
    assert.equal(pendingAfterRestart[0].recordId, recordId);
    assert.deepEqual(
      JSON.parse(pendingAfterRestart[0].jsonPayload),
      pendingPayload,
    );

    const staleServerEcho = {
      id: recordId,
      title: 'stale server value',
      product: profile.repository,
      updatedAt: 10,
    };
    const visible = reopened.reconcileIncoming(
      collection,
      recordId,
      staleServerEcho,
      pendingPayload,
    );
    assert.equal(visible.title, 'edited offline');
    assert.equal(visible.updatedAt, 5000);

    await reopened.markMutation(mutationId, SYNC_STATUS.SYNCED);
    assert.equal((await reopened.pendingMutations()).length, 0);
    reopened.db.close();
  },
);

test(
  'timestamp conflicts and tombstones are deterministic in the installed engine',
  { skip: NO_SYNC },
  async () => {
    if (typeof initOptoSync === 'function') await initOptoSync();

    const local = {
      id: 'conflict-1',
      value: 'new local',
      updatedAt: 200,
    };
    const staleIncoming = {
      id: 'conflict-1',
      value: 'old server',
      updatedAt: 100,
    };
    assert.deepEqual(reconcileIncoming(local, staleIncoming), local);

    const staleLiveRecord = {
      id: 'deleted-1',
      value: 'must not resurrect',
      tombstone: false,
      updatedAt: 100,
    };
    const newerTombstone = {
      id: 'deleted-1',
      value: null,
      tombstone: true,
      deletedAt: 200,
      updatedAt: 200,
    };
    const winner = reconcileIncoming(staleLiveRecord, newerTombstone);
    assert.equal(winner.tombstone, true);
    assert.equal(winner.deletedAt, 200);
    assert.equal(winner.value, null);
    assert.match(String(engineVersion()), /^\d+\.\d+\.\d+/);
  },
);

test(
  'Quaestor exposes only reviewed ledger metadata and canonical decimal-string money',
  { skip: NO_SYNC },
  () => {
    assert.deepEqual(
      [...profile.collections].sort(),
      ['audit_metadata', 'conflicts', 'ledger_snapshots', 'sync_checkpoints'],
    );
    const forbiddenCollections = new Set([
      'bank_accounts',
      'card_data',
      'collection_commands',
      'money_movement_instructions',
      'payment_credentials',
      'posting_commands',
      'processor_tokens',
      'raw_provider_payloads',
      'settlement_secrets',
      'transfer_instructions',
    ]);
    assert.equal(
      profile.collections.some((collection) =>
        forbiddenCollections.has(collection),
      ),
      false,
    );
    assert.ok(
      profile.domainGuards.some((guard) =>
        guard.includes('sync never moves money'),
      ),
    );
    assert.ok(
      profile.domainGuards.some((guard) =>
        guard.includes('canonical decimal strings'),
      ),
    );
    assert.ok(
      profile.domainGuards.some((guard) =>
        guard.includes('account, tenant, audit, role, and conflict-escalation'),
      ),
    );

    assert.doesNotThrow(() => assertCanonicalDecimalString('0.00', 'zero'));
    assert.doesNotThrow(() => assertCanonicalDecimalString('1250.00', 'amount'));
    assert.throws(() => assertCanonicalDecimalString(1250, 'numeric amount'), /decimal string/);
    assert.throws(() => assertCanonicalDecimalString('01.00', 'leading-zero amount'), /canonical/);
    assert.throws(() => assertCanonicalDecimalString('1e3', 'exponent amount'), /canonical/);
  },
);

test(
  'ledger snapshot and conflict mutations sharing an id remain tenant and collection isolated',
  { skip: NO_SYNC },
  async (t) => {
    const databaseName =
      `opto-quaestor-financial-${profile.repository.replaceAll('/', '-')}`;
    const recordId = 'ledger-record-42';
    const tenantId = 'tenant-42';

    await deleteDatabase(databaseName);
    t.after(() => deleteDatabase(databaseName));

    const snapshot = {
      id: recordId,
      tenantId,
      accountId: 'account-42',
      currency: 'USD',
      debitBalance: '1250.00',
      creditBalance: '1250.00',
      revision: 7,
      updatedAt: 700,
    };
    const conflict = {
      id: recordId,
      tenantId,
      collection: 'ledger_snapshots',
      recordId,
      baseRevision: 6,
      serverRevision: 7,
      reason: 'stale_base',
      localAmount: '1250.00',
      serverAmount: '1250.00',
      updatedAt: 701,
    };
    for (const [label, value] of Object.entries({
      debitBalance: snapshot.debitBalance,
      creditBalance: snapshot.creditBalance,
      localAmount: conflict.localAmount,
      serverAmount: conflict.serverAmount,
    })) {
      assertCanonicalDecimalString(value, label);
    }

    const client = await openClient(databaseName);
    const snapshotMutationId = await client.queueMutation(
      'ledger_snapshots',
      recordId,
      snapshot,
    );
    const conflictMutationId = await client.queueMutation(
      'conflicts',
      recordId,
      conflict,
    );
    assert.notEqual(snapshotMutationId, conflictMutationId);

    const firstPush = await client.protocolPushRequest();
    const replayedPush = await client.protocolPushRequest();
    const projection = (request) =>
      request.mutations.map((mutation) => ({
        mutationId: mutation.mutationId,
        recordId: mutation.recordId,
        table: mutation.table,
      }));
    assert.deepEqual(projection(replayedPush), projection(firstPush));
    assert.deepEqual(
      new Set(firstPush.mutations.map((mutation) => mutation.table)),
      new Set(['ledger_snapshots', 'conflicts']),
    );

    client.db.close();
    const reopened = new OptoSyncClient({
      databaseName,
      stampUpdatedAt: false,
    });
    const afterRestart = await reopened.pendingMutations();
    assert.equal(afterRestart.length, 2);
    for (const mutation of afterRestart) {
      assert.equal(JSON.parse(mutation.jsonPayload).tenantId, tenantId);
    }

    await reopened.markMutation(snapshotMutationId, SYNC_STATUS.SYNCED);
    const remaining = await reopened.pendingMutations();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].tableName, 'conflicts');
    assert.equal(JSON.parse(remaining[0].jsonPayload).reason, 'stale_base');
    reopened.db.close();
  },
);

test(
  'server-authoritative posted and reversed ledger state defeats stale drafts',
  { skip: NO_SYNC },
  async () => {
    if (typeof initOptoSync === 'function') await initOptoSync();

    const staleDraft = {
      id: 'transaction-42',
      tenantId: 'tenant-42',
      status: 'draft',
      totalDebit: '1250.00',
      totalCredit: '1250.00',
      immutable: false,
      updatedAt: 400,
    };
    const authoritativePosting = {
      id: 'transaction-42',
      tenantId: 'tenant-42',
      status: 'posted',
      totalDebit: '1250.00',
      totalCredit: '1250.00',
      postedAt: 500,
      immutable: true,
      updatedAt: 500,
    };
    let winner = reconcileIncoming(staleDraft, authoritativePosting);
    assert.equal(winner.status, 'posted');
    assert.equal(winner.immutable, true);

    const authoritativeReversal = {
      ...authoritativePosting,
      status: 'reversed',
      reversalTransactionId: 'transaction-43',
      reversedAt: 600,
      updatedAt: 600,
    };
    winner = reconcileIncoming(authoritativePosting, authoritativeReversal);
    assert.equal(winner.status, 'reversed');
    assert.equal(winner.reversalTransactionId, 'transaction-43');
    assertCanonicalDecimalString(winner.totalDebit, 'reversed totalDebit');
    assertCanonicalDecimalString(winner.totalCredit, 'reversed totalCredit');

    const staleResurrection = {
      ...staleDraft,
      updatedAt: 550,
    };
    assert.deepEqual(
      reconcileIncoming(authoritativeReversal, staleResurrection),
      authoritativeReversal,
    );
  },
);
