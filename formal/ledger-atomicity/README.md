# Bounded atomic ledger and idempotency model

`model.cjs` explores two transfer identities, one source account (2 integer units), one destination account, a separate tenant balance, two amounts, acknowledgement, lost responses, retries, insufficient funds and cancellation.

Within this finite abstraction:
- debit and credit are one indivisible state transition; total within tenant one is conserved;
- tenant two funds are never accessed;
- retrying a committed transaction identity cannot move funds again;
- insufficient funds cannot be debited;
- acknowledgement requires a committed transfer; losing its response cannot undo it.

The model requires both committed transfers, duplicate denial, insufficient-funds rejection, tenant isolation, lost response, and cancellation witnesses. Three mutated states must be rejected.

**Not established:** monetary arithmetic precision, database serializability, actual double-entry SQL constraints, real RLS, distributed failure recovery, PostgreSQL/CockroachDB parity, browser/client E2E or implementation equivalence. Run model with `node formal/ledger-atomicity/model.cjs`. Next, replay deterministic schedules against real services and databases with exact-head, stepful receipts and independent review.
