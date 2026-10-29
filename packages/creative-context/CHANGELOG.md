# @agent-native/creative-context

## 0.8.62

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.61

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.60

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.59

### Patch Changes

- Release all public npm packages with a patch version bump.
- 2e8f454: Compile with `noImplicitOverride` and `noFallthroughCasesInSwitch`, and, where the code already passes them, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Optional fields that legitimately hold `undefined` are now typed `T | undefined`. No runtime behavior changes.

## 0.8.58

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.57

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.56

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.55

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.54

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.53

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.52

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.51

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.50

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.49

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.48

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.47

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.46

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.45

### Patch Changes

- 1b84641: Scope creative-context state refreshes to its application-state key, so unrelated state changes do not rerender consumers.
- Release all public npm packages with a patch version bump.

## 0.8.44

### Patch Changes

- Release all public npm packages with a patch version bump.
- 0cfbd4d: Include the MIT license text in the published package.

## 0.8.43

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.42

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.41

### Patch Changes

- 62cc000: Add the missing `notified_at` column to share tables created before it existed
  (`tool_shares`, `data_program_shares`, and the creative-context share tables).
  Share inserts name that column, so sharing an extension, data program, or
  creative context with a user or org failed on those databases.
- Release all public npm packages with a patch version bump.

## 0.8.40

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.39

### Patch Changes

- 1c4a192: Use authored synthetic fixtures for imported creative context evaluation.
- Release all public npm packages with a patch version bump.

## 0.8.38

### Patch Changes

- 128f43e: Export a shared `AgentMark` icon for agent identity and use the same mark in the creative context panel.
- Release all public npm packages with a patch version bump.

## 0.8.37

### Patch Changes

- 853e988: Serialize create-provenance writes across instances to prevent duplicate context records.
- Release all public npm packages with a patch version bump.
- 72e4ca7: Use descriptive titles for the Figma connector visual fixture tests.

## 0.8.36

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.35

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.34

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.33

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.32

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.31

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.30

### Patch Changes

- 263c8a9: Keep corrupt Lab choices isolated to their own state reads.
- Release all public npm packages with a patch version bump.

## 0.8.29

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.28

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.27

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.26

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.25

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.24

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.23

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.22

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.21

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.20

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.19

### Patch Changes

- d798d36: Stop running the creative-context due-job sweep and daily maintenance enqueue at serverless cold start. Production serverless runtimes now process queued imports and background jobs from the platform-scheduled recurring sweep, scan for daily maintenance hourly, and warn when no platform scheduler drives the sweep; local and long-running Node servers keep the in-process timers. The `@agent-native/core` peer range now requires `>=0.190.0`, the first release exporting every core API this package imports.
- Release all public npm packages with a patch version bump.
- 2f6f67d: Make Creative Context schema migrations safe to retry after partial application.

## 0.8.18

### Patch Changes

- Release all public npm packages with a patch version bump.
- d2ba564: Keep agents from repeating completed mutations, stale reads, disabled features, or oversized discovery searches, and let them summarize cleanly when a loop is stopped.
- b8845eb: Scope ownable reads and writes to their authorized user, organization, or share.

## 0.8.17

### Patch Changes

- Release all public npm packages with a patch version bump.
- a20f0b4: `CreativeContextPanel` and `createCreativeContextAgentTab` accept `variant: "settings"`, which drops the panel's own title, description, and page padding when the redesigned Settings page already shows them.

## 0.8.16

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.15

### Patch Changes

- Release all public npm packages with a patch version bump.
- ed3801e: Remove nonessential source comments.

## 0.8.14

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.13

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.12

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.11

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.10

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.9

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.8

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.7

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.6

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.5

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.4

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.3

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.2

### Patch Changes

- 421910f: Return deterministic client errors for disabled Creative Context and preserve the singular app-role setter for existing integrations.
- Release all public npm packages with a patch version bump.

## 0.8.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.8.0

### Minor Changes

- 24ed917: Add a default-off Creative Context lab and keep What's new in its own settings group.

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.25

### Patch Changes

- fba0dbc: Let a host declare the role that recording generation provenance requires, so drafting in a resource you can only read no longer fails on its own provenance write.
- Release all public npm packages with a patch version bump.
- bd3e96e: Use the shared serverless Chromium runtime for Design exports and copy it for apps that declare Playwright directly.

## 0.7.24

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.23

### Patch Changes

- a53a789: Clean up and streamline the Creative Context share tab interface.
- Release all public npm packages with a patch version bump.

## 0.7.22

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.21

### Patch Changes

- cb3a95f: Add opt-in canonical organization federation across Agent-Native app deployments.
- Release all public npm packages with a patch version bump.
- cc2a915: Standardize framework persistence on PostgreSQL. Local development uses PGlite,
  hosted deployments use PostgreSQL, and the database client, schema, migrations,
  templates, docs, and tooling now target PostgreSQL directly.

## 0.7.20

### Patch Changes

- 345fcd7: Allow signed Creative Context background processors to bypass session auth and
  cover both processor HMAC routes.
- Release all public npm packages with a patch version bump.

## 0.7.19

### Patch Changes

- 56404c7: Restore Creative context as a Share tab and compact its submission controls.
- Release all public npm packages with a patch version bump.

## 0.7.18

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.17

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.16

### Patch Changes

- 1f8e13c: Route managed Google OAuth through the provider-aware root callback on standalone apps.
- Release all public npm packages with a patch version bump.

## 0.7.15

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.14

### Patch Changes

- 4776e61: Reduce CI lint warnings across publishable packages.
- Release all public npm packages with a patch version bump.

## 0.7.13

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.12

### Patch Changes

- db91905: Standardize Agent-Native product naming while preserving compatibility aliases for existing releases and profiles.
- Release all public npm packages with a patch version bump.

## 0.7.11

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.10

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.9

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.8

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.7

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.6

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.5

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.4

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.3

### Patch Changes

- baedb60: Fetch the headless browser at launch instead of embedding it in every serverless function. `@agent-native/creative-context` now depends on `@sparticuz/chromium-min` (46KB) rather than `@sparticuz/chromium` (66.4MB), and passes a version-pinned pack URL to `executablePath()`. The hosted Builder Browser path is unchanged and still preferred; this only affects the local-launch fallback, which now downloads the pack once per container. Set `AGENT_NATIVE_CHROMIUM_PACK_URL` to serve the pack from your own mirror. Measured on slides: server function 126.0MB → 59.6MB, total upload 243.8MB → 111.0MB.

## 0.7.2

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.7.1

### Patch Changes

- 10de7b9: Remove unused imports and unreachable declarations. Dispatch drops unused
  imports from its layout, transactional email pages, and MCP gateway;
  creative-context drops unused type imports and an unread `headingStyle`;
  recap-cli drops the `node:os` import and two unread locals; skills drops the
  unreferenced `maybeUpdateInstructions` helper; toolkit drops unused imports and
  an unread `REALTIME_VOICE_REQUEST_SOURCE`. No runtime behavior changes.
  `eslint/no-unused-vars` is now an oxlint error instead of a warning, so CI
  blocks new ones.

## 0.7.0

### Minor Changes

- 39383b5: designs can be generated using creative context

## 0.6.6

### Patch Changes

- 4c7c289: Keep browser-rendered website style extraction working when the shared evaluator
  is bundled before it is serialized into Chromium.

## 0.6.5

### Patch Changes

- b3b4580: Normalize commenter access to the read-only creative-context role contract.

## 0.6.4

### Patch Changes

- 9204f85: Fix the Context tab's dropdown in the Share dialog rendering invisibly behind the host popover and dismissing the whole dialog on interaction. The select now matches the popover's nested-overlay z-index and is marked so `ShareButton` doesn't treat clicks inside it as outside clicks.

## 0.6.3

### Patch Changes

- 25f588e: Redirect legacy `/agent` management URLs to the canonical settings routes and preserve app-owned settings tabs.

## 0.6.2

### Patch Changes

- e177059: Restore the serverless Playwright fallback so production URL extraction can use packaged Chromium.

## 0.6.1

### Patch Changes

- aa24c7e: Use the declared optional Playwright runtime through a literal import so Cloudflare deployments can apply their fail-closed browser stub.
- 9d8ae68: Run website brand extraction in an isolated real browser through the SSRF-safe network proxy, with serverless Chromium support and an explicit static fallback.

## 0.6.0

### Minor Changes

- abb0cf5: Add a shared browser-rendered website design-system extraction surface with computed visual tokens, component evidence, and bounded design.md summaries.

## 0.5.12

### Patch Changes

- 2765110: Avoid database migrations and recurring sweeps during durable background cold starts.

## 0.5.11

### Patch Changes

- c71d383: Include the shared creative-context and toolkit updates in the next package release.

## 0.5.10

### Patch Changes

- d6e7c5c: Stop a second Chromium from being downloaded alongside the one already on disk.

  First-party workspace packages now take Playwright from an exact catalog pin, so
  a caret cannot resolve forward to a release tied to a different Chromium
  revision. The two packages that declare Playwright as a published optional
  dependency — `@agent-native/creative-context` and `@agent-native/recap-cli` —
  deliberately keep a caret range instead: an exact range in a library stops a
  consumer who already has a different Playwright from deduping, which forces a
  nested copy and downloads exactly the second browser this change exists to
  avoid.

## 0.5.9

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
