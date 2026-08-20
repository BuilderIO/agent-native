# @agent-native/core

## 0.145.6

### Patch Changes

- 1d5bab1: Keep the chat and prompt composer visible while assistant-ui recovers from a transient render error.
- 1d5bab1: Stop cold-started processes from replaying the entire durable action-marker
  history. `seedVersionFromDb` rewound the marker watermark to `0` so a marker
  written just before boot still reached the first poll, but the replay filter is
  `updated_at > watermark` and the `__action_change__` table is one never-pruned
  row per identity that has ever run a mutating action — so every boot re-emitted
  all of it. On one production app that was 2,188 rows replayed ~32 times a
  minute: 1,169 sync events/sec against ~1.7/sec of real traffic, and a 47 GB
  `sync_events` table. The rewind is now bounded to a 60-second replay window,
  which preserves its purpose, and the marker read is bounded by the same
  watermark instead of selecting the whole table.

  Also enables `deterministicEventIds` for the default sync state so concurrent
  processes detecting the same external write collapse via `ON CONFLICT (id) DO
NOTHING`, and keys the action-marker dedupe on each row's own `updated_at`
  rather than the table-wide maximum. That mechanism defaulted off and was never
  set anywhere, so every `dedupeKey` in the poll path had been inert.

  `manage-agent-engine` now classifies `test` and `get-app-default` as reads
  alongside `list`, so those calls no longer announce a change.

- 1d5bab1: Fix MCP integration logos so every catalog entry uses a real mark and dark marks stay legible.
- 1d5bab1: Accept OAuth client metadata documents that advertise additional extension grant types, including Claude's JWT bearer grant, while preserving the server's authorization-code flow.
- 1d5bab1: Stop the chat client from durably aborting background runs that are still
  working.

  The kill verdict was rendered against a `/runs/active` snapshot fetched
  _before_ the SSE attach that had just blocked for its whole duration, so any
  progress that landed during the attach was invisible to the decision. Fleet
  data: 23 of 24 client-watchdog kills hit runs that had made server-authoritative
  progress within the previous 90 seconds. The client now takes a second reading
  after the attach, and only on the path that would otherwise condemn the run —
  the healthy path pays nothing.

  A failed or unparseable `/runs/active` poll no longer counts as "no active run".
  Unreadable and absent were the same value, and the absent branch reached the
  durable abort without consulting progress at all, so one flaky tick could end a
  live turn.

  A model-stream retry the user waited through is now narrated instead of silently
  wiping the transcript. Three 90-second retries used to blank the screen at 92s,
  182s, and 272s with no explanation — the shape people report as "the chat froze".
  Fast provider blips stay silent.

- 1d5bab1: Add an opt-in database-pressure reading to `/_agent-native/health?pressure=1`.
  The route reports the three `pg_stat_activity` signals that preceded the
  2026-08-06 analytics outage — idle-in-transaction pileup, slow trivial queries,
  and one query stampeding — so a scheduled fleet audit can watch them without
  holding any production database credential of its own. A dialect or connection
  that cannot answer reports `measured: false` with a reason rather than a clean
  zero, and pressure never changes `ready` or the response status.
- 1d5bab1: Preserve incomplete provider-corpus coverage when a paginated search stops at a page cap.
- 1d5bab1: Preserve OAuth authentication for legacy MCP endpoint configurations.
- 1d5bab1: Keep the magic-link onboarding form as the default view when outbound email is ready, while preserving explicit password sign-in fallbacks.
- 1d5bab1: Keep inline help affordances visually subordinate to the text they explain.
- 1d5bab1: Paginate long organization member lists in settings.
- 1d5bab1: Add shared production configuration diagnostics, deploy guidance, and an
  in-app warning chip with a copyable AI remediation prompt. Agent-Native app
  configuration now supports deep-merged runtime requirements and typed
  `agent-native.ts` aliases alongside `agent-native.json`.
- 1d5bab1: Fix the `sync_events` retention prune, which planned as a sequential scan of
  the entire table. It now deletes by the already-indexed `version` column
  (monotonic epoch milliseconds) in bounded batches, oldest first, and reports a
  failure instead of swallowing it. On one production app the old statement was
  scanning a 47 GB table roughly 60 times concurrently, and a prune that never
  succeeded was indistinguishable from one with nothing to do.
- 1d5bab1: Polish streaming tool-call motion so new calls fade in, retained rows slide with
  the stack, and older calls visibly settle into the collapsed tool summary.
- 1d5bab1: Add a keyboard-accessible 75% chat drawer while keeping the app layout stable.

## 0.129.0

### Minor Changes

- 0aada94: Serve the stateless MCP 2026-07-28 protocol natively while preserving stateless
  legacy clients, automatically negotiate the newest supported protocol from
  outbound clients and stdio bridges, and harden MCP OAuth issuer, client type,
  scope, credential binding, and Client ID Metadata Document behavior. Require
  durable, single-use MCP 2026 approval elicitation before running actions marked
  `needsApproval`.

  Update the Pinpoint MCP server example to use the stable split MCP v2 packages.

### Patch Changes

- 0aada94: Stop telling sibling agents that an app has no callable actions when it does.
  The public agent card could only advertise actions with `requiresAuth !== true`,
  while `actions/invoke` only ever executes actions with `requiresAuth === true` —
  two disjoint sets. Every app whose A2A actions were authenticated therefore
  published an empty skills list, and `describe-workspace-apps` reported
  "exposes no directly callable actions" about an app the caller could in fact
  call directly. Callers took that at face value and fell back to open-ended
  `call-agent` delegation, which hands schema discovery to a second model; in
  practice that model shelled out through `bash`, failed to find the data, and
  looped until the repetition guard stopped the run.

  The card now serves the invocable set to a caller with a verified A2A identity,
  and sibling capability discovery signs its probe so it sees that set. Anonymous
  card fetches are unchanged and still expose only the publicly-safe list, so no
  capability is disclosed to an unauthenticated reader that was not disclosed
  before.

- 0aada94: Let Design MCP App canvases hand pending visual source edits back to the host coding conversation while preserving the local Design-agent and copy-prompt fallbacks for ordinary browser panes.

  Teach visual-edit users to minimize Design chrome with Figma's `Shift+\` shortcut or the command menu without claiming the host-reserved `Cmd+\` chord.

- 0aada94: Keep client status timeouts isolated to their own endpoint and preserve the last known model readiness when a status probe is temporarily unavailable.
- 0aada94: Visual edit: never render a source snapshot in place of the running app. A localhost screen now always loads a live document — the proxied `/live-edit` frame for viewers holding the connection's `previewToken`, and the plain dev-server URL for everyone else. Previously a viewer without a token (signed-out session, public link, inline browser with no cookies) got the `/snapshot` HTML as `srcdoc`: a frozen copy that looked exactly like the app but had no live DOM behind it, so selection, the layers panel, and edits all silently addressed stale markup.
- 0aada94: Show relative cost per model in the composer's model picker. Each row now
  carries a quiet `$`/`$$`/`$$$` suffix so a user can tell an entry model from a
  flagship one before selecting it, rather than discovering the difference in
  their bill. The tier reuses the token list the picker already sorts by
  (`MODEL_COST_ORDER`) and reflects each provider's own entry/mid/flagship ladder
  — it is not a cross-provider price claim. Models outside that list render with
  no label at all; a guessed tier would read as fact.
- 0aada94: Send `reasoning_effort: "none"` instead of omitting it when a custom OpenAI base
  URL forces Chat Completions with tools present. Omitting the field let OpenAI
  apply the model's own default effort, so GPT-5.6 runs kept failing with
  "Function tools with reasoning_effort are not supported for <model> in
  /v1/chat/completions" even after the field was dropped.
- 0aada94: Use OpenAI's current `gpt-transcribe` model for direct OpenAI voice dictation uploads.
- 0aada94: Refuse to replace symlinked project skill folders during built-in skill installs.
- 0aada94: Queued chat messages now run under the model, engine, and reasoning effort they
  were composed with instead of whatever the picker happens to be set to when the
  queue flushes. Queued bubbles also gain a "Send now" control that interrupts the
  active run, and the pending group is labelled with its count.
- 0aada94: Restore a reachable path for the legacy chat-thread `message_count` repair. Databases predating the column left rows at 0, and both `listThreads` and `searchThreads` filter `message_count > 0` in SQL, so those threads never appeared in the sidebar and nothing called the repair anymore.

  `repairLegacyChatThreadMessageCounts` now runs as a name-tracked migration (`_chat_threads_migrations`) in long-lived app processes, so the `thread_data` scan happens once per database and is skipped entirely on every later boot. Serverless isolates do not launch the repair during cold start; operators can run a long-lived maintenance process against an older hosted database without making concurrent functions race the same full-data scan. `MigrationEntry` gained an optional `run` hook for backfills SQL cannot express; it executes before the bookkeeping row is written, so a failed repair stays unrecorded and retries instead of being marked applied against work that never happened.

- 0aada94: Tell the model the expected parameter signature when a raw-JSON-schema action
  rejects its arguments. Previously only Zod-backed actions echoed the expected
  shape, so a model that guessed a wrong enum or type on a raw-schema action got
  no new information, re-sent the same arguments, and tripped the identical-error
  breaker with the write never executed. The repeated-error stop message is now
  written for the user instead of instructing them to fix the tool arguments.
- 0aada94: Report failed batched schema introspection as an error instead of silently treating the database as up to date.
- 0aada94: Reduce agent-chat startup request fan-out by sharing concurrent status, session, model-discovery, and thread-list reads.
- 0aada94: Stop timed-out Neon database statements on the server instead of only abandoning the client request.
- 0aada94: Stop the chat from claiming a tool is running when nothing is running, and stop
  recording interrupted actions as failures. A tool card only spins while a chat is
  actually running — an activity placeholder alone no longer resurrects a spinner
  on rehydrated history, which is how an email that WAS delivered showed as
  perpetually "sending". When a stream ends with a tool still in flight the card is
  now marked with a distinct unknown outcome ("it may or may not have completed")
  instead of a red failure, both live and in the persisted transcript, because
  "absent" and "unreadable" are not the same answer. The alternate runtime path now
  settles its pending tool calls on `done` and on error like the main SSE path does,
  and a turn whose tool never resolved keeps its "Worked for Xm Ys" summary instead
  of rendering a permanent "Thinking" indicator with nothing behind it.
- Updated dependencies [0aada94]
- Updated dependencies [0aada94]
  - @agent-native/toolkit@0.10.11

## 0.15.0

### Minor Changes

- f400c81: Two additions to core:
  - **`AppearancePicker` + `change-appearance` action.** New per-user appearance presets (`warm` / `ocean` / `forest` / `rose` / `slate` + the default) that override the base HSL theme tokens. The runtime reads `localStorage["appearance"]` in the inline theme-init script and sets `<html data-appearance="...">` before hydration, so there's no first-paint flash. Exports: `APPEARANCE_PRESETS`, `applyAppearance`, `getStoredAppearance`, `useAppearance`, `AppearanceSync`, `AppearancePicker`. The agent can change the active preset via the new `change-appearance` core sharing action — auto-registered through `mergeCoreSharingActions`, so every template inherits it.
  - **`guard-extension-no-public.mjs`.** New CI guard wired into `pnpm guards`. Statically refuses any change that drops `allowPublic: false` / `requireOrgMemberForUserShares: true` from the extension shareable registration, or that introduces a string literal / raw SQL flipping an extension row to `visibility = "public"` outside the framework-level `set-resource-visibility` action. `sharing` skill updated to document the two new registration flags and point at the guard.

- b5b6f22: New optional `emptyStateAddon` prop on `AssistantChat` — content rendered in the empty state above the suggestion buttons. Used by `MultiTabAssistantChat` to surface "previous chats for this design" when the current thread is empty but the scope has other threads. No behaviour change when the prop isn't passed.
- 2eb5064: `PromptComposer` + `TiptapComposer`: inline image attachments, attachment-only composer-mode sends, and active-voice cancellation on submit. Image files attached to the composer are now sent inline as `<uploaded-image name=… contentType=…>` data-URL blocks alongside the existing pasted-text / inline-text flattening. Composer modes (`/code`, `/research`, etc.) now also accept submissions with no text when attachments are present — the default prompt becomes "Use the attached context." and the attachments survive the wrap in the mode's prefix + `<context>` block. Every send / build intercept path also cancels any in-flight voice dictation so a late transcript can't land on top of the just-sent message.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` (plus `BuilderConnectFlow` / `BuilderConnectFlowOptions` types) from `@agent-native/core/client`. Both hooks already powered the in-framework SettingsPanel's Builder.io connect flow; surfacing them lets templates reuse the same status read + connect-flow state machine in their own settings UIs without duplicating the SSE / popup-handshake plumbing.
- f400c81: Polish + appearance presets:
  - Sign-in page: add a favicon `<link>` to the onboarding sign-in and reset-password HTML so tabs no longer show the default globe.
  - Sign-in page: suppress the on-screen Google OAuth status overlay ("OAuth exchange redeemed; returning to the app (flow …)" and friends) for end users. Diagnostics still log to the browser console; the overlay can be opted back in with `#oauth-debug` or `?oauth_debug=1` for debugging.
  - Feedback popover: placeholder now leads with concrete examples ("e.g. 'The Send button isn't obvious'…") so users have a clearer prompt than "Tell us what's on your mind…".
  - **New: Appearance presets.** Users can pick a color theme without editing source. Adds a `change-appearance` action (auto-mounted everywhere) that the agent can invoke as a tool, a `<AppearancePicker />` React component for Settings pages, a `useAppearance` / `useAppearanceSync` hook pair, and CSS preset overrides (`warm`, `ocean`, `forest`, `rose`, `slate`) layered on top of each template's base palette via `<html data-appearance="…">`. The theme init script now also applies the stored preset on first paint to avoid FOUC.
  - Agent system prompt now includes a short first-session personalization flow: greet, ask two yes/no questions (theme preset via `change-appearance` plus one template-specific preference), then mark `application_state.personalization = { done: true }` so it never re-asks.

- d1a90ac: Image uploads and drag-and-drop, framework-wide.
  - New `upload-image` agent action — converts a base64 data URL or remote URL into a hosted CDN URL via the active file-upload provider (Builder.io by default, or any provider registered with `registerFileUploadProvider` — S3, R2, GCS, etc.). Auto-registered for every template alongside the sharing actions; the agent now has an explicit tool to materialize chat-attached or generated images as stable URLs for slides, documents, and outbound messages.
  - File-upload registry now uses a `globalThis`-backed singleton. The previous module-level `Map` could be evaluated more than once in some Vite/Nitro bundle-split scenarios — the plugin that called `registerFileUploadProvider()` lived in one module instance and the request handler / server-side pre-upload lived in another, so the call site saw an empty map even though registration succeeded. Custom providers (S3/R2/GCS) and the dev-mode upload path now both see the same map regardless of how the bundler chunked them; Builder.io was unaffected because it has an env-var fallback in `uploadFile()`.
  - Server-side pre-upload of chat image attachments: when a user attaches an image to the agent composer, the framework now uploads it through `uploadFile()` before the model runs and injects a `<chat-image-attachment url="..." />` block at the bottom of the user message. The model still receives the image as multimodal vision content; it just also has the hosted URL to embed in HTML. If no provider is configured, the framework injects a `<chat-image-attachment-upload-error>` block instructing the agent to suggest connecting one.
  - Chat-wide drag-and-drop: the agent sidebar now accepts file drops anywhere on the chat surface (thread, header, composer), not just inside the contenteditable. A "Drop to attach" affordance highlights the chat while files are being dragged over it.
  - Slides drag-and-drop fixes: `/api/assets/upload` now routes uploads strictly through the framework `uploadFile()` provider chain. The previous local-disk path that wrote into `public/uploads/` is gone — it didn't persist on serverless deploys and polluted the source tree on dev runs. With no provider configured, the endpoint returns a clear 503 telling the caller to connect Builder.io (or any registered provider). `listAssets` / `deleteAsset` no longer scan local disk; listing is a no-op for now (until a SQL-backed asset index lands), and deletes go through the provider's own API. Drops anywhere on the slides editor — including the chrome and sidebars — are caught instead of letting the browser navigate to the file; drops outside a placeholder/`<img>` open a popover that hands the image off to the agent chat for the user to describe what to do with it.

- f400c81: Two related additions to the realtime + agent layer:
  - **Per-source change-version primitive.** New `useChangeVersion(source)` / `useChangeVersions(sources)` / `getChangeVersion` / `bumpChangeVersion` exported from `@agent-native/core/client`. Every `recordChange` event carries a `source` and `version`; `useDbSync` now bumps a per-source counter on each event and templates fold the counter into their React Query `queryKey`, so a change to `"dashboards"` only refetches dashboard queries instead of triggering a blanket cache invalidate across the app. Framework-level keys (`action`, `extension`, `application-state`, …) keep their universal invalidate; template data keys (`data`, `dashboards`, `analyses`, `dashboard-views`) no longer do — they react through the per-source counter. Analytics templates updated as the first consumer (CommandPalette / Sidebar / sql-dashboard / AnalysesList).
  - **Scoped chat tabs in `AgentPanel` / `MultiTabAssistantChat`.** New optional `scope?: ChatThreadScope | null` prop on `AgentPanel`. When set, the tab bar partitions per `(storageKey, scope)` so each deck / dashboard / record shows its own thread list, new chats inherit the scope server-side, and the panel renders a "Working on {label}" badge with a Detach button to escape back to the unscoped tab list. Pairs with the server-side `scope_type` / `scope_id` / `scope_label` columns + `setThreadScope` already in `chat-threads/store.ts`.

- ffd3d00: Add first-class workspace app audience metadata with route-level public/protected page access.
- d1a90ac: `ShareButton` now accepts an optional `shareUrlPlaceholder` prop. When the primary `shareUrl` is undefined the popover shows the placeholder inside a subtle dashed-border slot instead of hiding the link section silently. Use it to tell respondents _why_ there's no link yet (e.g. "Publish this form to get a public response link") so the popover doesn't look broken on draft / unpublished resources.
- 5f59f44: Browser tracking now sends a persistent `anonymousId` (visitor ID) and a `sessionId` with a 30-minute idle timeout on every event posted to the Agent Native Analytics `/track` endpoint. Both IDs are stored in `localStorage` and degrade gracefully to NULL when storage is unavailable (private browsing). Unique-visitor and session metrics in the analytics template now have real data to aggregate against; previously these columns were always NULL for anonymous traffic.
- c6defe7: Real-time sync, take 2: per-source change counters.

  The previous attempt — invalidating every active React Query on any non-own change event — caused a request storm on the analytics dashboard (461 pending requests, polls timing out at the 10s abort). This change replaces it with a targeted, default-on mechanism:
  - New `useChangeVersion(source)` and `useChangeVersions(sources)` hooks return an integer that advances every time the server emits an event with that source (`"dashboards"`, `"analyses"`, `"action"`, `"settings"`, `"app-state"`, etc.). `useDbSync` keeps a per-source counter and bumps it from every poll/SSE event it sees.
  - Templates fold the counter into the relevant React Query `queryKey`. When the source advances, the queryKey changes and React Query refetches that one query — no whole-cache invalidate, no fanned-out refetches across unrelated panels. `placeholderData: (prev) => prev` keeps the old data on screen during the refetch so there's no flicker.
  - `useDbSync` reverts to invalidating a small fixed list of framework-internal prefixes (`["action"]`, `["app-state"]`, `["__set_url__"]`, etc.) and no longer touches templates' own data queries. The legacy `queryKeys` option remains in the type signature for backward compatibility but is ignored.
  - Analytics' dashboard / analysis / sidebar / command-palette queries are wired up. Other templates can adopt the same pattern by importing `useChangeVersion` and including it in their query keys; recommended sources include `"dashboards"`, `"analyses"`, `"settings"`, and `"action"` (the agent runner emits `source: "action"` after every successful mutating tool call, so depending on it catches any agent-driven change to the underlying data).

- 5f59f44: New `usePinchZoom` hook exported from `@agent-native/core/client` for canvas-style editors. Wires trackpad pinch (synthesized as `wheel` events with `ctrlKey: true`) and 2-pointer touchscreen pinch onto a scrolling container, with cursor-anchored zoom-to-cursor support and configurable `min` / `max` percentages. The slides template adopts it on the deck-editor canvas; any template with a zoomable surface can drop it in by attaching the returned ref to the scroll container.

### Patch Changes

- d1a90ac: Agent chat: when the user sends a new message after scrolling up to read history, scroll back to the bottom so the new message and reply land in view. Previously the sticky-bottom override (which exists to stop streaming from yanking the viewport) also swallowed direct sends, leaving the user stuck in old history.
- ffd3d00: Emit agent sidebar open-state events so custom toolbar buttons can track when the chat panel opens or closes itself.
- d1a90ac: Local-dev convenience: skip the sign-up wall on a freshly-scaffolded app. When `NODE_ENV=development` and the `user` table has no rows for any email other than `dev@local`, the auth guard transparently signs up + signs in an auto-managed `dev@local` account on the first page GET and 302s back to the original URL with the session cookie set. A developer who just ran `pnpm dev` lands in the app immediately instead of being asked to fill in name + email + password to try the framework. Once a real user signs up via the regular form, the email-filter short-circuit fires and this helper returns null on every subsequent request, so the normal login flow takes over. Set `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` to opt out.
- 5f59f44: Docs only: spell out the auto-refresh contract in the default-template and starter `AGENTS.md` so newly-scaffolded apps know that agent writes must reflect in the UI without a manual refresh. Use `useActionQuery` (auto-covered) or fold `useChangeVersions([<source>, "action"])` into raw `useQuery` keys. Mirror the framework `adding-a-feature` and `real-time-sync` skills into `packages/core/src/templates/default/.agents/skills/` and `templates/starter/.agents/skills/` so scaffolded apps inherit the same guidance.
- d1a90ac: Builder credential resolution: implicit-org fallback + trace logging.
  - `agent-chat-plugin`: when `session.orgId` is null (Better Auth leaves it null until the user explicitly switches orgs), fall back to `getOrgContext()` to pick up implicit org membership. A fresh signup with a domain-matched org now sees its org-scoped Builder credentials instead of looking unconnected.
  - `resolveSecret`: log every Builder credential lookup (`[resolve-secret]` lines covering hit/miss + scope + email + orgId). "I connected Builder but chat says no LLM" reports can now be diagnosed from server logs without rerunning the request. Other keys are gated behind `DEBUG_CREDENTIAL_RESOLVE=1` to keep noise low.
  - `core-routes-plugin` builder-connect: log the resolved write scope so we can see which scope (user/org/workspace) a connect actually persisted to.

- d1a90ac: Add inline "Start new chat" button to no-detail Builder gateway error messages. When the gateway returns `{type:"stop",reason:"error",requestId:...}` with no diagnostic, the error UI now renders a one-click CTA next to the message instead of just telling the user to start a new chat manually. The button dispatches an `agent-chat:new-chat` window event that `MultiTabAssistantChat` listens for, matching the existing close-tab event pattern.
- a89082e: Builder reconnect now clears stale credentials before writing the new connection, so reconnecting with a different Builder space actually takes effect.

  `writeBuilderCredentials` previously upserted each new key but left stale rows in place. Two failure modes:
  - Reconnecting with a Builder space that doesn't carry every optional field (e.g. no `orgName`/`orgKind`/`userId`) left the previous connection's metadata behind at the target scope, so the gateway saw a mix of new and old credentials.
  - When a user's first connect wrote at user scope (member or no-org) and a later reconnect wrote at org scope (now owner/admin), the old user-scope row still won resolution — user scope beats org scope by design — so the chat kept using the old Builder space's credentials even though the UI showed the new connection.

  Fix: before writing, delete all five `BUILDER_*` keys at the target scope, and when writing at org scope also delete the writer's user-scope rows. The org-scope row is intentionally left alone when writing at user scope so a single user's personal override doesn't blow away the team's shared connection.

  Reported as "I signed in again with my Builder space not my own one and still telling me I need to upgrade" on 2026-05-11.

- d1a90ac: `builderFileUploadProvider`: retry transient 5xx once with backoff (600ms then 1.8s).

  Builder.io's upload service occasionally returns a bodyless 500 ("Internal Error") on the first attempt — usually GCS write hiccups that succeed on retry. Three template surfaces that hit this on every recording / upload (Clips finalize, attachment uploads, generated-image uploads) now get those transient failures absorbed silently. Deterministic 500s still surface to the caller after the third attempt with the original status + body.

- ad4f135: Keep the in-app agent panel active inside Builder web previews instead of treating them as local dev frames.
- ffd3d00: Recover the agent panel automatically when assistant-ui renders a stale list index.
- ffd3d00: Clarify scoped chat context copy in the assistant sidebar.
- 64792af: Clarify Builder Cloud Agent waitlist guidance so agents do not send users to nonexistent org settings.
- d1a90ac: CLI + dispatch shell fixes from create-workflow feedback:
  - `create`: scaffold `packages/pinpoint` when the user selects `slides` or
    `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
    `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
    `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers
    every template with `@agent-native/*` workspace deps so a regression
    surfaces in CI instead of on the user's machine.
  - `create`: per-template progress messages during scaffolding
    (`Scaffolding Slides (3/4)...`, `Adding shared packages...`) and a
    concrete "this is done" stop message, replacing the single static
    "Working... no action needed" line that made a multi-app workspace
    feel hung.
  - `create`: detect `pnpm` on PATH before printing the outro. If it's
    missing, the next-steps block now leads with `npm install -g pnpm`
    instead of dumping the user at `zsh: command not found: pnpm`.
  - `create`: Dispatch is now always scaffolded into a new workspace
    rather than being a recommended-but-optional pick. The picker only
    lists the optional apps; the workspace note explains that Dispatch is
    always included as the control plane. `--template=forms` (or any
    non-Dispatch list) still works — Dispatch gets unioned in. New
    regression test asserts this.
  - Auth guard: local-dev convenience for `NODE_ENV=development`. When
    the `user` table has no real users yet, the first unauthenticated
    page GET transparently signs up (and signs in) a `dev@local` account
    and 302s back to the requested URL, instead of showing the sign-up
    form. A developer running `pnpm dev` lands straight in the app. Once
    any real account exists the auto-create short-circuit fires and the
    regular login flow takes over. Opt out with
    `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`. Production is unaffected.
  - `DispatchShell`: page-title info icon is now a click-driven Popover
    instead of a hover-only Tooltip, and the trigger button has a
    proper hover background so it reads as clickable. Clicking the icon
    (the natural gesture, and the only available one on touch) did
    nothing before.
  - `create`: clean up the partially-scaffolded directory when scaffolding
    fails (e.g. flaky network during the template download). Without this
    the first failure left the workspace dir on disk, and the next
    `agent-native create <name>` rejected the same name with "Directory
    already exists" — forcing a manual `rm -rf` before retrying.
  - Dispatch apps list: filter dotfile directories (e.g.
    `.agent-native-tmp-*` extraction sidecars) when reading the
    workspace's `apps/` directory. The temp dir is a sibling of the
    target so it appeared at the top of the apps grid mid-scaffold,
    looking like a stray entry.
  - Dispatch onboarding: register a "Create your first app" step at order
    5 so it sits above the Slack/Telegram secret-onboarding steps. A
    brand-new workspace was leading with "Connect Slack" before the user
    had even added an app, which felt confusing.
  - Agent system prompt (chat-in-browser-on-localdev): when a user asks to
    scaffold a new workspace app from a localhost browser tab, point them
    at \`npx @agent-native/core@latest add-app\` first since they're already in
    that terminal. The desktop / Claude Code / Codex / Builder.io
    alternatives still follow for general source-editing work.

- ffd3d00: Add Cmd/Ctrl+Backslash as a global shortcut for toggling the agent sidebar.
- 04c3ed9: Coach users through stalled agent tasks with clearer troubleshooting and next-step guidance.
- b5b6f22: `TiptapComposer`: when a caller passes a custom `actionButton`, render only the model selector + plan-mode toggle on the left side (skipping the voice/file/send cluster that the default action-button slot owns). Without this, callers that already render their own send button got a duplicate-looking trailing block. No behavior change when `actionButton` isn't passed.
- 2eb5064: `AssistantChat`: hide the empty user-message bubble when the text content is nothing but an injected `<context>...</context>` block. Previously, sending an attachment-only composer-mode message (e.g. `/code` with a file but no prose) rendered an empty grey bubble in the chat after the context tags were stripped. The message now skips the bubble + expand/collapse UI entirely when the only attachment is context; attachment chips still render above.
- 2eb5064: `useDbSync` + server poll: per-key invalidation for application_state one-shot commands. The poll loop now emits one event per changed (key, owner) pair instead of a single `key: "*"` wildcard, and the client only invalidates `navigate-command` / `show-questions` / `__set_url__` queries when those specific keys actually change. Noisy app-state keys (template-specific UI state, per-tab flags) no longer wake the navigation / question readers on every poll cycle.
- 2eb5064: `useVoiceDictation`: cancelling while the transcription request is in flight now actually drops the response. Previously `cancel()` returned early for any state other than `recording` / `starting`, so once the network POST started, a cancel click was a no-op and the transcribed text would still be inserted into the composer after the user cancelled. The fetch handlers (both success and live-snapshot fallback) now check `cancelledRef` immediately after the await and bail without forwarding.
- 64792af: Keep Builder connect popups from replacing the Agent Native desktop webview.
- ddcc773: Raise shadcn floating-UI primitives (Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Tooltip, HoverCard, ContextMenu, Menubar, Select) from `z-50` to `z-[250]` so modal overlays cover the agent sidebar header (`z-[240]`). Fixes the case where the "Add Calendar" (and similar) modal opens but the agent chat panel underneath stays visible and interactive.
- f400c81: Add `create-pylon-ticket` action to Dispatch for escalating blockers, unmatched `#customer-*` routing, or follow-ups that need tracking — uses `PYLON_API_KEY` from the Vault. Instrument the agent chat with Sentry captures when the auth-error card stays visible past auto-recovery (`auth_error_card_stuck`) and when SSE reconnect times out (`reconnect_no_progress`) so we can chase the "occasional Reload UI required" symptom.
- b7e7d17: Route the Dispatch thread debugger through workspace root aliases.
- 04c3ed9: `workspaceAppRouteAccessFromPackageJson` now returns optional `publicPaths` / `protectedPaths` so consumers can distinguish "field absent" from "field explicitly empty." `workspace-deploy`, `workspace-dev`, and `agent-discovery` prefer the package.json value whenever it was set (even `[]`), so an app owner can clear an inherited manifest override by writing `"publicPaths": []` in its `package.json`.
- f400c81: Restrict extensions to private/org sharing only — extensions execute code in
  the viewer's authentication context, so they must never be `visibility: "public"`
  and user shares must target someone already in (or invited to) the org.
  - Added `allowPublic` and `requireOrgMemberForUserShares` flags to
    `registerShareableResource()`. Defaults match prior behavior; extensions
    opt into both.
  - `set-resource-visibility` rejects `"public"` for any resource registered
    with `allowPublic: false`. `accessFilter` and `resolveAccess` treat any
    stored `'public'` row as private for those resources (defense in depth).
  - `share-resource` verifies the principal email against `org_members` and
    pending `org_invitations` when `requireOrgMemberForUserShares: true`. The
    same flag also pins `principalType: "org"` shares to the resource's own
    org — cross-org org-principal shares would otherwise let an outside org's
    members run extension code in the viewer's auth context (same threat
    model as a public extension).
  - `updateExtension` and the extension `PUT` route refuse `visibility: "public"`
    directly. `list-resource-shares` returns a `policy` block so the share
    popover hides the "Public" option and shows server errors inline.
  - New `scripts/guard-extension-no-public.mjs` (wired into `pnpm guards` /
    `pnpm prep`) statically enforces that the extension registration keeps
    both flags set, and refuses `visibility: "public"` literals inside
    `packages/core/src/extensions/`.

- d1a90ac: Fixes for feedback from QA pass:
  - **Content** (`templates/content`): deleting the page you're currently viewing now navigates to the landing page **before** the delete round-trip resolves, so the editor doesn't sit on a now-deleted page while the request is in flight. The page-id route also redirects to `/` when the document fetch returns 404, so refreshing on a stale URL no longer dead-ends at "Document not found".
  - **Design** (`templates/design`): clicking the Edit tab no longer auto-collapses the agent chat. Previously, entering edit mode dispatched `agent-panel:close` so the EditPanel and canvas could share the screen, but the chat dropping out shifted the toolbar and removed the user's working context. Properties and chat now coexist as adjacent right-side panels.
  - **OrgSwitcher** (`packages/core`): clicking "Create organization" or "Invite member" now clears any leftover input from a previous session before entering that mode. Previously, the create form could re-open prefilled with the just-created org's name, making the switcher look like a create dialog for the new org.

- d1a90ac: Several feedback fixes:
  - **Dispatch back-button to `/dispatch/dispatch/overview`.** `dispatchNavLinkTarget` (the helper that decides whether NavLink should manually prepend the workspace mount prefix) read `window.__reactRouterContext.basename` to detect the router's basename. If that global wasn't set yet at render time, the helper double-prefixed the `to` prop, the router then prepended its own basename, and the resulting `/dispatch/dispatch/<route>` landed in browser history — clicking back from any dispatch page later took the user to that 404. The helper now mirrors `entry.client.tsx`'s basename calculation directly from `window.location.pathname`, removing the context-global race. `routerPath` (in both the package and the template copy) also iteratively strips the basename so any doubly-prefixed path that snuck into `application_state.navigate` doesn't get partially-stripped here and re-prefixed by the router back to the bad URL.
  - **"Use Builder" CTA stuck after connect (web).** The Builder upsell CTA in `AgentPanel` opens Builder in a `<a target="_blank">` tab, not a popup, so it never started the `useBuilderConnectFlow` polling loop — `useBuilderConnectUrl` was fetched once on mount and never refreshed, leaving the CTA in the "Use Builder" state after the user came back to the original tab. The callback success HTML now posts a `builder-connect-success` BroadcastChannel + window.opener message (mirroring the existing error-path broadcast), and `useBuilderConnectUrl` listens on BroadcastChannel + `window.message` + `focus` + `visibilitychange` + the existing `agent-engine:configured-changed` event, refetching `/builder/status` on any of them. Also dispatches `agent-engine:configured-changed` when status first reports configured so the rest of the chat tree updates without a full reload.
  - **Firebase `auth/popup-blocked` in desktop Builder connect.** Builder's `/cli-auth` page signs into Google via `signInWithPopup`, which calls `window.open()`. Inside the Electron OAuth `BrowserWindow` we create for the Builder flow, there was no `setWindowOpenHandler`, so Electron's default silently blocked the popup — Firebase reported `auth/popup-blocked`, the parent OAuth window never received the result, and the user saw a blank screen that then closed. The OAuth window now returns `action: "allow"` for https child popups and constructs the child as another `BrowserWindow` sharing the same `session` so Firebase's `window.opener.postMessage` handshake reaches back.
  - **`resolveScopedBuilderCredential` tracing.** The Builder credential lookup walked user → org → workspace silently; when "I connected Builder but chat says use Builder" reports come in, there was no way to tell which scope answered or whether none did. Each branch now logs the scope, email, orgId, and hit/miss outcome (matching the existing always-on tracing in `resolveSecret` for BUILDER\_\* keys).

- ffd3d00: `forkThread` now overlays the in-memory snapshot on top of the persisted row when the snapshot is fresher (more messages) than what's in SQL. Previously, once any version of the source row existed in the database, the snapshot was ignored — so forks could lose the latest unflushed user message, which is exactly the scenario chat-fork-from-unflushed is meant to fix. Guarded with `snapshot.messageCount > stored.messageCount` so a stale snapshot from another tab can't clobber a fresher persisted row.
- ffd3d00: `AgentPanel` no longer emits a synthetic `{ open: false }` sidebar-state event on mount when the parent frame owns the sidebar. The dispatch is now deferred until the frame sends its first `agentNative.sidebarMode` message, so listeners initialize with the real state instead of seeing a false → true flip a moment later.
- 64792af: Avoid double-submitting Builder chat prompts from embedded app composers by using a single iframe transport when a parent frame is available.
- 9c991e1: Keep Builder preview Google sign-in from returning to loopback preview URLs.
- ce9e355: Open primary Google sign-in from Agent Native Desktop through the desktop exchange flow so OAuth can complete in the system browser.
- ce9e355: Add LLM connection context to tracking events and track Builder connect clicks.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` from `@agent-native/core/client` so template settings pages can render a connect-builder button that polls for completion instead of a bare `<a target="_blank">` link.
- 1fd5856: Allow owners to manage legacy unscoped shared resources after joining an organization.
- d1a90ac: Org polish:
  - `InvitationBanner`: while a join-by-domain or accept-invitation request is in flight, render an in-place "Joining {orgName}…" status so the chat panel doesn't look unchanged until the view abruptly swaps.
  - `OrgSwitcher`: `settingsPath` is now optional. When unset, "Workspace settings" only opens the in-sidebar settings panel — suitable for templates without a dedicated team page. Templates that mount one (e.g. Dispatch's `/team`) pass it explicitly.
  - `useOrgMembers` / `useOrgInvitations`: scope the React Query cache by active `orgId` so switching/creating an org forces a fresh fetch instead of briefly showing the previous org's members.
  - `useCreateOrg`: invalidate all queries on success (creating an org switches into it server-side, so every org-scoped query is stale), matching `useSwitchOrg`.
  - Create/invite forms: loader uses flex centering so the spinner stays vertically centred inside the button; close the create-org dialog via the unified `handleOpenChange` so cleanup runs.

- ce9e355: Add app navigation links to the organization switcher, with Dispatch pinned as the workspace hub.
- ffd3d00: Standardize the organization switcher settings link around template team pages.
- ad4f135: Use polling file watchers for workspace dev in managed remote containers to avoid Linux inotify limits.
- 64792af: Recover auth sessions when stale duplicate cookies shadow a fresh sign-in.
- b7e7d17: Hide agent-created scratch resources from workspace file lists by default.
- 64792af: Recover the agent chat message list when assistant-ui briefly renders a stale message index.
- ad4f135: Seed shadcn-aware frontend design skills in generated apps and workspaces.
- 13284b1: ErrorBoundary: "Go home" now triggers a full page reload (was client-side
  `<Link>`), so a signed-out visitor who lands on an error page is taken
  through the server auth guard's sign-in flow instead of getting stuck on
  a logged-in route with failing API calls. Also softens the 404 message
  to a plain "We couldn't find this page." for end users — the previous
  copy mentioned Dispatch and "shipping" routes, which only made sense to
  developers working on workspace apps.
- ffd3d00: Make chat forking work when the source thread has not flushed to SQL yet.
- ffd3d00: Redirect mounted Dispatch workspace roots to the overview page across workspace deploy presets.
- 04c3ed9: Surface workspace app startup timeouts instead of looping forever on the gateway wake screen.
- ce9e355: Send a larger default output-token budget through the Builder gateway so long Plan Mode responses do not inherit a short gateway default.
- ce9e355: Scope agent chat screen and URL context to the originating browser tab.
- d1a90ac: Fix Builder "Upgrade at builder.io" link in chat dropping users on `/app/projects` instead of billing. The link previously deep-linked to `/app/organizations/<BUILDER_ORG_NAME>/billing`, but `BUILDER_ORG_NAME` is the org's display name (e.g. `Nicholas kipchumba Space`), not a URL-safe slug — Builder's router didn't recognize it and silently redirected to `/app/projects`. The CLI-auth callback doesn't expose an org slug or id today, so the link now always points to `https://builder.io/account/billing`, which resolves the active org from session.
- d1a90ac: Promote `upload-image` to a core sharing action: register it in `mergeCoreSharingActions` so every template inherits the agent-callable image-upload tool without each app having to re-declare it in `actions/`.
- ce9e355: Default Dispatch vault access to all workspace apps, add manual grant mode, sync vault keys into encrypted app secrets, and fix org-scoped vault listing.
- ce9e355: Save generated workspace app descriptions, make Dispatch app metadata editable, and include workspace app names/descriptions in A2A agent context.
- ce9e355: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- 64792af: Show workspace dev child-process failures on the startup page instead of hiding them behind a generic reload loop.
- d1a90ac: CLI: probe each app's port before spawning Vite so the workspace dev server doesn't die on a single port conflict. `pnpm dev` previously assigned each app a fixed port (`8100`, `8101`, …) and spawned Vite with `--strictPort` for the gateway routing; if anything on the host already owned that port, Vite failed hard before the gateway could route around it. The workspace now binds a probe TCP socket on each candidate port before commiting to it, increments past collisions, and logs the substitution. The same probe runs in the live filesystem-sync path so a newly-scaffolded app added with `agent-native add-app` doesn't trip on a busy port either. Includes a related CLI scaffolding spinner tweak — the per-app message now distinguishes "Downloading X template…" (slow GitHub fetch) from "Configuring X…" (fast local rewrite) so users don't watch a frozen "Scaffolding…" message during the network step. `runWorkspaceDev` is now async (returns `Promise<WorkspaceDevHandle>`); the two in-tree callers already chained `.then()`, so no external API change.
- ce9e355: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.
- ad4f135: Keep workspace OAuth and app URL resolution on configured public origins before falling back to local workspace gateways.
- b7e7d17: Allow the Workspace tab to load without desktop code access.

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

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
