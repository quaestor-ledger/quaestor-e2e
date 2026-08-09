import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const siteDir = fileURLToPath(new URL('../fixtures/site/', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Boots the bundled Quaestor-shaped fixture site on an ephemeral port.
 *
 * A remote Selenium browser runs in a container, so the fixture must listen on
 * a host interface reachable from that container rather than loopback only.
 * The public URL intentionally remains loopback-shaped: seleniumTargetURL()
 * rewrites it to SELENIUM_BROWSER_HOST for the remote browser, while local
 * Playwright/Puppeteer sessions continue to use 127.0.0.1.
 *
 * Returns the base URL and a close() that resolves when the socket is freed.
 */
export async function startFixtureServer({
  host = process.env.SELENIUM_REMOTE_URL ? '0.0.0.0' : '127.0.0.1',
  publicHost = host === '0.0.0.0' ? '127.0.0.1' : host,
  port = 0,
} = {}) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://placeholder');
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith('/')) {
        pathname += 'index.html';
      }
      // Resolve within siteDir and reject path traversal.
      const resolved = path.join(siteDir, path.normalize(pathname));
      if (!resolved.startsWith(siteDir)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(resolved);
      const type = CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': type }).end(body);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      response.writeHead(500, { 'content-type': 'text/plain' }).end('Server error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const baseURL = `http://${publicHost}:${address.port}`;

  return {
    baseURL,
    listenAddress: address.address,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
