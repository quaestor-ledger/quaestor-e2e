// Central environment resolution shared by every driver and test suite.

const truthy = (value) => value !== undefined && !['0', 'false', 'no', 'off', ''].includes(String(value).toLowerCase());

/** External target under test, or null when the bundled fixture site should be booted. */
export const externalBaseURL = process.env.E2E_BASE_URL?.trim() || null;

/** Remote Selenium Grid URL (RemoteWebDriver). Null runs a local chromedriver. */
export const seleniumRemoteURL = process.env.SELENIUM_REMOTE_URL?.trim() || null;

/** Hostname a containerized/remote browser uses to reach a localhost fixture. */
export const seleniumBrowserHost = process.env.SELENIUM_BROWSER_HOST?.trim() || 'host.docker.internal';

export const headed = truthy(process.env.E2E_HEADED);

/** Strict bounded decimal milliseconds: prevent NaN, negative, or huge CI waits. */
export function resolveNavigationTimeoutMs(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 30_000;
  const encoded = String(raw).trim();
  if (!/^[1-9][0-9]*$/.test(encoded)) {
    throw new RangeError('E2E_NAV_TIMEOUT_MS must be a positive decimal integer');
  }
  const timeout = Number(encoded);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300_000) {
    throw new RangeError('E2E_NAV_TIMEOUT_MS must be within 100..300000 ms');
  }
  return timeout;
}

export const navigationTimeoutMs = resolveNavigationTimeoutMs(process.env.E2E_NAV_TIMEOUT_MS);

/**
 * A localhost Grid (Docker/k8s) cannot resolve the host's own `localhost`, so
 * when driving a remote Selenium session we rewrite a localhost base URL to a
 * host the browser container can reach. External URLs are returned untouched.
 */
export function seleniumTargetURL(baseURL) {
  if (!seleniumRemoteURL) {
    return baseURL;
  }
  try {
    const url = new URL(baseURL);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.hostname = seleniumBrowserHost;
      return url.toString();
    }
  } catch {
    // Fall through and return the original string.
  }
  return baseURL;
}
