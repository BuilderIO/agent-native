# Analytics 2 Phase 1 evidence

Run from the repository root against a served build in a dedicated QA workspace. The base URL includes the app's mount.

```sh
node --import tsx templates/analytics-2/e2e/core-flows.ts phase1 \
  --base-url "$ANALYTICS_BASE_URL" --expected-sha "$ANALYTICS_BUILD_SHA" \
  --flows all --evidence-dir .tmp/analytics-2-phase1 \
  --storage-state "$ANALYTICS_OWNER_STATE"
```

Chromium must be available to Playwright. Supply `--browser-executable` for an existing Chromium installation. Use a comma-separated list of two-digit or full flow IDs for a focused run. For role checks, pass `--colleague-storage-state` for a second member in the same workspace and `--denied-storage-state` for a member of a different workspace. The default local daily harness at `127.0.0.1:8105` can supply the owner session when its descriptor is available. Keep storage state files outside the evidence directory.

Every run reads the app's `agent-native-app-source-sha` document marker from the mounted `/home` response. The build stamps it with the checkout's `git rev-parse HEAD`, so build from the candidate commit.

Each run creates a new evidence directory with `evidence.jsonl` and screenshots. Rows include the expected SHA, both served SHA observations, the observed case outcome, the final verdict, timings, opaque IDs, action statuses, and screenshot filenames relative to the run directory. Exit 0 means every selected case passed. Exit 1 means a case failed. Exit 2 means the command or at least one case could not run. The runner leaves uniquely named QA project records available for follow-up readback.

## External fixtures

- For signed-in BigQuery, supply `--bq-key-file` with the service-account JSON path. The key contents stay out of runner logs and evidence. If provisioning is needed, apply [the US seed](bigquery-us.sql) with `bq query --location=US --use_legacy_sql=false` and [the east seed](bigquery-east.sql) with `bq query --location=us-east1 --use_legacy_sql=false`. The fixtures create missing tables and preserve existing tables. Run the SQL only against the authorized QA project. Give that service account BigQuery Data Viewer access on both regional catalog datasets (`a2_parity_q_us`, `a2_parity_q_east`) in addition to the ordinary warehouse test datasets.
- Pass `--expected-kernel-digest development` for a loopback app using the native kernel started with `--dev`. Start the gateway from the candidate worktree after updating its source. The build action verifies that the configured loopback gateways report `development` as both the SHA and digest at `/healthz`. Evidence records `dev-attested`. For hosted runs, pass `--expected-kernel-digest sha256:…` using the serving kernel image digest.
- Flow 01's Storage and catalog faults use the signed-in provider and worker fixtures below. When the served app uses the daily fake provider, pass its origin with `--provider-fixture-url` instead. The scoped entitlement fixture changes real group membership for Flows 04, 05, 11 and 14.
- The worker fixture below controls held completions and partial results in draft execution for Flows 04, 05 and 12, and holds a candidate completion for Flow 13. The runner records a case as unavailable when a required fixture is missing. Deterministic model cases use the fixture below.

### Local model for flows 13 and 14

Start a fresh scripted Anthropic Messages process from the candidate checkout’s repository root for each served build. The process keeps the script it loaded at startup across branch switches, rebuilds, and database resets.

```sh
node --import tsx templates/analytics-2/e2e/phase1/fixtures/model.ts
```

Start the compiled Analytics app with its usual loopback auth, database, and build SHA settings. Give the server these environment variables. They also work with the loopback worker launcher below.

```sh
export AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT=local
export NITRO_HOST=127.0.0.1
export AGENT_ENGINE=anthropic
export AGENT_ENGINE_PREFER_BYO_KEY=true
export AGENT_MODEL=claude-sonnet-5-5
export ANTHROPIC_API_KEY=local-fake-provider-key
export ANTHROPIC_BASE_URL=http://127.0.0.1:4413
```

Use an isolated local database and owner account without saved model credentials. The Anthropic SDK uses this endpoint when it selects the deployment's own fixture key. Check `/_agent-native/agent-engine/status` with the owner's signed-in session. The runner requires `chatEligible: true`, which core derives from a usable scoped or deployment provider credential, a configured compatible endpoint, or a supported signed-in model account. Setting `AGENT_ENGINE` alone leaves this gate closed.

Run the command above with `--flows 13,14`, the owner state and the two role states. The fixture supplies model decisions while the app admits actual core turns and runs its tools. Flow 14 uses the dedicated warehouse connection, a one-shot CSV storage fault, and a prompt-scoped readiness switch. Start the local worker launcher for both fault controls. The optional model control address sends the readiness switch through the model fixture at `http://127.0.0.1:4414/phase1/model-control`.

### Local worker and warehouse entitlement

Use the same local auth, database, kernel and port settings as the production build's normal launch. Run the following from the repo root **in place of** the app's normal `.output/server/index.mjs` command. Set `AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT=local` and `AGENT_NATIVE_BUILD_SHA` when building as well.

```sh
NODE_ENV=production AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT=local NITRO_HOST=127.0.0.1 AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS=1 AGENT_NATIVE_BUILD_SHA="$ANALYTICS_BUILD_SHA" PORT=4400 \
  node --import tsx templates/analytics-2/e2e/phase1/fixtures/worker.ts
```

The launcher serves the built app on loopback and `POST /phase1/worker-control` on `http://127.0.0.1:4412`. It disables in-process background sweeps and manually invokes the registered scheduler for the fixture project. That project's synthetic clock, held SQL, fault and local-only email delivery exercise the actual notebook worker and durable schedule records. Use a `@local.test` colleague for the mail sink. The same control server can hold one draft attempt at dispatch or promotion, hold one thread candidate at promotion, or mark one warehouse result incomplete. Each control is scoped to the fixture project and cell. Keep the worker running for upload readback because its loopback store holds encrypted fixture artifacts in memory.

In a second terminal, start the provider fixture with the QA owner session and the same BigQuery key file as the runner.

```sh
node --import tsx templates/analytics-2/e2e/phase1/fixtures/provider.ts \
  --base-url http://localhost:4400 --storage-state "$ANALYTICS_OWNER_STATE" \
  --bq-key-file "$ANALYTICS_BQ_KEY_FILE"
```

The provider exposes `POST /phase1/provider-control` on `http://127.0.0.1:4411`. It provisions a dedicated BigQuery connection and group, revokes and restores the colleague's membership in that group, and leaves the warehouse connection and its generation intact for result readback. For Flow 01 it directs the local worker to fail one Storage read and inject failed or empty catalog responses on the connection created by that run. BigQuery submission and REST recovery use the real provider.

Add these flags to the runner command for the local kernel, draft execution, entitlement and scheduler cases. Include `--colleague-storage-state` and `--bq-key-file` for the scoped entitlement cases.

```sh
--expected-kernel-digest development \
--provider-fixture-url http://127.0.0.1:4411 \
--worker-fixture-url http://127.0.0.1:4412 \\
--model-fixture-url http://127.0.0.1:4414
```

## Sandbox self-tests

```sh
node --import tsx --test \
  templates/analytics-2/e2e/build-boundary.test.ts \
  templates/analytics-2/e2e/build-verdict.test.ts \
  templates/analytics-2/e2e/phase1/verdict.test.ts \
  templates/analytics-2/e2e/local/storage-fault.test.ts
```
