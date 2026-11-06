import assert from 'node:assert/strict';
import { connect } from 'node:net';
import test from 'node:test';
import { startFixtureServer } from '../src/fixture-server.mjs';

async function get(baseURL, path) {
  const response = await fetch(new URL(path, baseURL), {
    redirect: 'manual',
    signal: AbortSignal.timeout(3_000),
  });
  return { response, body: await response.text() };
}

async function fragmentedGet(baseURL, path) {
  const endpoint = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: endpoint.hostname, port: Number(endpoint.port) });
    const chunks = [];
    socket.setTimeout(3_000, () => socket.destroy(new Error('raw TCP fixture read timeout')));
    socket.once('error', reject);
    socket.on('data', (data) => chunks.push(data));
    socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.once('connect', () => {
      // Deliberately split an HTTP request across TCP packets. The test uses
      // the actual Node HTTP parser/listener rather than calling the route directly.
      socket.write('GET ' + path + ' HTTP/1.1\r\nHost: ');
      setImmediate(() => socket.write('fixture.local\r\nConnection: close\r\n\r\n'));
    });
  });
}

test('twenty-four parallel clients receive immutable ledger and index documents over real HTTP', async (t) => {
  const site = await startFixtureServer({ host: '127.0.0.1' });
  t.after(() => site.close());

  const canonicalIndex = await get(site.baseURL, '/index.html');
  const canonicalLedger = await get(site.baseURL, '/ledger.html');
  assert.equal(canonicalIndex.response.status, 200);
  assert.equal(canonicalLedger.response.status, 200);
  assert.match(canonicalLedger.body, /Recent entries/i);
  assert.match(canonicalLedger.body, /<table[\s>]/i);

  const batch = await Promise.all(Array.from({ length: 24 }, (_, i) => {
    const route = i % 2 ? '/ledger.html' : '/';
    return get(site.baseURL, route);
  }));
  for (const [i, item] of batch.entries()) {
    assert.equal(item.response.status, 200, 'request ' + i);
    assert.match(item.response.headers.get('content-type') ?? '', /^text\/html\b/);
    assert.equal(item.body, i % 2 ? canonicalLedger.body : canonicalIndex.body,
      'concurrent GETs must not mutate bundled fixture bytes');
  }
});

test('fragmented TCP request framing returns one complete HTML document', async (t) => {
  const site = await startFixtureServer({ host: '127.0.0.1' });
  t.after(() => site.close());
  const raw = await fragmentedGet(site.baseURL, '/ledger.html');
  assert.match(raw, /^HTTP\/1\.1 200 OK\r\n/);
  assert.match(raw, /Content-Type: text\/html; charset=utf-8/i);
  const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  assert.match(body, /Recent entries/i);
  assert.match(body, /<table[\s>]/i);
});

test('untrusted query parameters do not influence returned ledger content or leak attacker bytes', async (t) => {
  const site = await startFixtureServer({ host: '127.0.0.1' });
  t.after(() => site.close());
  const canonical = await get(site.baseURL, '/ledger.html');
  const marker = '<script>window.__queryInjection=true</script>';
  const injected = await get(site.baseURL, '/ledger.html?next=' + encodeURIComponent(marker));
  assert.equal(injected.response.status, 200);
  assert.equal(injected.body, canonical.body);
  assert.equal(injected.body.includes(marker), false);
  const missing = await get(site.baseURL, '/ledger-missing.html?next=' + encodeURIComponent(marker));
  assert.equal(missing.response.status, 404);
  assert.equal((await missing.body).includes(marker), false);
});

test('a closed first listener cannot interrupt a second independent browser fixture', async (t) => {
  const first = await startFixtureServer({ host: '127.0.0.1' });
  const second = await startFixtureServer({ host: '127.0.0.1' });
  let closed = false;
  t.after(async () => {
    if (!closed) await first.close();
    await second.close();
  });
  assert.notEqual(first.baseURL, second.baseURL);
  const before = await get(second.baseURL, '/ledger.html');
  assert.equal(before.response.status, 200);
  await first.close();
  closed = true;
  const after = await get(second.baseURL, '/ledger.html');
  assert.equal(after.response.status, 200);
  assert.equal(after.body, before.body);
});
