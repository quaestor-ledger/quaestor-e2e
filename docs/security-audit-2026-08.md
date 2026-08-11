# Security audit — August 2026

This repository is the public, credential-free browser and integration harness for the private Quaestor Ledger production repositories.

## Trust boundaries

- Pull-request jobs may validate only repository-local fixtures, contracts, and browser scenarios.
- Private cross-repository source and `SYNC_FLEET_TOKEN` are available only to explicitly dispatched live certification jobs.
- Checkout credentials are never persisted into later test or package-manager steps.
- Third-party actions and reusable workflows are pinned by immutable commit SHA.
- npm lifecycle scripts are disabled in supply-chain and browser-matrix installs; explicit browser installation remains a reviewed workflow step.

## Dependency remediation

The August audit identified a high-severity transitive `js-yaml` advisory through Puppeteer's former `cosmiconfig` dependency. The browser harness now pins Puppeteer `25.1.0`, whose generated lock uses `lilconfig` and contains neither `cosmiconfig` nor `js-yaml`.

The lock was generated on Node.js 22.12.0 with lifecycle scripts disabled, followed by:

```text
npm ci --ignore-scripts
npm audit --audit-level=high
npm run test:contract
```

The normal pull-request matrix remains responsible for Playwright Chromium/Firefox/WebKit, Puppeteer Chromium, Selenium, contract, and npm-audit evidence on the exact reviewed revision.

Tracking: DEN-3479, DEN-626, DEN-1539.
