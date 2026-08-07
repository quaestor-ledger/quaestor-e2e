import assert from 'node:assert/strict';
import { connect } from 'node:net';
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
