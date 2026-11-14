# Manual signed stale-run reap probe

`verify-agent-durable-stale-run.ts` is a **manual signed-reap probe**. It verifies
that an explicitly triggered Netlify background function can run the signed
recurring-jobs sweep and reap one deliberately stale Agent-Native run. It does
not prove an independent platform schedule invocation or recover a continuation.
The script observes rows in a read-only PostgreSQL transaction; it never seeds,
updates, or deletes database rows. For independent scheduled checkpoint recovery,
use `verify-agent-durable-scheduled-recovery.ts` instead.

## Preconditions

- Use a disposable `beta.*.agent-native.com` site and its isolated test database.
  The signed endpoint runs the complete recurring-jobs sweep, which can dispatch
  due user automations and recover other stale work. Do not point it at a shared
  Beta site unless its owner has confirmed the full sweep is safe there.
- Seed one canary run through the isolated harness fixture before running the
  script. The run ID must start with `agent-durability-canary-`; the matching
  thread must contain a user message stamped with the same `submittedTurnId`.
- The run must be `running`, `dispatch_mode = 'background'`, at least 90 seconds
  past both its latest heartbeat and progress, with no in-flight tool, no
  dispatch payload, no worker generation, no live execution lease, no terminal
  event, and no other run for the same turn. These constraints keep the probe
  from redispatching work and make its expected result unambiguous.
- Record the deploy ID and full commit SHA from the matching successful Beta
  publication. Provide the target site's canary database URL and the deployed
  `A2A_SECRET` through the process environment. The script never prints either.

## Run

```sh
AGENT_DURABLE_STALE_CANARY_DATABASE_URL="$CANARY_DATABASE_URL" \
  A2A_SECRET="$BETA_A2A_SECRET" \
  pnpm exec tsx scripts/verify-agent-durable-stale-run.ts \
    --execute --confirm-full-sweep --confirm-isolated-beta \
    --site https://beta.<app>.agent-native.com \
    --run-id agent-durability-canary-<id> \
    --thread-id <thread-id> --turn-id <turn-id> \
    --deployment-id <actions-deploy-id> \
    --deployment-sha <full-commit-sha>
```

The script posts a short-lived HMAC token for
`agent-native-recurring-jobs-sweep` to the Netlify background function with the
`/_agent-native/jobs/_process-sweep` route marker. Calling that route directly
on the synchronous Netlify server is rejected, so the background function path
is part of the canary.

Success requires the background request to return 202, a scheduler-health check
after the request with no recorded error, exactly one `stale_run` terminal
event, the run row finalized as `errored` with `error:stale_run`, one run total
for the turn, and the thread projection to contain that run and the same error.
The evidence JSON is written under `.tmp/` and includes deployment identity,
canary IDs, timestamps, and outcome counts. It excludes secrets and thread
content.

The fixture seeding step is intentionally separate from this verifier. Do not
run this against a non-isolated production database or treat a scheduler-health
tick by itself as proof that the stale run was reaped.
