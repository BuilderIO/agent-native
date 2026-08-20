# @agent-native/core

## 0.165.2

### Patch Changes

- b130f4e: Keep app changelogs compact while preserving folder-backed history in the in-app What's new surface.
- ac3acfa: Improve provider failure recovery and remove the retired Videos template from Dispatch app creation.

## 0.165.1

### Patch Changes

- 43ef3a8: Fix reconnecting existing OAuth-backed MCP servers in place.

## 0.165.0

### Minor Changes

- b39f22c: Stop regex lookaround from 400ing the whole model turn, and give three
  always-on core kits a `frameworkTools` switch.
  - `stripUnsupportedSchemaKeywords` now drops a `pattern` containing lookaround
    (`(?=`, `(?!`, `(?<=`, `(?<!`). Anthropic rejects it with "regex lookaround is
    not supported" and rejects the entire request, so one such tool takes every
    other tool in the payload down with it — visible as an error in chat, and as
    nothing at all in a background run. `z.string().email()` compiles to two
    negative lookaheads and appears in ~35 action schemas, so this is answered at
    the boundary every tool passes through, alongside the existing typeless-schema
    and unsupported-`format` rewrites. The action's own zod schema still validates
    the value, so nothing that was enforced is loosened.
  - `emailCatalog`, `workspaceUserGroups`, and `orgServiceTokens` are new
    `frameworkTools` groups covering twelve actions that previously had no switch.
    All three default to on, so the available surface is unchanged — but they are
    now tagged, which takes them out of every app's default first-request tool
    list and leaves them reachable through `tool-search`.
  - `mcp.catalog: "app"` alongside `mcp.connectorCatalog` now throws at plugin
    init. `catalog: "app"` short-circuits the connector tier, so the two together
    served the app's full registry while the allow-list sat in the config looking
    authoritative.

### Patch Changes

- 483f03d: Stop the run-level no-progress backstop from killing runs while the model is
  still generating. Two watchdogs guarded the same silence on different clocks:
  the agent loop's `lastModelStreamProgressAt` bumps on every engine frame, while
  the run manager's backstop only sees events the loop forwards. Extended thinking
  produces the first without the second, so the 150s bound sat inside the working
  distribution — runs whose worst gap crossed it were checkpointed as
  `auto_continue { reason: "no_progress" }` and recorded as errors while still
  streaming, some missing by a single second, and background automations discarded
  results the agent went on to finish minutes later.

  The agent loop now brackets each engine call with a `model_stream` start/end
  pair, and the run manager counts it exactly like `tool_start`/`tool_done`: an
  engine call in flight suspends the backstop, bounded by the loop's own 90s
  model-stream watchdog the same way a tool call is bounded by its own timeout.
  Keepalives still do not count as progress, so a wedged transport with no engine
  call in flight trips the backstop as before.

  Background automation failures now also report through `captureError`. Both
  callers — the recurring-jobs scheduler and the trigger dispatcher — recorded the
  failure onto the automation's own metadata and logged it, and neither reported
  it, so a cut-off automation was visible only in a resource field and stdout.

  A cut-off run now reports a terminal state instead of none. `runAgentLoop`
  returns early at an `auto_continue` checkpoint and never reaches its outcome
  classification, so a truncated run shipped `terminal_state` and `error_message`
  as null and the reason was recoverable only from `agent_run_events`. Unplanned
  boundaries (`no_progress`, `stream_ended`, `gateway_timeout`, …) now surface as a
  retryable failure carrying the reason as the terminal code, while the planned
  `run_timeout` chunk boundary — which a hosted foreground run hits roughly every
  40s by design — records its reason without counting as an error.

- Updated dependencies [60b7e74]
  - @agent-native/toolkit@0.16.8

## 0.164.26

### Patch Changes

- d5ceae9: Preserve the beta environment opt-out when custom authentication pages are served.

## 0.164.25

### Patch Changes

- 562194a: Stop sending `temperature` on model requests that carry Claude thinking. Effort
  defaults to High on every reasoning-capable Claude model, so internal callers
  that asked only for `temperature: 0` — the Observational Memory compactor, eval
  judges, sentiment inference — always got a 400 ("`temperature` may only be set
  to 1 when thinking is enabled or in adaptive mode"). The Anthropic, AI SDK, and
  Builder gateway engines now drop the sampling parameters when thinking is on or
  when the model family removed them, and Observational Memory compaction runs at
  low effort so thinking cannot consume its whole output budget.

## 0.164.24

### Patch Changes

- 14a3f87: Preserve the beta environment opt-out when custom authentication pages are served.
- 14a3f87: Keep BYOA sign-in and liveness routes available while unrelated serverless bootstrap work is waiting on the database.

## 0.164.23

### Patch Changes

- b811566: Preserve the beta environment opt-out when custom authentication pages are served.

## 0.164.22

### Patch Changes

- 7bb5be0: Reject host-native better-sqlite3 binaries in Netlify server bundles before publication.
- 7bb5be0: Persist beta-to-production opt-outs from the cached sign-in shell for 24 hours.

## 0.164.21

### Patch Changes

- 68f299c: Clarify deployment targets and document Agent-Native app configuration.

## 0.164.20

### Patch Changes

- bfe4163: Report Telegram webhook registration failures instead of treating rejected `setWebhook` responses as successful setup.

## 0.164.19

### Patch Changes

- 5f4031b: Restore ownerless legacy app visibility while preserving explicit private defaults for new apps.

## 0.164.18

### Patch Changes

- b34de4c: Report Telegram webhook registration failures instead of treating rejected `setWebhook` responses as successful setup.

## 0.164.17

### Patch Changes

- d492462: Support TipTap mark rule helpers in generated SSR stubs.

## 0.164.16

### Patch Changes

- 7d72340: Keep desktop Google exchanges alive through longer passkey ceremonies while retaining one-time verifier binding.

## 0.164.15

### Patch Changes

- 3f1cf50: Send signed-out users directly to the shared sign-in journey after logout so private app data queries cannot flash before the session gate redirects.

## 0.164.14

### Patch Changes

- 667a1c1: Deliver authenticated Desktop task tools to local code-agent MCP clients.
- 667a1c1: Add a development-only configuration control for isolated Desktop authentication acceptance runs.

## 0.164.13

### Patch Changes

- 62373a8: Fix Google sign-in callbacks in browsers by keeping the OAuth binding cookie available across the provider redirect.

## 0.164.12

### Patch Changes

- 379f7ca: Simplify deployment documentation with dedicated app and workspace paths, a deployment target overview, and a clearer advanced reference.

## 0.164.11

### Patch Changes

- ae91302: Make shared user-share writes conflict-aware when a resource enforces normalized principal uniqueness.

## 0.164.10

### Patch Changes

- 6a18780: Keep the beta environment switcher visible to signed-out visitors, including the standalone auth page.
- e439054: Support reusable Code Agent worktrees and reliable local chat forking across Desktop sessions.
- 5ececad: Surface sync-version allocator reseed failures while preserving the existing retry and clock-fallback behavior.

## 0.164.9

### Patch Changes

- b1c420b: Block agent prompts until an LLM provider is connected and provide an inline Connect AI recovery flow with a clear retry action.
- 8690e40: Make automation details inspectable in Dispatch, including the prompt, trigger configuration, capabilities, and past runs.
- e542242: Create every framework-owned table at release time, so a hosted deploy comes up with a complete database.

  Most framework tables are defined by their owning store's `ensureTable()`, not by a migration list — `settings`, `application_state`, `app_secrets` and `resources` among them. On a long-lived server the first request creates whatever is missing. On production serverless it cannot: `schemaEnsureDisabled()` reports every table present so a cold start skips ~390 probes, which is correct for latency and means nothing on the request path can create a table. Only 15 of ~75 framework tables had a migration list, so the other 60 had no path to creation at all on a hosted deploy. Sites published successfully and then failed every request with `relation "public.settings" does not exist`.

  `runFrameworkReleaseMigrations` now runs those stores' own ensure paths first, from an explicit list in `server/release-schema.ts`, and `schemaEnsureDisabled()` no longer applies to a caller holding migration duty — the release step was subject to its own skip, because the Netlify build environment also sets `NETLIFY=true`.

  The list loads each store with a dynamic import, so re-exporting `runFrameworkReleaseMigrations` from `server/index.ts` does not pull 60 store modules into every server boot to serve a path that runs once.

  A new `guard:release-schema-complete` fails the build when a module creates tables and is not in that list, so a new store cannot repeat this. It recognises both `ensureTableExists` and stores that execute DDL held in a named constant, which is how `extensions/slots` created its tables without the first version of the guard seeing it. The migration-duty check moved to `db/migration-runtime.ts` to keep it off `db/client.js`, which stores mock.

  Already-published sites need one redeploy to pick up the missing tables.

## 0.164.8

### Patch Changes

- 939f6d2: Keep the core CLI agent-tool imports formatter-clean for package builds.

## 0.164.7

### Patch Changes

- 06cea8f: Keep the desktop chat composer blank while the identity gate is handling an unauthenticated saved thread.

## 0.164.6

### Patch Changes

- 8e51925: Fix Electron chat feedback around app visibility, local development tools, and run recovery.

## 0.164.5

### Patch Changes

- fc85cb2: Bind desktop Google OAuth exchanges to a high-entropy verifier so a known flow ID alone cannot retrieve a session token.

  Previously `/_agent-native/auth/desktop-exchange` returned a live session token to any caller that named the flow ID, and the flow ID came straight from the query string. An attacker could pick an ID, send someone to `/_agent-native/google/auth-url?desktop=1&flow_id=<known>&redirect=1`, then poll the exchange after that person signed in and receive their session token. The verifier now travels in an `X-Agent-Native-Desktop-Verifier` request header — which a link navigation cannot set — only its hash is stored, and the exchange read fails closed when the verifier is missing or does not match.

  **Desktop clients must be upgraded.** The old `GET ?desktop=1&flow_id=…` bootstrap is rejected, because that request shape is exactly what made the exchange stealable; there is no backward-compatible variant that keeps the fix. An older independently deployed desktop client will fail Google sign-in with `Invalid desktop exchange challenge.` until it ships the header-based bootstrap.

- fc85cb2: Stop treating an unreadable code-agent schedules file as an empty schedule list. A transient read error, a corrupt file, or a partially-written `schedules.json` collapsed to `[]`, and because every create/update/delete rewrites the whole file, the next mutation silently deleted every stored schedule. Only a genuinely absent file initializes as empty now; anything unreadable raises `CodeAgentSchedulesUnreadableError` and mutations refuse to run.
- 61ca441: Persist scheduled automation transcripts into chat threads so Open thread shows the run's agent steps.
- Updated dependencies [fc85cb2]
  - @agent-native/toolkit@0.16.7

## 0.164.4

### Patch Changes

- c58cd6e: Preserve verified mutation receipts and exact member identity across Dispatch and A2A delegation.

## 0.164.3

### Patch Changes

- f790010: Keep the current-main merge tree formatter-clean for shared agent runtime sources.

## 0.164.2

### Patch Changes

- 330cf77: Keep impersonal HTML redirects eligible for the shared SSR edge cache.

## 0.164.1

### Patch Changes

- 5a05b04: Connect signed-in users to Builder's managed AI gateway with least-privilege OAuth, encrypted per-user token custody, refresh, and revocation while preserving legacy Builder credentials for uncovered integrations.

## 0.164.0

### Minor Changes

- a2f21dc: Add an internal beta/production environment badge and typed deployment-lane metadata to hosted Agent-Native app shells.

### Patch Changes

- a2f21dc: Fix `useActionQuery`/`useActionMutation`/`callAction` surfacing an opaque `405` when a caller's HTTP verb doesn't match an action's declared `http.method` (e.g. a `defineAction({ http: { method: "DELETE" } })` called without `{ method: "DELETE" }`). The transport now throws a typed `action_method_mismatch` error naming the action, the method that was sent, and the method it declares, instead of a bare "Method not allowed" the caller had to reverse-engineer — and marks it non-retryable, since resending the same wrong verb never succeeds.
- a2f21dc: Show Approve/Deny again when a tool approval has to be re-asked. `approval_required` now carries an `askId` identifying that specific gate hit, and the chat retains a user's resolution per ask instead of per approval key. Previously, if a resume never consumed the grant (expired TTL, turn-id mismatch), the server re-asked for the same call and the client still showed the quiet "Approved" note — the buttons never came back, so the action silently never ran and there was no way to retry.
- a2f21dc: Improve locale picker labels and localized auth marketing copy.
- a2f21dc: Stop caller-supplied auth marketing from being overwritten by built-in localized copy. An app passing its own `marketing` whose `appName` matched a built-in slug (`Dispatch`, `Calendar`, …) had its tagline and features replaced by the stock localized copy in every non-English locale. A slug is now claimed only by content that actually matches the built-in entry.
- a2f21dc: Fix a bug where closing one chat tab could close several tabs at once (or make a tab reappear right after closing it). A duplicated thread id made two tab-bar entries share one underlying thread, so closing either removed both. Open-tab ids are now de-duplicated in the tab state itself, which covers both a corrupted list restored from localStorage and duplicates introduced at runtime by a synchronous burst of open requests.
- a2f21dc: Keep semantic settings URLs under the app's mounted workspace path.
- a2f21dc: Fix Connect Builder (and other `agentNativePath`/`appPath` calls) building the wrong URL in a multi-app workspace dev gateway when the current page's client-side route (e.g. `/settings`) isn't itself a workspace app id. Previously `appBasePath()` would blindly trust the URL's first path segment as the workspace mount, producing URLs like `/settings/_agent-native/builder/connect` that the gateway 404s into its app-picker page instead of Builder's real sign-in screen. The guessed segment is now validated against the deployed workspace app manifest when one is available.
- a2f21dc: Extend the human-in-the-loop tool approval grant window from 15 minutes to 1 hour. A user who stepped away between seeing an "Approve to run..." prompt and clicking it (e.g. to update their client) could return to a silently expired grant — clicking Approve did nothing because the durable row no longer matched `expires_at > now`, with no error shown.
- a2f21dc: Add regression coverage proving the magic-link `callbackURL`/`newUserCallbackURL` construction survives Better Auth's own `originCheck` validator end-to-end (not just a shape assertion) — this is the exact flow behind the `{"message":"Invalid callbackURL","code":"INVALID_CALLBACK_URL"}` reports from a UTM-tagged signup link and a retried sign-up after a stale `?error=` redirect. The existing absolute-URL promotion in `betterAuthCallbackURL` already fixed the underlying behavior; this closes the test gap so a future regression is caught even if the constructed URL still "looks" valid.

  Also stop silently swallowing a failure in the best-effort `email_verified` repair that runs after a successful verify-email redirect. A DB error there was previously indistinguishable from "nothing needed repairing," which is exactly the symptom in the "clicked the verify link, login still says not verified" reports — it's now reported via `captureAuthError` (still non-blocking) so a genuine failure is visible instead of silent.

- a2f21dc: Fix two bugs where a failure looked like success:
  - First-run onboarding's Skip/Continue no longer silently do nothing when the completion save fails. `completeFirstRun()` now rejects instead of swallowing a failed fetch or non-ok response, and `FirstRunOnboarding` surfaces the failure with a "Try again" affordance instead of bouncing to an unrelated full-screen error.
  - A workspace file (including binary exports) now renders a download card the moment it's created — `show-workspace-file`'s binary content-type gate is gone, and any tool result shaped like a workspace-file card (e.g. `web-request`/`provider-api-request`'s `saveToFile`) renders one automatically, without a second discretionary `show-workspace-file` call.

- a2f21dc: Keep replayed conversations faithful to what the agent actually did.
  - Resuming a run (chained background continuation, agent-teams `continue`) now
    replays the tool calls and results stored in `thread_data` instead of
    flattening each turn to its prose, so a resumed chunk can see the output of
    work already committed rather than re-running it. Integration turns keep their
    existing delivered-text-only replay policy, and each replayed result is bounded
    with an in-band truncation notice.
  - The outbound history window no longer slides by one message per turn. Every
    prompt cache matches a byte-identical prefix, so a window that moved every turn
    meant no cached prefix ever matched once a thread passed the message cap, and
    the whole conversation was re-billed at write price on every turn. The window
    start is now quantized to a stride.
  - Anthropic `redacted_thinking` blocks survive normalization and replay verbatim.
    They were silently dropped as an unknown block type, which left the next
    iteration of a tool-use turn sending an assistant turn the API rejects.
    Unrecognized content block types now warn instead of vanishing.
  - Reducing a long thread is Observational Memory's job, but its Observer only
    engages past 30k unobserved tokens while a 24-message count cap bit long
    before that, so turns left the request while compaction still had nothing to
    say about them. The count cap is now a backstop well above that threshold; the
    two char budgets remain the real bound on what a request carries.
  - A thinking block with no signature is dropped with a warning instead of being
    sent with an empty one, which the native API rejects outright — failing the
    whole turn on a provider error that points nowhere near the cause. The Builder
    gateway path is unchanged, since its tolerance here is unverified.

- a2f21dc: Retry a failed chat request automatically after the user connects an LLM provider from the recovery card, instead of leaving the request waiting behind a dismissed error.
- a2f21dc: Fix `provider-api-request` reporting a failed Slack send as a success. Slack's Web API always answers HTTP 200, even on failure, and encodes the real outcome as `ok: false` in the JSON body — `chat.postMessage` calls that failed (e.g. `not_in_channel`, `channel_not_found`, `msg_too_long`) looked identical to a delivered message to any caller checking `response.ok`, including the agent, which could then tell a user a Slack message was sent when it never was. Provider configs can now declare `bodyOkField` for this always-200-with-body-encoded-outcome convention; the Slack provider sets it, and a body-level `false` now flips the response's `ok` to `false` so a failed or unconfirmed send can no longer be reported as delivered.
- a2f21dc: Record a rejected Builder credential on the transcription path so it is not
  retried forever. The chat engine already marks a 401/403 and stops reusing that
  credential for the auth-failure TTL; transcription threw the raw upstream text
  and marked nothing, so one unusable credential re-sent the same doomed request
  on every attempt — 24 identical "Missing Authentication header" 401s in a day.
- Updated dependencies [a2f21dc]
  - @agent-native/toolkit@0.16.6

## 0.163.4

### Patch Changes

- 0860ba4: Keep the Vite "dev server is restarting" page polling until Nitro answers instead of stopping after five 1-second reloads during a multi-minute first boot.

## 0.163.3

### Patch Changes

- e059442: Keep collaboration auto-seeding correct for mapped document ids without issuing one database read per source row, and carry the configured deployment lane into server telemetry.
- e059442: Harden the local self-hosting Docker quickstart and document PostgreSQL volume upgrades.

## 0.163.2

### Patch Changes

- 8236ce6: Fence session replay uploads that time out before transport cancellation.

## 0.163.1

### Patch Changes

- 3ffbacb: Keep collaboration auto-seeding correct for mapped document ids without issuing one database read per source row, and carry the configured deployment lane into server telemetry.
- 3ffbacb: Harden the local self-hosting Docker quickstart and document PostgreSQL volume upgrades.

## 0.163.0

### Minor Changes

- a688849: Add organization groups and privacy controls for workspace apps. New apps use the organization default (organization-wide by default), while creators and organization admins can manage individual, group, and organization access from the shared popover.

## 0.162.0

### Minor Changes

- 0b57293: Add an internal beta/production environment badge and typed deployment-lane metadata to hosted Agent-Native app shells.

### Patch Changes

- 0b57293: Fix `useActionQuery`/`useActionMutation`/`callAction` surfacing an opaque `405` when a caller's HTTP verb doesn't match an action's declared `http.method` (e.g. a `defineAction({ http: { method: "DELETE" } })` called without `{ method: "DELETE" }`). The transport now throws a typed `action_method_mismatch` error naming the action, the method that was sent, and the method it declares, instead of a bare "Method not allowed" the caller had to reverse-engineer — and marks it non-retryable, since resending the same wrong verb never succeeds.
- 0b57293: Show Approve/Deny again when a tool approval has to be re-asked. `approval_required` now carries an `askId` identifying that specific gate hit, and the chat retains a user's resolution per ask instead of per approval key. Previously, if a resume never consumed the grant (expired TTL, turn-id mismatch), the server re-asked for the same call and the client still showed the quiet "Approved" note — the buttons never came back, so the action silently never ran and there was no way to retry.
- 0b57293: Fix a bug where closing one chat tab could close several tabs at once (or make a tab reappear right after closing it). A duplicated thread id made two tab-bar entries share one underlying thread, so closing either removed both. Open-tab ids are now de-duplicated in the tab state itself, which covers both a corrupted list restored from localStorage and duplicates introduced at runtime by a synchronous burst of open requests.
- f97dad9: Keep mounted framework endpoints reachable in dev and strip React Router HMR imports from transplanted app modules.
- 0b57293: Keep semantic settings URLs under the app's mounted workspace path.
- 0b57293: Fix Connect Builder (and other `agentNativePath`/`appPath` calls) building the wrong URL in a multi-app workspace dev gateway when the current page's client-side route (e.g. `/settings`) isn't itself a workspace app id. Previously `appBasePath()` would blindly trust the URL's first path segment as the workspace mount, producing URLs like `/settings/_agent-native/builder/connect` that the gateway 404s into its app-picker page instead of Builder's real sign-in screen. The guessed segment is now validated against the deployed workspace app manifest when one is available.
- 0b57293: Extend the human-in-the-loop tool approval grant window from 15 minutes to 1 hour. A user who stepped away between seeing an "Approve to run..." prompt and clicking it (e.g. to update their client) could return to a silently expired grant — clicking Approve did nothing because the durable row no longer matched `expires_at > now`, with no error shown.
- bcd4c14: Time out session-replay uploads so a hung request releases the flush lock instead of growing the replay queue for the rest of the session, and bound the extension-marker scan by its watermark instead of reading every marker row ever written.
- 0b57293: Add regression coverage proving the magic-link `callbackURL`/`newUserCallbackURL` construction survives Better Auth's own `originCheck` validator end-to-end (not just a shape assertion) — this is the exact flow behind the `{"message":"Invalid callbackURL","code":"INVALID_CALLBACK_URL"}` reports from a UTM-tagged signup link and a retried sign-up after a stale `?error=` redirect. The existing absolute-URL promotion in `betterAuthCallbackURL` already fixed the underlying behavior; this closes the test gap so a future regression is caught even if the constructed URL still "looks" valid.

  Also stop silently swallowing a failure in the best-effort `email_verified` repair that runs after a successful verify-email redirect. A DB error there was previously indistinguishable from "nothing needed repairing," which is exactly the symptom in the "clicked the verify link, login still says not verified" reports — it's now reported via `captureAuthError` (still non-blocking) so a genuine failure is visible instead of silent.

- 0b57293: Fix two bugs where a failure looked like success:
  - First-run onboarding's Skip/Continue no longer silently do nothing when the completion save fails. `completeFirstRun()` now rejects instead of swallowing a failed fetch or non-ok response, and `FirstRunOnboarding` surfaces the failure with a "Try again" affordance instead of bouncing to an unrelated full-screen error.
  - A workspace file (including binary exports) now renders a download card the moment it's created — `show-workspace-file`'s binary content-type gate is gone, and any tool result shaped like a workspace-file card (e.g. `web-request`/`provider-api-request`'s `saveToFile`) renders one automatically, without a second discretionary `show-workspace-file` call.

- 0b57293: Keep replayed conversations faithful to what the agent actually did.
  - Resuming a run (chained background continuation, agent-teams `continue`) now
    replays the tool calls and results stored in `thread_data` instead of
    flattening each turn to its prose, so a resumed chunk can see the output of
    work already committed rather than re-running it. Integration turns keep their
    existing delivered-text-only replay policy, and each replayed result is bounded
    with an in-band truncation notice.
  - The outbound history window no longer slides by one message per turn. Every
    prompt cache matches a byte-identical prefix, so a window that moved every turn
    meant no cached prefix ever matched once a thread passed the message cap, and
    the whole conversation was re-billed at write price on every turn. The window
    start is now quantized to a stride.
  - Anthropic `redacted_thinking` blocks survive normalization and replay verbatim.
    They were silently dropped as an unknown block type, which left the next
    iteration of a tool-use turn sending an assistant turn the API rejects.
    Unrecognized content block types now warn instead of vanishing.
  - Reducing a long thread is Observational Memory's job, but its Observer only
    engages past 30k unobserved tokens while a 24-message count cap bit long
    before that, so turns left the request while compaction still had nothing to
    say about them. The count cap is now a backstop well above that threshold; the
    two char budgets remain the real bound on what a request carries.
  - A thinking block with no signature is dropped with a warning instead of being
    sent with an empty one, which the native API rejects outright — failing the
    whole turn on a provider error that points nowhere near the cause. The Builder
    gateway path is unchanged, since its tolerance here is unverified.

- 16cbc53: Stop PR Visual Recap gate skips from creating visible pull request comments.
- 0b57293: Fix `provider-api-request` reporting a failed Slack send as a success. Slack's Web API always answers HTTP 200, even on failure, and encodes the real outcome as `ok: false` in the JSON body — `chat.postMessage` calls that failed (e.g. `not_in_channel`, `channel_not_found`, `msg_too_long`) looked identical to a delivered message to any caller checking `response.ok`, including the agent, which could then tell a user a Slack message was sent when it never was. Provider configs can now declare `bodyOkField` for this always-200-with-body-encoded-outcome convention; the Slack provider sets it, and a body-level `false` now flips the response's `ok` to `false` so a failed or unconfirmed send can no longer be reported as delivered.
- 0b57293: Record a rejected Builder credential on the transcription path so it is not
  retried forever. The chat engine already marks a 401/403 and stops reusing that
  credential for the auth-failure TTL; transcription threw the raw upstream text
  and marked nothing, so one unusable credential re-sent the same doomed request
  on every attempt — 24 identical "Missing Authentication header" 401s in a day.
- Updated dependencies [16cbc53]
- Updated dependencies [0b57293]
  - @agent-native/recap-cli@0.5.5
  - @agent-native/toolkit@0.16.5

## 0.161.23

### Patch Changes

- 112547e: Resolve Agent Native model selections through request, org/user defaults, and the global catalog before sending a concrete model to the Builder gateway.

## 0.161.22

### Patch Changes

- 8a7ba01: Restore formatter compliance in core schema sanitization code.

## 0.161.21

### Patch Changes

- 0d81f46: Keep the core tool-schema seam regression test formatted with the current source formatter.
- 0b0085f: Fix workspace app sign-in continuation and mounted-app launches.

## 0.161.20

### Patch Changes

- 814f0ad: Allow explicitly configured public ingestion routes to complete cross-origin preflight requests without enabling credentialed CORS.
- c54d918: `useSemanticNavigationState` no longer reports an unserializable navigation state
  once per render. The write-dedup token fell back to a fresh symbol, and
  `navigationKeys` is typically a new array each render, so every re-render issued
  another failing write and another `onError`. It now falls back to the state's own
  identity, which still lets a genuinely different unserializable state reach the
  write path and surface its real error.

## 0.161.19

### Patch Changes

- efc5f92: Improve the self-hosting documentation with a fast local Docker quickstart and downloadable Chat fixture.
- 9fed363: Teach generated workspaces to reuse shared settings, vault, OAuth, and onboarding primitives before building custom integration setup UI.

## 0.161.18

### Patch Changes

- 9dd50a0: Drop JSON Schema keywords OpenAI's function validator rejects: unsupported
  `format` values (`uri` from `z.string().url()` among them) and constraint-only
  keywords like `patternProperties`, `not`, and `if`/`then`/`else`. Any one of them
  400s the entire chat request, so a single `z.string().url()` in one tool broke
  every turn that offered it.
- f294ae3: Keep the Connect Builder and Custom keys actions side by side in the agent sidebar.

## 0.161.17

### Patch Changes

- 34496d7: Sanitize every tool schema at the engine boundary, not just `defineAction` ones.
  Hand-written tools (extensions, MCP, context tools) and third-party MCP server
  schemas bypassed the sanitizer entirely, so `extension-data-set` shipped a `data`
  property with no `type` and OpenAI 400'd the whole request — every tool in the
  payload, not just that one.

## 0.161.16

### Patch Changes

- c940f4c: Record a rejected Builder credential on the transcription path so it is not
  retried forever. The chat engine already marks a 401/403 and stops reusing that
  credential for the auth-failure TTL; transcription threw the raw upstream text
  and marked nothing, so one unusable credential re-sent the same doomed request
  on every attempt — 24 identical "Missing Authentication header" 401s in a day.

## 0.161.15

### Patch Changes

- 551b583: Fix `CORS_ALLOWED_ORIGINS` exact-match comparison to tolerate operator formatting differences (scheme/host casing, a trailing slash, or a bare domain with no scheme) instead of silently rejecting an otherwise-legitimate configured origin.
- 551b583: Stop sending unbounded inline base64 attachments to the model. Text attachments
  were capped; binary ones were not, so a large screenshot or PDF went out as a
  multi-megabyte `file_url` and OpenAI rejected the entire request ("string too
  long", 4,149,128 against a 1,048,576 limit), killing the turn. The upload to
  blob storage already happened — the hosted URL is now used in place of the bytes
  when they exceed the cap, instead of being discarded.
- 00025b1: Keep replayed conversations faithful to what the agent actually did.
  - Resuming a run (chained background continuation, agent-teams `continue`) now
    replays the tool calls and results stored in `thread_data` instead of
    flattening each turn to its prose, so a resumed chunk can see the output of
    work already committed rather than re-running it. Integration turns keep their
    existing delivered-text-only replay policy, and each replayed result is bounded
    with an in-band truncation notice.
  - The outbound history window no longer slides by one message per turn. Every
    prompt cache matches a byte-identical prefix, so a window that moved every turn
    meant no cached prefix ever matched once a thread passed the message cap, and
    the whole conversation was re-billed at write price on every turn. The window
    start is now quantized to a stride.
  - Anthropic `redacted_thinking` blocks survive normalization and replay verbatim.
    They were silently dropped as an unknown block type, which left the next
    iteration of a tool-use turn sending an assistant turn the API rejects.
    Unrecognized content block types now warn instead of vanishing.

## 0.161.14

### Patch Changes

- 96ecc13: Use compact app search and pin labels that stay on one line.
- 96ecc13: Clear stale thread restore errors when an unavailable saved tab becomes a fresh chat.
- 96ecc13: Give type-less tool-schema positions a concrete JSON value union. OpenAI rejects
  any schema position without a `type` ("schema must have a 'type' key") and 400s
  the entire chat request, the same way it rejected `oneOf`. Zod emits a bare `{}`
  for `z.unknown()`/`z.any()`, of which there are 137 sites across the templates,
  so this is answered at the same boundary rather than by retyping every action.

## 0.161.13

### Patch Changes

- a269cc8: Keep failed MCP app iframes visible under a compact error overlay with a clear open-in-new-tab escape hatch.

## 0.161.12

### Patch Changes

- 610103f: Page owners and admins when an app's chat stops answering. The detector already
  existed as `scripts/chat-health.mjs --strict`, but nothing ran it and nothing
  alerted, so a sustained outage was found by a user posting in Slack. The same
  turn-scoring now runs on the durable sweep that already drives stale reaping,
  scoped to the app it runs in so no cross-app credential is needed. "Not enough
  turns to judge" and "could not read the ledger" are distinct outcomes from
  "healthy" — a check that could not run never reports all-clear.
- 610103f: Rewrite `oneOf` to `anyOf` in generated tool schemas. OpenAI's function-calling
  validator rejects `oneOf` outright, and Zod v4 emits it for every
  `z.discriminatedUnion`, so a single action carrying one 400'd the entire chat
  request before any token streamed — every tool in the payload, not just that
  action. Measured at 178k errors across 786 users over seven weeks. Also stops a
  settings-read failure in the chat-health pager from reading as "never paged".
- 2a7736a: Bound realtime polling, invalidation, collaboration, and autoscroll work so idle or rapidly changing surfaces do not retain unbounded state or repeat expensive refreshes.

## 0.161.11

### Patch Changes

- 1e90670: Bound core client state retention and avoid repeating semantic route-state serialization on unrelated renders.

## 0.161.10

### Patch Changes

- bee7146: Page owners and admins when an app's chat stops answering. The detector already
  existed as `scripts/chat-health.mjs --strict`, but nothing ran it and nothing
  alerted, so a sustained outage was found by a user posting in Slack. The same
  turn-scoring now runs on the durable sweep that already drives stale reaping,
  scoped to the app it runs in so no cross-app credential is needed. "Not enough
  turns to judge" and "could not read the ledger" are distinct outcomes from
  "healthy" — a check that could not run never reports all-clear.

## 0.161.9

### Patch Changes

- 3c54d4e: Add `setAgentNativeApiDisabled(reason)` for surfaces framed by a host with no
  agent-native session, so the client stops calling `/_agent-native/*` instead of
  401-ing on every poll. Action queries do not fire, action fetches and
  application-state reads/writes throw `AgentNativeApiDisabledError`, session reads
  resolve as signed out, and the runtime-config ping is skipped.
- 3c54d4e: `sendToBuilderChat` accepts a `targetOrigin` for embedders that verified the
  Builder parent through a handshake. `getBuilderParentOrigin()` requires
  `?builder.*` params to trust a loopback parent, so those embeds previously fell
  back to posting `"*"`.

## 0.161.8

### Patch Changes

- adf5cb0: Prioritize a selected A2A receiver's declared local capabilities before cross-app delegation.

## 0.161.7

### Patch Changes

- 8a867bc: Fix Cloudflare Pages builds for templates that import the PDF.js legacy entrypoint.

## 0.161.6

### Patch Changes

- ff06749: fix stale home chat pointers so a missing local thread does not render a restore error
- ff06749: fix mounted embed dev servers serving CSS and other static assets through Vite's normal asset pipeline and allow Builder preview origins to use embed CORS
- c7ad22e: Fix Portal remote connector initialization so handoffs create remote run records and expose command failures in connector logs.
- ff06749: Record what was sent when an agent run errors. An errored run's capture now
  carries the failed request's model, payload bytes, tool count, and message
  count alongside `gatewayRequestId` — sizes and counts only, never prompt or
  user content — so an oversized request and an upstream outage stop producing
  identical, undiagnosable captures.
- ff06749: Stop a background turn from retrying an identical failure forever. When two
  consecutive server-driven continuation chunks end on the same terminal error
  code having produced no assistant text and no tool calls, the chain now stops
  and the run ends with one non-recoverable error that keeps the original error
  code and the gateway's `ERROR ID:` reference. A different error, or the same
  error after real progress, still chains as before.

## 0.161.5

### Patch Changes

- 4c7c289: Keep scoped chat tabs isolated when navigating between resources so an older
  resource's conversation cannot remain visible on the current resource.

## 0.161.4

### Patch Changes

- e0b883d: fix mounted embed dev servers serving CSS and other static assets through Vite's normal asset pipeline and allow Builder preview origins to use embed CORS
- e0b883d: Record what was sent when an agent run errors. An errored run's capture now
  carries the failed request's model, payload bytes, tool count, and message
  count alongside `gatewayRequestId` — sizes and counts only, never prompt or
  user content — so an oversized request and an upstream outage stop producing
  identical, undiagnosable captures.

## 0.161.3

### Patch Changes

- 1e7ce6a: Bound durable-event pruning to one atomic Postgres statement so interrupted serverless workers cannot leave idle transactions behind.
- 1e7ce6a: Re-arm Neon idle-transaction cleanup and bound concurrent agent-run pruning.

## 0.161.2

### Patch Changes

- 772f59a: Allow token-authenticated remote device relay endpoints to reach their route-level device-token verifier.
- 772f59a: Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
- 772f59a: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- 772f59a: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- 772f59a: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- 772f59a: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- 772f59a: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- 772f59a: Keep the gateway request id on agent-chat error captures, and create the
  workspace connection tables at release time.

  A Builder gateway error stop often arrives as one opaque user-facing sentence
  carrying only an error id. The request id was captured only when the gateway
  sent no message at all, so the errors that actually page had no key to join on
  upstream. It now rides the stop event onto `EngineError` and out as a
  `gatewayRequestId` tag (alongside `statusCode`) on the run-manager capture.

  `workspace_connections`, `workspace_connection_grants`, and
  `workspace_user_groups` existed only in their runtime `ensureTable` helpers.
  Those are a no-op on a production serverless runtime by design, so
  `workspace_user_groups` was never created in production and every read failed
  with `relation "public.workspace_user_groups" does not exist`. They now have a
  release migration.

- 772f59a: Format the Portal reference table in the shared core documentation.
- 772f59a: Redact nested callback parameters in desktop magic-link diagnostics.
- 772f59a: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.
- 772f59a: Keep approved agent actions valid across Dispatch history replay and scope them to the current turn.
- 772f59a: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.161.1

### Patch Changes

- 71e1308: Name the Builder gateway's unhandled-500 envelope instead of letting it end a
  turn as `unknown`.

  The gateway can answer 200 and then emit an in-stream error frame whose whole
  message is its own internal envelope ("Sorry, we ran into an issue processing
  your request. ERROR ID: …"), with no code and no status. That matched no
  classifier, so the turn died on the first attempt — no engine retry, no
  continuation, `error_code = 'unknown'` in `agent_runs`, and Builder's internal
  correlation id rendered as the assistant's answer. The identical body arriving
  as an HTTP 500 was always retried.

  `classifyTerminalErrorCode` now returns `builder_gateway_internal_error` for
  that envelope, the engine marks it `providerRetryable` so the verdict survives
  the Builder-credits message rewrite, and every predicate that lists `http_500`
  lists it too. The chat now shows what broke and keeps the error id in the
  details.

## 0.161.0

### Minor Changes

- 2107a36: Let a hosted app pay for its own AI with Builder credits. `BUILDER_GATEWAY_TOKEN`
  plus `BUILDER_GATEWAY_SPACE_ID` now select the Builder engine and back the
  gateway lane (chat, web search, realtime voice, transcription, scheduled and
  event automations), so an anonymous visitor can use AI on a deployed site
  without connecting anything. An injected gateway token can never move a
  customer's spend onto Builder credits: it steps aside for any other engine whose
  credentials resolve. A Builder key pair the customer configured themselves is
  unchanged and keeps winning, as does `AGENT_ENGINE_PREFER_BYO_KEY`. Where the
  deployment pays, a rejected or missing credential reads as one line to the
  visitor, with the real reason kept on the error code for the owner; that holds
  for the gateway's own 402/403 on voice and realtime transcription, for the auto
  provider chain rather than only an explicit Builder preference, for a gateway
  whose transport dropped or whose stream stopped early, and at the point the chat
  renders an error — where a message the deployment already chose for a visitor is
  no longer re-expanded from its code back into owner instructions. Owner surfaces
  keep the copy that says what to fix, the workspace/preview runtime included, even
  though it carries the same injected token as the published site. No recovery
  decision depends on what the error message says any more: the Builder engine
  marks a retryable gateway rejection and an over-long prompt structurally, and
  those verdicts reach the chat client too. So an overloaded provider retries the
  same way whoever is paying — without turning a provider throttle into a chain of
  background continuations against the limit that just rejected it — a truncated
  stream is still continued from where it stopped instead of ending the turn, and a
  conversation that outgrew the context window still gets its one automatic trim
  and retry. A background or
  scheduled run keeps the message the server chose for its failure rather than
  restating it from the terminal reason, and an earlier transient error in the same
  run can no longer stand in for the reason the run actually died. Pasted
  `ANTHROPIC_API_KEY` values are now validated when saved.

### Patch Changes

- 2107a36: Preserve chat restore failures for recovery and distinguish missing threads from transient errors.
- 2107a36: Keep the chat share popover interactive while it is open in the sidebar.

## 0.160.2

### Patch Changes

- 831e915: Recover and index durable approval continuation scopes when clients omit a logical turn id.

## 0.160.1

### Patch Changes

- d3702a5: Allow token-authenticated remote device relay endpoints to reach their route-level device-token verifier.
- d3702a5: Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
- d3702a5: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- d3702a5: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- d3702a5: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- d3702a5: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- d3702a5: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- d3702a5: Support moving existing local Code Agents chats to a paired Portal computer with their code snapshot and text transcript context.
- d3702a5: Format the Portal reference table in the shared core documentation.
- d3702a5: Redact nested callback parameters in desktop magic-link diagnostics.
- d3702a5: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.
- d3702a5: Keep approved agent actions valid across Dispatch history replay and scope them to the current turn.
- d3702a5: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.160.0

### Minor Changes

- 167be56: Let a hosted app pay for its own AI with Builder credits. `BUILDER_GATEWAY_TOKEN`
  plus `BUILDER_GATEWAY_SPACE_ID` now select the Builder engine and back the
  gateway lane (chat, web search, realtime voice, transcription, scheduled and
  event automations), so an anonymous visitor can use AI on a deployed site
  without connecting anything. An injected gateway token can never move a
  customer's spend onto Builder credits: it steps aside for any other engine whose
  credentials resolve. A Builder key pair the customer configured themselves is
  unchanged and keeps winning, as does `AGENT_ENGINE_PREFER_BYO_KEY`. Where the
  deployment pays, a rejected or missing credential reads as one line to the
  visitor, with the real reason kept on the error code for the owner; that holds
  for the gateway's own 402/403 on voice and realtime transcription, for the auto
  provider chain rather than only an explicit Builder preference, for a gateway
  whose transport dropped or whose stream stopped early, and at the point the chat
  renders an error — where a message the deployment already chose for a visitor is
  no longer re-expanded from its code back into owner instructions. Owner surfaces
  keep the copy that says what to fix, the workspace/preview runtime included, even
  though it carries the same injected token as the published site. No recovery
  decision depends on what the error message says any more: the Builder engine
  marks a retryable gateway rejection and an over-long prompt structurally, and
  those verdicts reach the chat client too. So an overloaded provider retries the
  same way whoever is paying — without turning a provider throttle into a chain of
  background continuations against the limit that just rejected it — a truncated
  stream is still continued from where it stopped instead of ending the turn, and a
  conversation that outgrew the context window still gets its one automatic trim
  and retry. A background or
  scheduled run keeps the message the server chose for its failure rather than
  restating it from the terminal reason, and an earlier transient error in the same
  run can no longer stand in for the reason the run actually died. Pasted
  `ANTHROPIC_API_KEY` values are now validated when saved.

### Patch Changes

- ed0666b: Allow token-authenticated remote device relay endpoints to reach their route-level device-token verifier.
- ed0666b: Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
- ed0666b: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- ed0666b: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- ed0666b: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- ed0666b: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- ed0666b: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- ed0666b: Format the Portal reference table in the shared core documentation.
- ed0666b: Redact nested callback parameters in desktop magic-link diagnostics.
- ed0666b: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.
- ed0666b: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.159.6

### Patch Changes

- b676db8: Allow token-authenticated remote device relay endpoints to reach their route-level device-token verifier.
- b676db8: Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
- b676db8: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- b676db8: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- b676db8: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- b676db8: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- b676db8: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- b676db8: Format the Portal reference table in the shared core documentation.
- b676db8: Redact nested callback parameters in desktop magic-link diagnostics.
- b676db8: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.
- b676db8: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.159.5

### Patch Changes

- b676db8: Allow token-authenticated remote device relay endpoints to reach their route-level device-token verifier.
- b676db8: Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
- b676db8: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- b676db8: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- b676db8: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- b676db8: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- b676db8: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- 94fc4d8: Keep feature-flag definitions off the server HMAC barrel so Vite client graphs do not crash.
- b676db8: Format the Portal reference table in the shared core documentation.
- b676db8: Redact nested callback parameters in desktop magic-link diagnostics.
- b676db8: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.
- b676db8: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.159.4

### Patch Changes

- 436340b: Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
- 436340b: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- 436340b: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- 436340b: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- 436340b: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- 436340b: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- 436340b: Format the Portal reference table in the shared core documentation.
- 436340b: Redact nested callback parameters in desktop magic-link diagnostics.
- 436340b: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.
- 436340b: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.159.3

### Patch Changes

- 7b267fd: Rewrite preserved Yjs imports in Node server build output.
- Updated dependencies [95ea873]
  - @agent-native/toolkit@0.16.4

## 0.159.2

### Patch Changes

- 7acc86e: Bind workspace embed-session adoption to the existing target identity while allowing app-local organization ids.
- 7acc86e: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- 7acc86e: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- 7acc86e: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- 7acc86e: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- 7acc86e: Format the Portal reference table in the shared core documentation.
- 7acc86e: Redact nested callback parameters in desktop magic-link diagnostics.
- 7acc86e: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.159.1

### Patch Changes

- 4f686cd: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- 4f686cd: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- 4f686cd: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- 4f686cd: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.
- 4f686cd: Format the Portal reference table in the shared core documentation.
- 4f686cd: Redact nested callback parameters in desktop magic-link diagnostics.
- 4f686cd: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.159.0

### Minor Changes

- d003981: Add `defineAppConfig()` and `getAppConfig()` — one zod schema under `src/app-config/` that owns server-side configuration, so a value can be set in typed app code instead of only through an environment variable. Environment variables become declared `.meta({ env })` aliases into a schema field, parsed and validated in one place rather than at each call site, and resolve below explicit app configuration. A field can declare several aliases in precedence order, which is how one concept with many historical spellings collapses to a single declared ladder.

  Five domains are declared so far, replacing roughly thirty hand-rolled `process.env` reads:
  - **`privateBlob`** — `provider` selects which registered provider is active, replacing the implicit "first one whose `isConfigured()` returns true in module import order" rule (still the fallback when unset), and throwing when the named provider is not registered. `publicUploadFallback` replaces a setter and an environment variable whose precedence was decided by statement order inside `putPrivateBlob`. `setPrivateBlobPublicUploadFallbackEnabled` is deprecated but keeps working, now with a stated position in the ladder.
  - **`app`** — `id`, `workspaceId`, `name`, `packageName`, and `template` replace nine fallback chains across agent chat, SSO, credential scoping, onboarding, the CLI, data programs, durable background dispatch, and workspace OAuth. They stay separate fields on purpose: `vault_grants` rows are written with the workspace-assigned id, so credential scoping keeps preferring it, and `name` is a display name rather than an identifier. None has a default, so an app with no configured identity is still denied a credential grant lookup instead of resolving one scoped to an app literally named `app`.
  - **`agent`** — `engine`, `model`, `mode`, `preferBringYourOwnKey`, `runSoftTimeoutMs`, `completedRunRetentionMs`, `erroredRunRetentionMs`. `resolveEngine`'s documented resolution order is unchanged and `createAgentChatPlugin({ model })` keeps working; the explicit option stays a function parameter above the declared field.
  - **`a2a`** and **`integrations`** — `allowUnsignedInternal` and `allowUnverifiedWebhooks`, the latter replacing three byte-identical copies of the same check in the telegram, whatsapp, and email webhook adapters.
  - **`workspace`** — `gatewayUrl` and `oauthOrigin`. Together with `app.url` these retire the `VITE_` mirrors of the URL keys: the prefix only ever answered "how does this value reach the browser", so the value is now one declared field and delivery goes through `window.__AGENT_NATIVE_CONFIG__` alongside the existing Sentry, PostHog, and realtime scripts.

  Two self-dispatch bugs are fixed along the way. `integrations/webhook-handler.ts` and `integrations/a2a-continuation-processor.ts` each carried their own copy of "resolve my own base URL"; both omitted `DEPLOY_PRIME_URL`, so a Netlify deploy preview dispatched background work to production, and the continuation copy silently fell back to `http://localhost:${PORT}` in production, where the request never arrives and the work is dropped with no error. Both now delegate to `resolveSelfDispatchBaseUrl`.

  A new guard keeps the surface from growing back: `pnpm guard:no-legacy-config` fails when a line this branch adds reads `process.env` in `packages/core/src` outside the four resolvers, or calls a deprecated entry point. Opt out per line with `// config-ok: <reason>`.

  Declared configuration now generates its own documentation: `pnpm sync:config-docs` writes the field table into `docs/environment-variables.md`, and `pnpm guard:config-docs` fails when it is stale.

  Malformed values in migrated keys now fail at startup naming the key, instead of silently reading as `false` or falling back to a default. This affects `AGENT_ENGINE_PREFER_BYO_KEY`, `A2A_ALLOW_UNSIGNED_INTERNAL`, `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS`, and the three agent run timeout/retention keys.

## 0.158.10

### Patch Changes

- c3a0f94: Add redacted diagnostics for desktop magic-link session-cookie handoff failures.

## 0.158.9

### Patch Changes

- f411be6: Rotate persisted Better Auth JWKS keys safely after an auth-secret change.

## 0.158.8

### Patch Changes

- 38e3471: Redact nested callback parameters in desktop magic-link diagnostics.

## 0.158.7

### Patch Changes

- d0de8bc: Add no-secret diagnostics around desktop magic-link issuance and verification so invalid-token failures can be isolated without logging the token.

## 0.158.6

### Patch Changes

- e76df66: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- e76df66: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- e76df66: Verify confirmed desktop magic links in the confirmation request so the one-time session cookie reaches the native callback reliably.
- e76df66: Format the Portal reference table in the shared core documentation.

## 0.158.5

### Patch Changes

- 4d2e3a2: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- 4d2e3a2: Keep Electron magic-link verification behind an explicit POST confirmation so link scanners cannot consume the sign-in token.
- 4d2e3a2: Format the Portal reference table in the shared core documentation.

## 0.158.4

### Patch Changes

- 2b618ab: Prevent email security scanners from consuming Electron magic-link sign-ins before the user confirms them.
- 2b618ab: Format the Portal reference table in the shared core documentation.

## 0.158.3

### Patch Changes

- 8a9743f: Format the Portal reference table in the shared core documentation.

## 0.158.2

### Patch Changes

- c91e4ba: Format the Portal reference table in the shared core documentation.

## 0.158.1

### Patch Changes

- 223cf26: Format the Portal reference table in the shared core documentation.

## 0.158.0

### Minor Changes

- 1267aec: Add approved background-tab creation to the remote Chrome browser control action surface.

## 0.157.28

### Patch Changes

- 3850b75: Keep packaged Desktop SSO on canonical client origins, read partitioned identity cookies without URL-filtered Chromium lookups, and prevent a child app session from replacing the verified Dispatch authority.
- 3850b75: Serve the authenticated Desktop completion page on Dispatch, the identity authority, after its ordinary sign-in flow.
- 3850b75: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 3850b75: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.
- 3850b75: Hide the Agent-Native SSO option on canonical hosted login pages while preserving explicit self-hosted opt-in.
- 3850b75: Add redacted target-side diagnostics for workspace embed-session ticket consumption so missing, expired, replayed, mismatched, and successful exchanges can be distinguished in production logs.

## 0.157.27

### Patch Changes

- bc5f350: Keep packaged Desktop SSO on canonical client origins, read partitioned identity cookies without URL-filtered Chromium lookups, and prevent a child app session from replacing the verified Dispatch authority.
- bc5f350: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- bc5f350: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.
- bc5f350: Add redacted target-side diagnostics for workspace embed-session ticket consumption so missing, expired, replayed, mismatched, and successful exchanges can be distinguished in production logs.

## 0.157.26

### Patch Changes

- abfb925: Serve the authenticated Desktop completion page on Dispatch, the identity authority, after its ordinary sign-in flow.

## 0.157.25

### Patch Changes

- 6e56b98: Keep packaged Desktop SSO on canonical client origins, read partitioned identity cookies without URL-filtered Chromium lookups, and prevent a child app session from replacing the verified Dispatch authority.
- 6e56b98: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 6e56b98: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.
- 6e56b98: Add redacted target-side diagnostics for workspace embed-session ticket consumption so missing, expired, replayed, mismatched, and successful exchanges can be distinguished in production logs.

## 0.157.24

### Patch Changes

- 6bdf1f7: Keep packaged Desktop SSO on canonical client origins, read partitioned identity cookies without URL-filtered Chromium lookups, and prevent a child app session from replacing the verified Dispatch authority.
- 6bdf1f7: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 6bdf1f7: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.
- 6bdf1f7: Add redacted target-side diagnostics for workspace embed-session ticket consumption so missing, expired, replayed, mismatched, and successful exchanges can be distinguished in production logs.

## 0.157.23

### Patch Changes

- febb983: Keep packaged Desktop SSO on canonical client origins, read partitioned identity cookies without URL-filtered Chromium lookups, and prevent a child app session from replacing the verified Dispatch authority.
- febb983: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- febb983: Add redacted target-side diagnostics for workspace embed-session ticket consumption so missing, expired, replayed, mismatched, and successful exchanges can be distinguished in production logs.

## 0.157.22

### Patch Changes

- 802f708: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 802f708: Add redacted target-side diagnostics for workspace embed-session ticket consumption so missing, expired, replayed, mismatched, and successful exchanges can be distinguished in production logs.

## 0.157.21

### Patch Changes

- 904b67c: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.

## 0.157.20

### Patch Changes

- d525c66: Harden embedded workspace authentication across hosts and prevent unauthorized session-location reads.

## 0.157.19

### Patch Changes

- 8d34d57: Harden embedded workspace authentication across hosts and prevent unauthorized session-location reads.

## 0.157.18

### Patch Changes

- 907dfa3: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.
- 907dfa3: Preserve organization Google-only policies during shared sign-in by marking only Dispatch identities with a verified Google account link, while keeping existing local accounts and sessions additive.
- 907dfa3: Return Google sign-in callbacks to native mobile clients using signed flow intent, even when the callback browser user-agent is not mobile, and hide the Agent Native SSO control in embedded auth views.
- 907dfa3: Keep framework-managed bearer routes reachable when authentication and action modules are loaded from separate server bundle instances.

## 0.157.17

### Patch Changes

- 9e73795: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.
- 9e73795: Preserve organization Google-only policies during shared sign-in by marking only Dispatch identities with a verified Google account link, while keeping existing local accounts and sessions additive.
- 9e73795: Keep framework-managed bearer routes reachable when authentication and action modules are loaded from separate server bundle instances.

## 0.157.16

### Patch Changes

- 1b7d8c2: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.
- 1b7d8c2: Keep framework-managed bearer routes reachable when authentication and action modules are loaded from separate server bundle instances.

## 0.157.15

### Patch Changes

- fa0f828: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.
- fa0f828: Keep framework-managed bearer routes reachable when authentication and action modules are loaded from separate server bundle instances.

## 0.157.14

### Patch Changes

- 4d8c36c: Keep framework-managed bearer routes reachable when authentication and action modules are loaded from separate server bundle instances.

## 0.157.13

### Patch Changes

- 7dc2c91: Allow framework-managed feature-flag bearer routes to reach their own verifier before the cookie auth guard.
- 7dc2c91: Create the Portal remote-device table during release migrations before serverless requests run.

## 0.157.12

### Patch Changes

- bdbe6a1: Keep Portal device authentication working when a proxy supplies or strips the Authorization header.

## 0.157.11

### Patch Changes

- 5e19db2: Treat Netlify function runtimes as serverless when configuring database pools so abandoned transactions are reaped.

## 0.157.10

### Patch Changes

- 81fb79e: Keep the user's own messages in agent chat history when a tool-heavy turn is large. The request history was priced against one 64,000-char budget spent newest-first, so a single read-heavy assistant turn could evict every earlier thing the user asked for — in one measured production thread the model saw none of the user's previous nine asks and re-derived the same answer each turn. Tool payloads and user messages now draw on separate budgets, and an oversized recent turn no longer drops the cheaper messages behind it.
- 81fb79e: Allow the Clips ffmpeg runtime in Netlify function size checks while preserving frame extraction and video seekability.
- 81fb79e: Allow desktop hosts to provide a chat-first default app order while preserving user-pinned and manually reordered layouts.
- 81fb79e: Stop `get-extension` from re-fetching source the agent already holds. Identical `contentQuery` excerpts are now deduplicated per run the same way whole-body reads already were — one production turn spent 48 of its 110 extension reads re-sending spans it had just been given. The large-body hint also now says when a single `forceContent` read costs less context than repeated excerpts.
- 81fb79e: Hide app-owned chat sidebars when Electron or Dispatch provides the host chat.
- 81fb79e: Add a boolean-first hosted tools-only harness configuration for production apps, with Claude Code, Codex, Pi, and OpenCode runtime choices and no repository or code-editing access.
- 81fb79e: Keep Dispatch's collapsed chat-first sidebar actions visible and icon-only, matching the Electron rail.
- 81fb79e: Keep selected chat-first apps visible and open granted external apps from Dispatch.
- 81fb79e: Attribute client analytics, action calls, and agent runs with a canonical `client_platform` value for web, Electron, and mobile surfaces.
- 81fb79e: Name the case where an Observational Memory cursor cannot apply to the window it is given. The cursor is a position in whichever message array observed it, and the live agent loop's array counts each tool result separately while the store-derived one folds those into their tool-call parts — so a cursor from the longer basis leaves the thread permanently unable to observe anything, reported identically to "nothing new". It now says so instead.
- 81fb79e: Keep post-turn Observational Memory compaction alive on serverless hosts. The pass is issued after the turn's `done` event and has to finish a streaming model call before it writes, so on a host that freezes the isolate once the response settles the unregistered promise was simply killed and the thread never accrued the memory that would have spared the next turn. It now registers with the request's `waitUntil` when the platform provides one; long-lived hosts keep the existing fire-and-forget behavior.
- 81fb79e: Add Portal handoffs for resumable code-agent runs: snapshot local changes to a remote branch, prepare an isolated worktree on a paired computer, and load that computer's local environment without transferring secrets.
- 81fb79e: Read a line's `a:headEnd`/`a:tailEnd` decorations when importing a PPTX. A connector that terminates in a round dot at both ends — 11 of the 18 connectors on one real SlidesMania deck — imported as a bare rule, because the parser stopped at the stroke's colour and width. Ends of every type are now recorded on the element, including the ones a renderer cannot draw, so a skipped end stays distinguishable from a line the source drew bare.
- 81fb79e: Keep a PPTX picture's own frame geometry when importing, so a portrait cropped to an `ellipse` or freeform frame renders inside that shape instead of as the hard square its bounding box happens to be.
- 81fb79e: Preserve embedded chat transcript restoration when React StrictMode replays effects.
- 81fb79e: Create framework chat, agent-run, harness-session, and usage-alert tables in release migrations so production request functions do not fail on missing schema. Upgrade Better Auth to the newest mature 1.6.x release for the Drizzle adapter stack-overflow fix.
- 81fb79e: Recover conversation history on the server when a foreground turn arrives without any. The client trims history against a size budget, so a single tool-heavy turn could reduce it to nothing — and downstream that is indistinguishable from the first message of a new thread. An existing thread now falls back to a bounded, text-only window of what was said, so the agent stops re-deriving answers it already gave. A new contract test covers the client-trim → wire → engine-messages seam, where unit tests on both halves passed while the conversation went missing between them.
- 81fb79e: Make shared-auth rollout failures fail closed while allowing an explicitly allowlisted operator to manage feature flags across deployments without a local organization. Clear stale Dispatch fallback errors after a successful direct load, and keep hosted chat restore controls local-only.
- 81fb79e: Keep app chat context chips current and prevent hover chrome from flashing during app switches.
- 81fb79e: Allow chat-first surface tabs to expose the shared new-tab affordance used by desktop terminal tabs.
- Updated dependencies [81fb79e]
  - @agent-native/toolkit@0.16.3

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
