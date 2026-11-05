import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { startFixtureServer } from '../src/fixture-server.mjs';

test('a wildcard fixture advertises loopback and accepts its wildcard address', async (t) => {
  const fixture = await startFixtureServer({ host: '0.0.0.0' });
  t.after(() => fixture.close());

  const advertisedURL = new URL(fixture.baseURL);
  assert.equal(advertisedURL.hostname, '127.0.0.1');
  assert.equal(fixture.listenAddress, '0.0.0.0');

  const wildcardURL = new URL(fixture.baseURL);
  wildcardURL.hostname = '0.0.0.0';
  const response = await new Promise((resolve, reject) => {
    const socket = connect({
      host: wildcardURL.hostname,
      port: Number(wildcardURL.port),
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write('GET / HTTP/1.1\r\nHost: fixture\r\nConnection: close\r\n\r\n');
    });
    socket.on('data', (chunk) => { raw += chunk; });
    socket.on('end', () => resolve(raw));
    socket.on('error', reject);
  });
  assert.match(response, /^HTTP\/1\.1 200 OK/m);
  assert.match(response, /<title>[^<]+<\/title>/i);
});

test('a remote Selenium target binds the fixture to the host interface', async (t) => {
  const previousRemoteURL = process.env.SELENIUM_REMOTE_URL;
  process.env.SELENIUM_REMOTE_URL = 'http://127.0.0.1:4444';
  t.after(() => {
    if (previousRemoteURL === undefined) {
      delete process.env.SELENIUM_REMOTE_URL;
    } else {
      process.env.SELENIUM_REMOTE_URL = previousRemoteURL;
    }
  });

  const { resolveTarget } = await import('../src/harness.mjs?remote-fixture-test');
  const target = await resolveTarget();
  t.after(() => target.close());

  assert.equal(new URL(target.baseURL).hostname, '127.0.0.1');
  assert.equal(target.listenAddress, '0.0.0.0');
});


function wireRequest(baseURL, method, requestPath) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(baseURL, { method, path: requestPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

test('fixture serves static assets over real HTTP with no MIME sniffing', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  const landing = await wireRequest(fixture.baseURL, 'GET', '/?ref=network-e2e');
  assert.equal(landing.status, 200);
  assert.match(landing.headers['content-type'], /^text\/html/i);
  assert.equal(landing.headers['x-content-type-options'], 'nosniff');
  assert.match(landing.body, /<title>[^<]+<\/title>/i);

  const head = await wireRequest(fixture.baseURL, 'HEAD', '/');
  assert.equal(head.status, 200);
  assert.equal(head.body, '', 'HEAD must return headers but never a response body');

  const missing = await wireRequest(fixture.baseURL, 'GET', '/not-present-e2e.txt');
  assert.equal(missing.status, 404, 'missing files must never become a false success');
});

test('fixture is an immutable read-only origin, not a writable pretend API', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await wireRequest(fixture.baseURL, method, '/');
    assert.equal(response.status, 405, `${method} unexpectedly accepted`);
    assert.equal(response.headers.allow, 'GET, HEAD');
  }
  const original = await wireRequest(fixture.baseURL, 'GET', '/');
  assert.equal(original.status, 200, 'rejected mutations must not change the fixture');
});

test('malformed and encoded-traversal requests cannot read outside the fixture root', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  for (const requestPath of [
    '/..%2f..%2fAGENTS.md',
    '/images/%2e%2e%2f..%2fREADME.md',
    '/%2e%2e%5c..%5c.env',
    '/safe%2f..%2f..%2fpackage.json',
  ]) {
    const response = await wireRequest(fixture.baseURL, 'GET', requestPath);
    assert.equal(response.status, 403, `traversal was not denied: ${requestPath}`);
    assert.doesNotMatch(response.body, /BEGIN (?:PRIVATE|OPENSSH) KEY|github_pat_/i);
  }
  for (const requestPath of ['/bad%escape', '/%00invalid']) {
    const response = await wireRequest(fixture.baseURL, 'GET', requestPath);
    assert.equal(response.status, 400, `bad URL was not rejected: ${requestPath}`);
  }
  const after = await wireRequest(fixture.baseURL, 'GET', '/');
  assert.equal(after.status, 200, 'malformed requests must not break the fixture server');
});
