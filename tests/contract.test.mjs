import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTarget } from '../src/harness.mjs';
import { resolveNavigationTimeoutMs } from '../src/config.mjs';
import { ORG_URL, PRODUCT_NAME, MIN_FEATURE_CARDS } from '../scenarios/index.mjs';

test('E2E navigation timeout configuration is bounded and decimal-only', () => {
  assert.equal(resolveNavigationTimeoutMs(undefined), 30_000);
  assert.equal(resolveNavigationTimeoutMs(''), 30_000);
  assert.equal(resolveNavigationTimeoutMs(' 1200 '), 1200);
  assert.equal(resolveNavigationTimeoutMs('100'), 100);
  assert.equal(resolveNavigationTimeoutMs('300000'), 300000);
  for (const raw of ['0', '-1', '99', '300001', 'NaN', 'Infinity', '1e3', '0x1000', '1.25', '99999999999999999']) {
    assert.throws(() => resolveNavigationTimeoutMs(raw), RangeError, String(raw));
  }
});

function attributeValues(html, attribute) {
  const values = [];
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'gi');
  for (const match of html.matchAll(pattern)) values.push(match[1]);
  return values;
}

// A browser-free smoke of the target's HTML contract. Runs without Playwright,
// Puppeteer, or a Grid, so CI can gate on it before the heavier driver suites.
test('target HTML satisfies the Quaestor landing-page contract', async (t) => {
  const target = await resolveTarget();
  try {
    const response = await fetch(target.baseURL, { redirect: 'follow' });
    assert.ok(response.status < 400, `expected success status, got ${response.status}`);
    const html = await response.text();

    await t.test('has a <title>', () => {
      assert.match(html, /<title>[^<]+<\/title>/i);
    });

    await t.test(`h1 mentions "${PRODUCT_NAME}"`, () => {
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
      assert.ok(h1, 'expected an <h1>');
      assert.match(h1[1], new RegExp(PRODUCT_NAME, 'i'));
    });

    await t.test(`has >= ${MIN_FEATURE_CARDS} .card elements`, () => {
      const cards = html.match(/class="[^"]*\bcard\b[^"]*"/g) ?? [];
      assert.ok(
        cards.length >= MIN_FEATURE_CARDS,
        `expected >= ${MIN_FEATURE_CARDS} cards, found ${cards.length}`,
      );
    });

    await t.test('footer links to the GitHub org', () => {
      assert.ok(html.includes(ORG_URL), `expected a link to ${ORG_URL}`);
    });

    await t.test('declares a document language', () => {
      assert.match(html, /<html[^>]*\blang\s*=\s*["'][^"']+["']/i);
    });

    await t.test('has a non-empty meta description', () => {
      const meta = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html);
      assert.ok(meta && meta[1].trim().length > 0, 'expected a non-empty meta description');
    });

    await t.test('declares exactly one <h1>', () => {
      const count = (html.match(/<h1[\s>]/gi) ?? []).length;
      assert.equal(count, 1, `expected exactly one <h1>, found ${count}`);
    });

    await t.test('does not embed insecure HTTP assets', () => {
      const assetUrls = [...attributeValues(html, 'src'), ...attributeValues(html, 'href')];
      const insecure = assetUrls.filter((value) => /^http:\/\//i.test(value));
      assert.deepEqual(insecure, [], `found insecure asset URLs: ${insecure.join(', ')}`);
    });

    await t.test('external links are protected against opener access', () => {
      const externalLinks = [...html.matchAll(/<a\b([^>]*)>/gi)]
        .map((match) => match[1])
        .filter((attrs) => /target\s*=\s*["']_blank["']/i.test(attrs));

      for (const attrs of externalLinks) {
        const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
        assert.match(rel, /\bnoopener\b/i, `target=_blank link missing noopener: ${attrs}`);
        assert.match(rel, /\bnoreferrer\b/i, `target=_blank link missing noreferrer: ${attrs}`);
      }
    });

    await t.test('images include non-empty alt text', () => {
      for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
        const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(match[1]);
        assert.ok(alt, `image is missing alt text: ${match[0]}`);
        assert.ok(alt[1].trim().length > 0, `image has empty alt text: ${match[0]}`);
      }
    });

    await t.test('page has a main landmark', () => {
      assert.match(html, /<main(?:\s|>)/i);
    });

    await t.test('response does not expose a server implementation header', () => {
      assert.equal(response.headers.get('x-powered-by'), null);
    });

    // Fixture-only: the bundled site ships a second page. The deployed target
    // does not, so this is gated on the nav marker and skipped otherwise.
    await t.test('the ledger page is reachable and lists entries', async (st) => {
      if (!html.includes('data-testid="nav-ledger"')) {
        st.skip('target has no ledger page');
        return;
      }
      const ledgerURL = new URL('ledger.html', target.baseURL).href;
      const ledger = await fetch(ledgerURL, { redirect: 'follow' });
      assert.ok(ledger.status < 400, `expected the ledger page to load, got ${ledger.status}`);
      const ledgerHtml = await ledger.text();
      assert.match(ledgerHtml, /Recent entries/i);
      assert.match(ledgerHtml, /<table[\s>]/i);
      assert.match(ledgerHtml, /<caption[\s>]/i, 'ledger table should have a caption');
    });
  } finally {
    await target.close();
  }
});
