# @quaestor-ledger/e2e

Cross-driver end-to-end tests for Quaestor Ledger web surfaces. One shared
scenario set runs identically across **Playwright**, **Puppeteer**, and
**Selenium**, so a UI regression is caught the same way regardless of driver and
any cross-driver behavioural gap surfaces as a single failing driver.

Playwright drives three **engines** from the same scenarios — **Chromium**,
**Firefox** (Gecko), and **WebKit** — so the suite is cross-browser as well as
cross-driver. Firefox/WebKit suites skip cleanly when their binaries are not
installed (`npm run browsers:install` fetches all three).

```
scenarios/index.mjs             one canonical scenario set (driver-agnostic)
src/drivers/                    playwright.mjs · puppeteer.mjs · selenium.mjs adapters
src/harness.mjs                 resolves the target, runs the scenarios per driver
src/fixture-server.mjs          bundled Quaestor-shaped fixture site
fixtures/site/                  the fixture HTML
tests/contract.test.mjs         browser-free HTML contract smoke
tests/browser/playwright/       Playwright suite
tests/browser/puppeteer/        Puppeteer suite
tests/browser/selenium/         Selenium suite (local chromedriver or remote Grid)
```

Each driver lives in its own folder under `tests/browser/`, so driver-specific
cases can be added beside the shared `scenarios.test.mjs` without touching the
other drivers. `npm test` runs the suites sequentially (browsers are heavy and
a Grid caps concurrent sessions).

## Quick start

```bash
npm install                 # also runs `playwright install chromium firefox webkit`
npm run test:contract       # browser-free HTML smoke (no browsers needed)
npm run test:playwright     # Playwright: Chromium + Firefox + WebKit
npm run test:firefox        # just the Firefox (Gecko) engine
npm run test:webkit         # just the WebKit engine
npm run test:puppeteer      # Puppeteer vs the bundled fixture

# Selenium needs a Grid — start the local one (same image as the cluster):
npm run selenium:up
SELENIUM_REMOTE_URL=http://localhost:4444 npm run test:selenium
npm run selenium:down
```

`npm test` runs all four suites. With no Grid configured, the Selenium suite
**skips** with a reason instead of failing, so the others still gate cleanly.

## Choosing the target

By default the suites boot the bundled fixture site (`fixtures/site/`) on an
ephemeral localhost port. Point them at a real surface with `E2E_BASE_URL`:

```bash
E2E_BASE_URL=https://quaestor-ledger.github.io npm run test:playwright
E2E_BASE_URL=http://127.0.0.1:4321 npm test        # local Astro preview of the site repo
E2E_BASE_URL=http://127.0.0.1:8080 npm test        # local quaestor-web-server.rs
```

The fixture mirrors the site's contract (title, `h1` naming the product, ≥4
`.card` features, footer link to the GitHub org, error-free console), so the
same scenarios pass against the fixture and the real site.

## Selenium: local Grid or the cluster Grid

The Selenium adapter drives a **remote Grid** whenever `SELENIUM_REMOTE_URL` is
set (otherwise Selenium Manager resolves a local chromedriver).

**Local Grid** (mirrors the cluster's `selenium/standalone-chromium:4.27.0`):

```bash
npm run selenium:up      # docker compose up, waits for the Grid to be ready
# watch the browser live at http://localhost:7900 (noVNC)
```

**Cluster Grid** — the `dd-selenium-server` in `~/codes/ores/k8s-cluster`. Its
Service publishes only the authenticated Java API on `:8105`; the Grid on
`:4444` is pod-internal by design. `kubectl port-forward` targets the pod, so it
can still reach the Grid for local, kubeconfig-authenticated development:

```bash
npm run selenium:cluster    # kubectl port-forward deploy/dd-selenium-server 4444:4444
# then, in another shell:
SELENIUM_REMOTE_URL=http://localhost:4444 npm run test:selenium
```

When driving a remote Grid against a **localhost** fixture, the browser runs in
a container and cannot resolve the host's `localhost`; the adapter rewrites the
base URL host to `host.docker.internal` (override with `SELENIUM_BROWSER_HOST`).

> **Docker Desktop on macOS:** the Chromium image resolves `host.docker.internal`
> via `/etc/hosts`, but the browser's own DNS resolver can still report
> `ERR_NAME_NOT_RESOLVED` for it. If the whole Selenium suite fails at navigation,
> pass the gateway IP directly — find it with
> `docker exec <grid-container> getent hosts host.docker.internal` (typically
> `192.168.65.254`) and run with `SELENIUM_BROWSER_HOST=192.168.65.254`. In CI,
> the Grid service receives an explicit `host.docker.internal:host-gateway`
> mapping and the fixture listens on the runner interface.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_BASE_URL` | bundled fixture | Target under test. |
| `SELENIUM_REMOTE_URL` | (local driver) | Remote Grid for the Selenium suite. |
| `SELENIUM_BROWSER_HOST` | `host.docker.internal` | Host a remote browser uses to reach a localhost fixture. |
| `E2E_HEADED` | (headless) | Run browsers headed for debugging. |
| `E2E_NAV_TIMEOUT_MS` | `30000` | Navigation / wait timeout. |

## Adding a scenario

Add one entry to `scenarios/index.mjs`. It runs on all three drivers
automatically — write it once against the driver interface documented in
[`src/drivers/interface.md`](src/drivers/interface.md); do not branch on
`driver.name`. See [docs/writing-scenarios.md](docs/writing-scenarios.md) for the
full guide.

## Documentation

In-depth docs live in [`docs/`](docs/): architecture, writing scenarios,
the cross-browser/cross-driver matrix and its normalisations, running against the
remote cluster Grids (AWS / Hetzner), and the coverage catalogue.
