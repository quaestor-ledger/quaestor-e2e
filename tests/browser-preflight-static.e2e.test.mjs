import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startFixtureServer } from '../src/fixture-server.mjs';

const docs = Object.freeze([
  { path: '/index.html', file: '../fixtures/site/index.html' },
  { path: '/ledger.html', file: '../fixtures/site/ledger.html' },
]);

async function request(site, path, options = {}) {
  return fetch(new URL(path, site.baseURL), {
    redirect: 'manual',
    signal: AbortSignal.timeout(3_000),
    ...options,
  });
}

test('browser preflight HEAD never streams a body and leaves subsequent GET intact', async (t) => {
  const site = await startFixtureServer({ host: '127.0.0.1' });
  t.after(() => site.close());
  for (const item of docs) {
    const head = await request(site, item.path, { method: 'HEAD' });
    assert.equal(head.status, 200, item.path);
    assert.match(head.headers.get('content-type') ?? '', /^text\/html\b/i);
    assert.equal((await head.arrayBuffer()).byteLength, 0, 'HEAD must never send HTML');
    const get = await request(site, item.path);
    assert.equal(get.status, 200);
    const expected = await readFile(fileURLToPath(new URL(item.file, import.meta.url)));
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), expected,
      'GET must serve the immutable checked-in fixture without truncation');
  }
});

test('cache validators and Range requests cannot generate stale or partial ledger documents', async (t) => {
  const site = await startFixtureServer({ host: '127.0.0.1' });
  t.after(() => site.close());
  const expected = await readFile(fileURLToPath(new URL('../fixtures/site/ledger.html', import.meta.url)));
  for (const headers of [
    { 'If-None-Match': '"untrusted-etag"' },
    { 'If-Modified-Since': 'Wed, 01 Jan 2020 00:00:00 GMT' },
    { Range: 'bytes=0-3' },
    { 'If-Range': '"untrusted"', Range: 'bytes=0-3' },
  ]) {
    const result = await request(site, '/ledger.html', { headers });
    assert.equal(result.status, 200, 'no conditional/range support: ' + JSON.stringify(headers));
    assert.equal(result.headers.get('content-range'), null);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), expected);
  }
});

test('listener shutdown and exact port reuse preserve browser fixture byte identity', async (t) => {
  const first = await startFixtureServer({ host: '127.0.0.1' });
  let firstOpen = true;
  t.after(async () => { if (firstOpen) await first.close(); });
  const port = Number(new URL(first.baseURL).port);
  const initial = await request(first, '/ledger.html');
  const bytes = Buffer.from(await initial.arrayBuffer());
  await first.close();
  firstOpen = false;
  const second = await startFixtureServer({ host: '127.0.0.1', port });
  t.after(() => second.close());
  assert.equal(Number(new URL(second.baseURL).port), port);
  const subsequent = await request(second, '/ledger.html');
  assert.equal(subsequent.status, 200);
  assert.deepEqual(Buffer.from(await subsequent.arrayBuffer()), bytes);
});

test('untrusted conditional headers, Origin, and cookies never alter the static ledger response', async (t) => {
  const site = await startFixtureServer({ host: '127.0.0.1' });
  t.after(() => site.close());
  const baseline = await request(site, '/ledger.html');
  const expected = Buffer.from(await baseline.arrayBuffer());
  const altered = await request(site, '/ledger.html', {
    headers: {
      Origin: 'https://untrusted.invalid',
      'X-Forwarded-Host': 'untrusted.invalid',
      'If-None-Match': '*',
      Cookie: 'session=synthetic-browser-e2e-proof',
    },
  });
  assert.equal(altered.status, 200);
  assert.equal(altered.headers.get('access-control-allow-origin'), null);
  assert.equal(altered.headers.get('location'), null);
  const body = Buffer.from(await altered.arrayBuffer());
  assert.deepEqual(body, expected);
  assert.equal(body.includes(Buffer.from('synthetic-browser-e2e-proof')), false);
});
