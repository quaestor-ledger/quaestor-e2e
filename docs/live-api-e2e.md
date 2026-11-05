# Live client → API end-to-end validation

The default `npm test` targets the bundled public/marketing fixture and
browser drivers. It does **not** prove ledger API isolation.

Run the separate strict live service suite against an isolated deployment
with two distinct user sessions and at least one pre-seeded account owned by A:

```sh
export QUAESTOR_E2E_NONPROD=1
export QUAESTOR_E2E_API_URL=https://your-isolated-test-environment.example
export QUAESTOR_E2E_OWNER_TOKEN=...
export QUAESTOR_E2E_OTHER_TOKEN=...
export QUAESTOR_E2E_OWNER_ACCOUNT_ID=...
npm run test:live-api
```

This suite performs only GET requests. It verifies authentication rejection,
owner-scoped account listing and detail access, 404 on cross-owner reads,
journal entry/account consistency, exact string-based money serialization,
sync cursor parsing, and redirect refusal. Its target must be HTTPS except
for loopback HTTP. Missing fixture configuration **fails** the test; the
fixture landing-page server is never substituted, and nothing silently skips.

Use ephemeral, non-production credentials and fixture records. Do not point
the test at a production environment or commit secrets to the repository.
CI should provision an isolated service stack, pass credentials through
runtime-only secret injection, and check that the test job executed steps
before treating it as end-to-end evidence.
