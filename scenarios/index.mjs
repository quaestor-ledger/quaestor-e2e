import assert from 'node:assert/strict';

// The canonical Quaestor landing-page contract. Each scenario is written once
// against a driver-agnostic interface (see src/drivers/interface.md) and is run
// identically by the Playwright, Puppeteer, and Selenium suites, so a real
// regression is caught the same way regardless of driver and any cross-driver
// behavioural gap surfaces as a single failing driver.

export const PRODUCT_NAME = 'Quaestor';
export const ORG_URL = 'https://github.com/quaestor-ledger';
export const MIN_FEATURE_CARDS = 4;

export const scenarios = [
  {
    name: 'navigates to the site without an error status',
    async check(driver, { baseURL }) {
      const { status } = await driver.goto(baseURL);
      // Playwright/Puppeteer expose the response status; the W3C WebDriver
      // protocol does not, so Selenium reports `undefined` and we validate the
      // load through the rendered DOM below instead of a numeric status.
      if (status !== undefined) {
        assert.ok(status < 400, `expected a success status, got ${status}`);
      }
      assert.ok(await driver.count('body'), 'expected a <body> to render');
    },
  },
  {
    name: 'has a non-empty <title>',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const title = (await driver.title()).trim();
      assert.ok(title.length > 0, 'expected a non-empty document title');
    },
  },
  {
    name: `h1 contains the product name "${PRODUCT_NAME}"`,
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const heading = await driver.text('h1');
      assert.match(heading, new RegExp(PRODUCT_NAME, 'i'));
    },
  },
  {
    name: `shows at least ${MIN_FEATURE_CARDS} feature cards`,
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const count = await driver.count('.card');
      assert.ok(
        count >= MIN_FEATURE_CARDS,
        `expected >= ${MIN_FEATURE_CARDS} .card elements, found ${count}`,
      );
      assert.ok(await driver.visible('.card'), 'expected the first card to be visible');
    },
  },
  {
    name: 'footer links to the GitHub org',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const href = await driver.attribute(`footer a[href="${ORG_URL}"]`, 'href');
      assert.equal(href, ORG_URL);
    },
  },
  {
    name: 'declares a document language',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const lang = await driver.attribute('html', 'lang');
      assert.ok(lang && lang.trim().length > 0, 'expected <html lang="...">');
    },
  },
  {
    name: 'has a non-empty meta description',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const description = await driver.attribute('meta[name="description"]', 'content');
      assert.ok(
        description && description.trim().length > 0,
        'expected a non-empty <meta name="description">',
      );
    },
  },
  {
    name: 'every feature card has a heading',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const allHaveHeadings = await driver.evaluate(
        `Array.from(document.querySelectorAll('.card')).length > 0 &&
         Array.from(document.querySelectorAll('.card')).every(
           (card) => (card.querySelector('h2, h3, h4')?.textContent ?? '').trim().length > 0,
         )`,
      );
      assert.equal(allHaveHeadings, true, 'expected every .card to contain a non-empty heading');
    },
  },
  {
    name: 'is responsive at a mobile viewport (no horizontal overflow)',
    async check(driver, { baseURL }) {
      try {
        await driver.setViewport(390, 844);
        await driver.goto(baseURL);
        assert.ok(await driver.visible('.card'), 'expected the first card to be visible on mobile');
        const overflow = await driver.evaluate(
          `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
        );
        assert.ok(Number(overflow) <= 1, `expected no horizontal overflow, got ${overflow}px`);
      } finally {
        await driver.setViewport(1280, 800);
      }
    },
  },
  {
    name: 'reflects interaction (ping button updates status)',
    // Fixture-only interactivity: the deployed marketing site has no ping
    // button, so this scenario skips when the target does not render one.
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="ping"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      assert.equal(await driver.text('[data-testid="status"]'), 'idle');
      await driver.click('[data-testid="ping"]');
      await driver.waitForText('[data-testid="status"]', 'ok');
      assert.equal(await driver.text('[data-testid="status"]'), 'ok');
      // Idempotent: a second ping keeps the resolved state.
      await driver.click('[data-testid="ping"]');
      assert.equal(await driver.text('[data-testid="status"]'), 'ok');
    },
  },
  {
    name: 'logs no console errors during load',
    async check(driver, { baseURL }) {
      driver.resetConsole();
      await driver.goto(baseURL, { waitUntil: 'load' });
      const errors = driver.consoleErrors().filter((line) => !/favicon/i.test(line));
      assert.deepEqual(errors, [], `unexpected console errors: ${errors.join(' | ')}`);
    },
  },

  // ── Document structure & accessibility ────────────────────────────────────
  {
    name: 'has exactly one <h1>',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      assert.equal(await driver.count('h1'), 1, 'expected exactly one <h1> on the page');
    },
  },
  {
    name: 'uses a heading hierarchy that starts at h1 and skips no level',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const ok = await driver.evaluate(
        `(() => {
          const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
            .map((h) => Number(h.tagName[1]));
          if (levels.length === 0 || levels[0] !== 1) return false;
          for (let i = 1; i < levels.length; i += 1) {
            if (levels[i] - levels[i - 1] > 1) return false;
          }
          return true;
        })()`,
      );
      assert.equal(ok, true, 'expected headings to start at h1 and never skip a level');
    },
  },
  {
    name: 'every link has a non-empty, non-javascript href',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const bad = await driver.evaluate(
        `Array.from(document.querySelectorAll('a')).filter((a) => {
          const href = (a.getAttribute('href') || '').trim();
          return href === '' || href === '#' || href.toLowerCase().startsWith('javascript:');
        }).length`,
      );
      assert.equal(Number(bad), 0, 'expected no empty, "#", or javascript: links');
    },
  },
  {
    name: 'the feature list has an accessible name',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('.cards')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const named = await driver.evaluate(
        `(() => {
          const el = document.querySelector('.cards');
          if (!el) return false;
          const label = (el.getAttribute('aria-label') || '').trim();
          const labelledby = el.getAttribute('aria-labelledby');
          const ref = labelledby && document.getElementById(labelledby);
          return Boolean(label || (ref && ref.textContent.trim()));
        })()`,
      );
      assert.equal(named, true, 'expected the feature list to expose an accessible name');
    },
  },
  {
    name: 'all images have alt text',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('img')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const missing = await driver.evaluate(
        `Array.from(document.querySelectorAll('img')).filter((img) => !img.hasAttribute('alt')).length`,
      );
      assert.equal(Number(missing), 0, 'expected every <img> to declare an alt attribute');
    },
  },
  {
    name: 'every button has an accessible name',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('button')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const unnamed = await driver.evaluate(
        `Array.from(document.querySelectorAll('button')).filter((b) => {
          const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
          return name.length === 0;
        }).length`,
      );
      assert.equal(Number(unnamed), 0, 'expected every <button> to have a non-empty accessible name');
    },
  },
  {
    name: 'contains no duplicate element ids',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const dupes = await driver.evaluate(
        `(() => {
          const seen = new Set();
          const dup = new Set();
          for (const el of document.querySelectorAll('[id]')) {
            if (seen.has(el.id)) dup.add(el.id);
            seen.add(el.id);
          }
          return Array.from(dup);
        })()`,
      );
      assert.deepEqual(dupes, [], `expected no duplicate ids, found: ${dupes.join(', ')}`);
    },
  },
  {
    name: 'renders header, main, and footer landmarks',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      for (const landmark of ['header', 'main', 'footer']) {
        assert.ok((await driver.count(landmark)) >= 1, `expected a <${landmark}> landmark`);
      }
    },
  },

  // ── Head / metadata ───────────────────────────────────────────────────────
  {
    name: 'declares a mobile viewport meta',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const content = await driver.attribute('meta[name="viewport"]', 'content');
      assert.ok(
        content && /width\s*=\s*device-width/i.test(content),
        `expected a device-width viewport meta, got: ${content}`,
      );
    },
  },
  {
    name: 'declares a UTF-8 character encoding',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const charset = await driver.evaluate('document.characterSet');
      assert.match(String(charset), /utf-8/i);
    },
  },
  {
    name: `<title> contains "${PRODUCT_NAME}"`,
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      assert.match(await driver.title(), new RegExp(PRODUCT_NAME, 'i'));
    },
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    name: 'shows a non-empty tagline',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('.tagline')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      assert.ok((await driver.text('.tagline')).length > 0, 'expected a non-empty tagline');
    },
  },
  {
    name: 'every feature card has a body paragraph',
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const ok = await driver.evaluate(
        `Array.from(document.querySelectorAll('.card')).length > 0 &&
         Array.from(document.querySelectorAll('.card')).every(
           (c) => ((c.querySelector('p') || {}).textContent || '').trim().length > 0)`,
      );
      assert.equal(ok, true, 'expected every card to contain a non-empty <p> body');
    },
  },

  // ── Responsive layout ─────────────────────────────────────────────────────
  {
    name: 'has no horizontal overflow across a viewport matrix',
    async check(driver, { baseURL }) {
      const widths = [320, 375, 768, 1024, 1440];
      try {
        for (const width of widths) {
          await driver.setViewport(width, 900);
          await driver.goto(baseURL);
          const overflow = Number(
            await driver.evaluate(
              'document.documentElement.scrollWidth - document.documentElement.clientWidth',
            ),
          );
          assert.ok(overflow <= 1, `expected no horizontal overflow at ${width}px, got ${overflow}px`);
        }
      } finally {
        await driver.setViewport(1280, 800);
      }
    },
  },
  {
    name: 'feature cards stack into one column on a narrow viewport',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      if ((await driver.count('.card')) < 2) return false;
      // Selenium sizes the OS window (headless Chrome clamps to ~500px wide), so
      // it cannot produce the sub-400px viewport a single-column reflow needs.
      // Gate on the viewport the driver can actually deliver instead of branching
      // on driver.name.
      try {
        await driver.setViewport(360, 900);
        await driver.goto(baseURL);
        return Number(await driver.evaluate('window.innerWidth')) <= 400;
      } finally {
        await driver.setViewport(1280, 800);
      }
    },
    async check(driver, { baseURL }) {
      try {
        await driver.setViewport(360, 900);
        await driver.goto(baseURL);
        const stacked = await driver.evaluate(
          `(() => {
            const cards = Array.from(document.querySelectorAll('.card'));
            const a = cards[0].getBoundingClientRect();
            const b = cards[1].getBoundingClientRect();
            return b.top >= a.bottom - 1;
          })()`,
        );
        assert.equal(stacked, true, 'expected the second card to sit below the first on a narrow screen');
      } finally {
        await driver.setViewport(1280, 800);
      }
    },
  },

  // ── Interaction: health + filtering (fixture-only) ────────────────────────
  {
    name: 'resetting returns the health status to idle',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="reset"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      await driver.click('[data-testid="ping"]');
      await driver.waitForText('[data-testid="status"]', 'ok');
      await driver.click('[data-testid="reset"]');
      await driver.waitForText('[data-testid="status"]', 'idle');
      assert.equal(await driver.text('[data-testid="status"]'), 'idle');
    },
  },
  {
    name: 'filtering features narrows the visible cards',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="filter"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      // fill() dispatches the input events synchronously, so the client-side
      // filter has already run by the time it resolves — assert the resulting
      // DOM directly rather than waiting on the <output>'s rendered text, which
      // Selenium's getText() does not always report for form-associated elements.
      const visibleCards = `Array.from(document.querySelectorAll('.card')).filter((c) => !c.hidden).length`;
      assert.equal(Number(await driver.evaluate(visibleCards)), 4, 'expected all four cards visible initially');
      await driver.fill('[data-testid="filter"]', 'sync');
      assert.equal(Number(await driver.evaluate(visibleCards)), 1, 'expected one card matching "sync"');
      await driver.fill('[data-testid="filter"]', '');
      assert.equal(Number(await driver.evaluate(visibleCards)), 4, 'expected all cards visible after clearing');
    },
  },
  {
    name: 'submitting the filter form does not navigate away',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="filter"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const before = String(await driver.evaluate('location.href'));
      await driver.fill('[data-testid="filter"]', 'core');
      await driver.press('[data-testid="filter"]', 'Enter');
      const after = String(await driver.evaluate('location.href'));
      assert.equal(after, before, 'expected submitting the filter to stay on the same URL');
      assert.match(await driver.title(), new RegExp(PRODUCT_NAME, 'i'));
    },
  },
  {
    name: 'the filter input is keyboard focusable',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="filter"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const focused = await driver.evaluate(
        `(() => {
          const el = document.querySelector('[data-testid="filter"]');
          el.focus();
          return document.activeElement === el;
        })()`,
      );
      assert.equal(focused, true, 'expected the filter input to accept keyboard focus');
    },
  },

  // ── Multi-route navigation (fixture-only) ─────────────────────────────────
  {
    name: 'the primary navigation links home and to the ledger',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="nav-ledger"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const ledgerHref = String(await driver.attribute('[data-testid="nav-ledger"]', 'href'));
      const homeHref = String(await driver.attribute('[data-testid="nav-home"]', 'href'));
      assert.match(ledgerHref, /ledger\.html$/, `unexpected nav-ledger href: ${ledgerHref}`);
      assert.match(homeHref, /index\.html$/, `unexpected nav-home href: ${homeHref}`);
    },
  },
  {
    name: 'marks the current page in the navigation',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="nav-home"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const current = await driver.attribute('[data-testid="nav-home"]', 'aria-current');
      assert.equal(current, 'page', 'expected the home link to be aria-current="page" on the home page');
    },
  },
  {
    name: 'the ledger page renders its own document',
    async applicable(driver, { baseURL }) {
      // Only the bundled fixture ships a second page; the deployed site does not.
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="nav-ledger"]')) > 0;
    },
    async check(driver, { baseURL }) {
      const ledgerURL = new URL('ledger.html', baseURL).href;
      try {
        await driver.goto(ledgerURL);
        assert.match(await driver.text('h1'), /Ledger/i);
        assert.match(await driver.title(), /Ledger/i);
        const lang = await driver.attribute('html', 'lang');
        assert.ok(lang && lang.trim().length > 0, 'expected the ledger page to declare a language');
        assert.ok(
          (await driver.count('table[data-testid="entries"] tbody tr')) >= 2,
          'expected the ledger page to list entries',
        );
      } finally {
        await driver.goto(baseURL);
      }
    },
  },
  {
    name: 'browser history back and forward move between pages',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="nav-ledger"]')) > 0;
    },
    async check(driver, { baseURL }) {
      const ledgerURL = new URL('ledger.html', baseURL).href;
      try {
        await driver.goto(baseURL);
        assert.equal(await driver.text('h1'), 'Quaestor Ledger');
        await driver.goto(ledgerURL);
        assert.equal(await driver.text('h1'), 'Ledger');
        await driver.back();
        assert.equal(await driver.text('h1'), 'Quaestor Ledger', 'expected back() to return home');
        await driver.forward();
        assert.equal(await driver.text('h1'), 'Ledger', 'expected forward() to return to the ledger');
      } finally {
        await driver.goto(baseURL);
      }
    },
  },

  // ── Ledger accounting journeys (fixture UI, all three real browser drivers) ──
  {
    name: 'the ledger table balances every entry across debits and credits',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="nav-ledger"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(new URL('ledger.html', baseURL).href);
      const rows = await driver.evaluate(`Array.from(
        document.querySelectorAll('[data-testid="entries"] tbody tr'),
        row => Array.from(row.querySelectorAll('td'), cell => cell.textContent.trim())
      )`);
      assert.ok(rows.length >= 4, 'the fixture must exercise at least two balanced journal entries');
      const totals = new Map();
      for (const cells of rows) {
        assert.equal(cells.length, 4, 'each journal row has entry, account, debit, credit');
        const amount = (value) => /[0-9]/.test(value)
          ? Number(value.replace(/,/g, '')) : 0;
        const debit = amount(cells[2]);
        const credit = amount(cells[3]);
        assert.ok(Number.isFinite(debit) && Number.isFinite(credit));
        assert.ok(debit >= 0 && credit >= 0);
        assert.notEqual(debit > 0, credit > 0,
          `one and only one side must be populated for ${cells[0]} / ${cells[1]}`);
        const current = totals.get(cells[0]) ?? { debit: 0, credit: 0, rows: 0 };
        current.debit += Math.round(debit * 100);
        current.credit += Math.round(credit * 100);
        current.rows += 1;
        totals.set(cells[0], current);
      }
      assert.ok(totals.size >= 2, 'test multiple distinct journal entries');
      for (const [entry, value] of totals) {
        assert.ok(value.rows >= 2, `entry ${entry} must have opposing journal legs`);
        assert.equal(value.debit, value.credit,
          `entry ${entry} has unbalanced journal amounts in cents`);
      }
    },
  },
  {
    name: 'keyboard navigation reaches the ledger through its real link',
    async applicable(driver, { baseURL }) {
      await driver.goto(baseURL);
      return (await driver.count('[data-testid="nav-ledger"]')) > 0;
    },
    async check(driver, { baseURL }) {
      await driver.goto(baseURL);
      const focused = await driver.evaluate(`(() => {
        const link = document.querySelector('[data-testid="nav-ledger"]');
        link.focus();
        return document.activeElement === link;
      })()`);
      assert.equal(focused, true, 'the ledger link must be keyboard-focusable');
      await driver.press('[data-testid="nav-ledger"]', 'Enter');
      assert.match(await driver.text('h1'), /ledger/i);
      const pathname = await driver.evaluate('location.pathname');
      assert.match(String(pathname), /\/ledger\.html$/i);
    },
  },
];
