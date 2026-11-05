// Real loopback HTTP coverage for the bundled Quaestor ledger fixture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startFixtureServer } from '../src/fixture-server.mjs';

function cents(value) {
  const normalized = value.trim();
  if (normalized === '—') return 0;
  assert.match(normalized, /^\d{1,3}(?:,\d{3})*\.\d{2}$/);
  const [whole, fractional] = normalized.replaceAll(',', '').split('.');
  return Number(whole) * 100 + Number(fractional);
}

function entriesFromHtml(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
  assert.ok(body, 'ledger response must contain a table body');
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((row) => {
    const cells = [...row[1].matchAll(/<td(?:\s+[^>]*)?>([\s\S]*?)<\/td>/gi)]
      .map((cell) => cell[1].trim());
    assert.equal(cells.length, 4, 'each journal row must expose entry, account, debit and credit');
    return { entry: cells[0], account: cells[1], debit: cents(cells[2]), credit: cents(cells[3]) };
  });
}

test('ledger GET serves balanced journal entries over real loopback HTTP', { timeout: 10_000 }, async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  const response = await fetch(new URL('/ledger.html', fixture.baseURL), {
    signal: AbortSignal.timeout(3_000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/i);
  const entries = entriesFromHtml(await response.text());
  assert.equal(entries.length, 4);
  const byEntry = new Map();
  for (const item of entries) {
    assert.ok(item.account, 'journal row must identify an account');
    assert.ok(item.debit === 0 || item.credit === 0, 'a row cannot both debit and credit');
    const prior = byEntry.get(item.entry) ?? { debit: 0, credit: 0, rows: 0 };
    prior.debit += item.debit;
    prior.credit += item.credit;
    prior.rows += 1;
    byEntry.set(item.entry, prior);
  }
  assert.equal(byEntry.size, 2);
  for (const [entry, totals] of byEntry) {
    assert.equal(totals.rows, 2, entry + ': expected both sides of the entry');
    assert.ok(totals.debit > 0, entry + ': expected a nonzero posting');
    assert.equal(totals.debit, totals.credit, entry + ': unbalanced journal entry');
  }
  assert.equal(entries.reduce((sum, row) => sum + row.debit, 0), 125_000);
});

test('parallel clients receive complete, isolated ledger documents', { timeout: 10_000 }, async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  const urls = Array.from({ length: 12 }, (_, i) =>
    new URL(i % 2 ? '/ledger.html?view=recent' : '/ledger.html', fixture.baseURL));
  const documents = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    assert.equal(response.status, 200);
    return response.text();
  }));
  assert.ok(documents.every((html) => html === documents[0]));
  assert.ok(documents.every((html) => entriesFromHtml(html).length === 4));
});
