// Live deployment client -> API E2E, deliberately separate from the fixture
// landing-page suite. This script FAILS when the required isolated staging
// account fixtures are absent: no silent mock fallback and no skipped tests.
// Read-only: the test never writes to the target service.
import assert from 'node:assert/strict';
import test from 'node:test';

function required(name) {
  const value = process.env[name];
  assert.ok(value, name + ' is required for npm run test:live-api');
  return value;
}

function config() {
  assert.equal(process.env.QUAESTOR_E2E_NONPROD, '1',
    'explicit isolated non-production approval is required');
  const base = new URL(required('QUAESTOR_E2E_API_URL'));
  assert.ok(
    base.protocol === 'https:' ||
      (base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)),
    'HTTP may only target loopback; non-loopback services require HTTPS',
  );
  assert.equal(base.username, '');
  assert.equal(base.password, '');
  assert.equal(base.search, '');
  assert.equal(base.hash, '');
  return {
    base: base.href.replace(/\/+$/, ''),
    ownerToken: required('QUAESTOR_E2E_OWNER_TOKEN'),
    otherToken: required('QUAESTOR_E2E_OTHER_TOKEN'),
    ownerAccount: required('QUAESTOR_E2E_OWNER_ACCOUNT_ID'),
  };
}

function minorUnits(value, where) {
  assert.match(String(value), /^-?\d+$/, where + ' must be decimal integer minor units');
  assert.equal(typeof value, 'string', where + ' must remain a string, not a float');
}

async function request(ctx, path, token) {
  const response = await fetch(ctx.base + path, {
    redirect: 'manual',
    headers: token ? { authorization: 'Bearer ' + token, accept: 'application/json' }
      : { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.status < 300 || response.status >= 400,
    'redirects are not allowed to replay credentials: ' + path);
  const body = await response.text();
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    assert.fail(path + ' returned non-JSON from the live API');
  }
  return { status: response.status, body: parsed };
}

test('real live API: two owners, ledger isolation, journal consistency and cursor', async (t) => {
  const ctx = config();

  await t.test('missing and forged tokens are rejected before any ledger read', async () => {
    assert.equal((await request(ctx, '/api/v1/ledger/accounts')).status, 401);
    assert.equal((await request(ctx, '/api/v1/ledger/accounts', 'e2e-invalid-token')).status, 401);
  });

  await t.test('A can read a seeded account; B cannot read that account by ID', async () => {
    const accountPath = '/api/v1/ledger/accounts/' +
      encodeURIComponent(ctx.ownerAccount);
    const [listA, listB, detailA, detailB] = await Promise.all([
      request(ctx, '/api/v1/ledger/accounts', ctx.ownerToken),
      request(ctx, '/api/v1/ledger/accounts', ctx.otherToken),
      request(ctx, accountPath, ctx.ownerToken),
      request(ctx, accountPath, ctx.otherToken),
    ]);
    assert.equal(listA.status, 200);
    assert.equal(listB.status, 200);
    assert.ok(Array.isArray(listA.body), 'A must receive an account array');
    assert.ok(Array.isArray(listB.body), 'B must receive an account array');
    assert.ok(listA.body.some((item) => item.id === ctx.ownerAccount),
      'A fixture account must already exist before this suite runs');
    assert.ok(!listB.body.some((item) => item.id === ctx.ownerAccount),
      'B account listing leaked owner A fixture');
    assert.equal(detailA.status, 200);
    assert.equal(detailA.body.id, ctx.ownerAccount);
    assert.equal(detailB.status, 404, 'foreign account IDs must be indistinguishable from missing');

    if (detailA.body.balanceMinor !== undefined) {
      minorUnits(detailA.body.balanceMinor, 'account balance');
    }

    const entries = await request(ctx, accountPath + '/entries', ctx.ownerToken);
    assert.equal(entries.status, 200);
    assert.ok(Array.isArray(entries.body));
    for (const entry of entries.body) {
      assert.equal(entry.accountId, ctx.ownerAccount);
      minorUnits(entry.amountMinor, 'journal amount');
    }
  });

  await t.test('balance and cursor JSON contracts remain exact on the wire', async () => {
    const [balances, sync] = await Promise.all([
      request(ctx, '/api/v1/ledger/balances', ctx.ownerToken),
      request(ctx, '/api/v1/sync/changes?limit=10', ctx.ownerToken),
    ]);
    assert.equal(balances.status, 200);
    assert.ok(balances.body && typeof balances.body === 'object');
    minorUnits(balances.body.netMinor, 'net balance');
    assert.ok(Array.isArray(balances.body.balances));
    for (const balance of balances.body.balances) {
      minorUnits(balance.balanceMinor, 'per-account balance');
    }

    assert.equal(sync.status, 200);
    assert.ok(sync.body && typeof sync.body === 'object');
    assert.ok(Array.isArray(sync.body.changes));
    assert.equal(typeof sync.body.nextCursor, 'string');
    assert.ok(sync.body.nextCursor.length > 0);
    const next = await request(
      ctx,
      '/api/v1/sync/changes?cursor=' +
        encodeURIComponent(sync.body.nextCursor) + '&limit=10',
      ctx.ownerToken,
    );
    assert.equal(next.status, 200);
    assert.ok(Array.isArray(next.body.changes));
    assert.equal(typeof next.body.nextCursor, 'string');
  });
});
