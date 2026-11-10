# Scheduled checkpoint-recovery observer

`verify-agent-durable-scheduled-recovery.ts` observes a preseeded checkpointed
background run while the deployed platform schedule runs on its normal cadence.
The observer uses read-only PostgreSQL transactions and sends no request to the
app, browser, Netlify function, or scheduler. It does not trigger a wake.

The existing `verify-agent-durable-stale-run.ts` remains a separate **manual
signed-reap probe**. It posts a signed full sweep and proves stale terminal
reaping only. Do not cite its result as independent scheduler or continuation
recovery evidence.

## Preconditions

- Use a disposable `beta.*.agent-native.com` site and isolated database with no
  user or automation traffic. During the observation window, no one may manually
  call the signed sweep or browse/send chat. The schedule must be the only sweep
  source during the window.
- Seed a single background run whose original worker has died after persisting
  one `auto_continue` checkpoint with reason `run_timeout`. The run must be at
  least 90 seconds past heartbeat and progress, have no live execution lease,
  and have no successor yet. Its dispatch prompt must ask the recovered agent to
  emit a unique marker passed as `--expected-marker`.
- Record the matching successful Beta Actions deployment ID and full commit SHA.
  Provide the canary database URL. No `A2A_SECRET` is needed by this observer.
- Preserve separate PostgreSQL process-loss proof: the focused fencing
  integration test runs the recovered production loop after checkpoint reaping
  and verifies its durable side-effect counter is exactly one. The deployed
  observer checks continuation events and duplicate terminal/marker events; it
  does not instrument an app-specific external effect.

The database health row does not store the invoking platform request ID. The
observer labels provenance as a scheduled window only because it sends no app
request and requires the operator to attest that the isolated window had no
manual wake or browser traffic. If that assertion cannot be made, the result is
not independent scheduler evidence.

## Run

```sh
AGENT_DURABLE_STALE_CANARY_DATABASE_URL="$CANARY_DATABASE_URL" \
  pnpm exec tsx scripts/verify-agent-durable-scheduled-recovery.ts \
    --observe-scheduled-recovery --confirm-isolated-beta \
    --confirm-no-manual-wake \
    --site https://beta.<app>.agent-native.com --app-id <deployed-app-id> \
    --run-id agent-durability-canary-<id> \
    --thread-id <thread-id> --turn-id <turn-id> \
    --expected-marker durability-result-<unique-id> \
    --deployment-id <actions-deploy-id> \
    --deployment-sha <full-commit-sha>
```

Success requires the naturally scheduled sweep to advance scheduler health,
truncate the checkpointed predecessor with `run_timeout`, create exactly one
internal-continuation successor, and complete that successor with one terminal
event and exactly one event containing the expected marker. The evidence is
written under `.tmp/`; it contains IDs, timestamps, statuses, counts, deployment
identity, and the fact that the verifier sent zero HTTP requests. It excludes
secrets, prompts, and thread content.
