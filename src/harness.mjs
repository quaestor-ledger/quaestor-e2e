import test from 'node:test';

import { externalBaseURL, seleniumRemoteURL } from './config.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { scenarios } from '../scenarios/index.mjs';

/**
 * Resolves the target under test. When E2E_BASE_URL is set we test it directly;
 * otherwise we boot the bundled fixture site and tear it down afterwards.
 */
export async function resolveTarget() {
  if (externalBaseURL) {
    return { baseURL: externalBaseURL, async close() {} };
  }
  // A browser hosted by Selenium Grid runs outside this process's network
  // namespace. Listen on the runner/host interface in that case, while the
  // fixture server continues to advertise a loopback URL for local drivers.
  // seleniumTargetURL() rewrites that advertised host for the remote browser.
  const fixture = await startFixtureServer({
    host: seleniumRemoteURL ? '0.0.0.0' : '127.0.0.1',
  });
  return {
    baseURL: fixture.baseURL,
    listenAddress: fixture.listenAddress,
    close: fixture.close,
  };
}

/**
 * Registers the shared scenario set as node:test cases for one driver.
 * A single driver session (browser) is shared across scenarios and torn down at
 * the end. If the driver cannot start (no browser/Grid), the whole suite is
 * skipped with the reason rather than hard-failing unrelated drivers.
 */
export function defineDriverSuite(driverName, createDriver, { skip } = {}) {
  test(`${driverName} e2e scenarios`, async (t) => {
    if (skip) {
      t.skip(skip);
      return;
    }

    const target = await resolveTarget();
    let driver;
    try {
      driver = await createDriver();
    } catch (error) {
      await target.close();
      t.skip(`${driverName} driver unavailable: ${error?.message ?? error}`);
      return;
    }

    try {
      for (const scenario of scenarios) {
        await t.test(scenario.name, async (subtest) => {
          const context = { baseURL: target.baseURL };
          if (scenario.applicable && !(await scenario.applicable(driver, context))) {
            subtest.skip('not applicable to this target');
            return;
          }
          await scenario.check(driver, context);
        });
      }
    } finally {
      await driver.close().catch(() => {});
      await target.close();
    }
  });
}
