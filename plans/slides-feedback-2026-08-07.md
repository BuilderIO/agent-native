# Slides feedback triage — 2026-08-07

Source: user feedback deck (6 screenshots) covering the first-run onboarding,
new-deck wizard, a failed generation run, and the Google Slides export.

Each item below was checked against real code. Status is one of
**Fixed**, **Confirmed / not fixed**, **Not reproducible from code**, or
**Product decision**.

---

## 1. Model selection defaults to the cheapest OpenAI model with no explanation

**Report.** "How is the model chosen? As a regular Claude user, I'm curious why
the system defaults to Luna." Wants task-aware defaults (the slides app should
default to whichever model is best at decks), plus an info bubble explaining the
choice or an explicit Good/Better/Best tier.

**Status: Product decision — behaves as designed, the design is the complaint.**

- The default is a hardcoded framework constant, not a heuristic:
  `FRAMEWORK_DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"` in
  `packages/core/src/agent/model-config.ts:245-257`, surfaced as `DEFAULT_MODEL`
  (`:357-359`).
- Resolution order at the composer is: persisted user selection →
  `DEFAULT_MODEL` (`packages/core/src/client/use-chat-models.ts:97-109`,
  `:233-295`). Nothing looks at the task or the app.
- The `$ / $$ / $$$` badges are a hardcoded name-substring heuristic, not real
  cost data: `MODEL_COST_TIERS` in
  `packages/toolkit/src/composer/TiptapComposer.tsx:984-1014`, mirrored by
  `MODEL_COST_ORDER` in `packages/core/src/client/chat-model-groups.ts:60-83`.
- **A per-app override already exists and slides does not use it.**
  `packages/core/src/agent/app-model-defaults.ts:80-201` stores an org-then-user
  default keyed `agent-app-model-default:<appId>`, and the request path already
  consults it ahead of the global engine setting
  (`packages/core/src/agent/engine/registry.ts:1160-1194`). It is editable over
  `/_agent-native/agent-model-defaults`
  (`packages/core/src/server/agent-chat-plugin.ts:3921-4010`). No slides code
  references it.
- No tooltip or info affordance exists on the picker
  (`TiptapComposer.tsx:1186-1205`, dropdown `:1328-1482`).

**Proposed (needs approval — this is UX, and the picker is already dense).**
Set a slides app default through the existing `app-model-defaults` store rather
than building new machinery, and attach the "why" to the *existing* selected-row
affordance instead of adding a visible info bubble. Tradeoff: an app-level
default silently overrides the framework default for everyone in the org, so it
needs to be visible somewhere in settings.

---

## 2. "Connect" on the Notion card in first-run onboarding did nothing

**Report.** On "This app is an agent." → Agent integrations, clicking **Connect**
on Notion produced no visible response.

**Status: Not reproducible from code — needs a browser repro.**

- Step: `packages/core/src/client/onboarding/FirstRunOnboarding.tsx:535-638`.
- Button + handler: `:853-903` (button) and `:197-266` (`connectIntegration`).
- Notion is catalogued as `authMode: "oauth"`, `connectionMode: "oauth"`,
  `availability: "ready"`, with no `supportsOrganizationScope`
  (`packages/core/src/client/resources/mcp-integration-catalog.ts:173-189`), so
  it takes the OAuth branch and calls `navigateToMcpOAuthStart(...)`, which
  schedules `window.location.assign(url)` (`:957-968`).

The only silent paths are the early return when the card is already connected or
busy (`:204-209`, with the button disabled in that state at `:893-895`). What
the code *cannot* rule out is the failure the screenshot is consistent with:
`navigateToMcpOAuthStart` gives no spinner, no toast, and no error, so if the
OAuth start URL 4xxs or the navigation is blocked, the click is
indistinguishable from a no-op. **That absence of feedback is the defect worth
fixing even if the underlying navigation usually works.** Not fixed here because
the right fix (pending state + surfaced error) is a UX change on a screen the
user already found busy.

---

## 3. Reference decks: no variety, no "no reference deck" option

**Report.** Expected more reference deck choices or an explicit "none".

**Status: Confirmed, partially a data problem — not fixed.**

- Step: `templates/slides/app/components/editor/NewDeckReferenceStep.tsx:82-105`,
  `:271-383`, `:492-505`.
- The design-system list is **not** hardcoded to Builder.io Official. It comes
  from `useDesignSystems()`
  (`templates/slides/app/hooks/use-design-systems.ts:15-24`) → the
  `list-design-systems` action
  (`templates/slides/actions/list-design-systems.ts:36-156`), which returns
  accessible DB rows. "Builder.io Official" was the only option because it was
  the only row in that workspace, not because the UI restricts it.
- The reference-deck select is deck-backed (starred decks, then other decks,
  then recents, `NewDeckReferenceStep.tsx:298-383`). There is **no explicit
  "none" item.**
- "None" *is* reachable, just not labelled: **Skip** passes explicit nulls
  (`FirstDeckOnboardingFlow.tsx:252-257` →
  `startGeneration(promptFiles, { designSystemId: null, referenceDeckId: null })`),
  and the defaults only kick in when the field is `undefined`
  (`actions/create-deck-generation.ts:217-228`, `actions/create-deck.ts:286-292`).

**Proposed.** Add a "No reference deck" item to the existing select rather than
another button — the capability is already wired, only the label is missing.
Tradeoff: it makes Skip and "None + Continue" two paths to the same outcome.

---

## 4a. Run failed with `run_budget_exhausted` after 12m 20s

**Status: Working as designed.** The message is deliberate and the failure is
honest — `packages/core/src/agent/run-loop-with-resume.ts:584-615` sends
`{ type: "error", errorCode: RUN_BUDGET_EXHAUSTED_ERROR_CODE, recoverable: false }`,
mirrored in `packages/core/src/agent/production-agent.ts:6626-6632`. The chat
row is terminalized correctly by
`packages/core/src/agent/run-manager.ts:1385-1510`. No bug here.

## 4b. The run indicator kept spinning ("1 active run") for about an hour

**Report.** "If it hits an error it can't solve I expect it to stop or time out.
It ran for like an hour just spinning."

**Status: FIXED.**

Two independent systems: the chat's `agent_runs` row (correctly terminalized,
above) and the tray's `progress_runs` row, which the agent opens with
`manage-progress start` and is expected to close itself. A run that dies on
budget exhaustion never reaches its `complete` call, so the `progress_runs` row
stays `running`.

There *is* a server-side stale sweep — `cancelStaleRunsForOwner`
(`packages/core/src/progress/store.ts:240-273`) cancels rows untouched for 5
minutes — but it only runs inside `listRuns`
(`packages/core/src/progress/store.ts:308-339`). Slides mounts the tray with
`<RunsTray pollMs={0} />`
(`templates/slides/app/components/layout/Header.tsx:71`, same in
`EditorToolbar.tsx:1108`, and in analytics and design), so `listRuns` is only
called on mount and on a `runs` change event — and an abandoned run emits
neither. The spinner had no path back to a terminal state short of a reload.

**Fix** (`packages/core/src/client/progress/RunsTray.tsx`): poll while a run
still reads as active, even when idle polling is disabled. Idle cost stays zero,
which is what `pollMs={0}` was protecting; within ~5 minutes the server sweep
cancels the row and the spinner stops. Fixed for every template at once rather
than by flipping `pollMs` in slides alone.

Regression cover: two tests in `RunsTray.spec.tsx` — one asserts an active run
keeps refetching under `pollMs={0}`, one asserts an idle tray does not poll. The
first was verified to fail against the pre-fix code.

---

## 5. "Export to Google Slides" downloaded a PPTX instead of creating a Drive file

**Report.** Chose Export → Export to Google Slides; got a macOS Save As dialog
for a `.pptx`. Google Workspace was connected earlier in the flow. Tried twice.

**Status: FIXED (the reporting; the underlying Drive failure still needs the
user's account state).**

Note this is a **repeat-shaped report**: native Drive creation shipped
`changelog/2026-07-28-export-to-google-slides-now-creates-the-deck-directly-in-you.md`
and connect-from-the-export-menu shipped `2026-07-29-...`. Nine days later a
user reports the pre-July-28 behavior. That is the signature of a silent
fallback, not a missing feature.

The Drive path is real and is wired up:
`templates/slides/app/pages/DeckEditor.tsx:1073-1082` →
`exportDeckToGoogleSlides` (`app/lib/export-google-slides-client.ts:29-66`) →
`server/routes/api/exports/google-slides.post.ts:22-89`, which uploads with
`mimeType: "application/vnd.google-apps.presentation"` and returns a
`webViewLink`.

The defect was the reporting. On *any* non-OK response the client downloads the
PPTX and returns `{ url: null, downloaded: true, reason }`
(`export-google-slides-client.ts:59-66`) — and `ExportMenu.tsx:126-131` then
logged the reason to the console and raised a **success** toast, "Downloaded for
Google Slides". The server's real diagnostics never reached the user: 401
unauthorized, 409 `"No connected Google account."`, or a 502 carrying the actual
Google Drive error message
(`google-slides.post.ts:22-27`, `:48-54`, `:80-87`).

This is exactly the failure mode `AGENTS.md` names: a coercion that returns a
value the caller cannot distinguish from success, so every layer above it
reports something confidently wrong.

**Fix** (`templates/slides/app/components/editor/ExportMenu.tsx`): the fallback
now raises a warning toast carrying the server's reason alongside the existing
import hint. A user whose Google account is not actually connected will now be
told so, and the export menu already has a **Connect Google** action
(`ExportMenu.tsx:145-194`).

---

## 6. Title slide: title text overlaps the subtitle

**Report.** "ARR Data Infrastructure" overlapping "From customer grain to
product-grain growth accounting", consistently in both the app and Google
Slides.

**Status: Confirmed in one export path, NOT reproduced in the renderer — not
fixed, needs the actual deck.**

Skeptical read of the two halves of this report:

- **In-app overlap: not explained by the renderer.** Title slides are ordinary
  centered flex, not absolutely positioned
  (`app/components/deck/SlideRenderer.tsx:46-49`, `:677`, `:847-873`), and
  autofit measures real bounds before scaling
  (`SlideRenderer.tsx:247-320`). Normal flow cannot self-overlap. The likely
  source is the generated slide HTML itself (absolute positioning or negative
  margins the agent emitted), which cannot be confirmed without the deck.
- **Exported overlap: a real, provable bug exists** in the *server* export
  action, `templates/slides/actions/export-pptx.ts:335-369`:
  `const lineCount = Math.max(1, text.split("\n").length)` counts only explicit
  newlines, never soft wraps. A long title that visually wraps to two lines is
  exported as a one-line box, `yPos` advances by one line, and the subtitle is
  placed on top of the second line. The centered-layout pre-pass has the same
  assumption (`:265-284`, `totalHeight += fontSize * 1.3 + marginBottom`).

**Why it is not fixed here.** The user's Google Slides export does *not* go
through `export-pptx.ts` — it goes through the browser path
(`app/lib/export-pptx-client.ts`), which serializes measured DOM. So patching
the server estimator would not address the reported case and would be a fix
claimed against the wrong path. The server-side wrap bug should be filed
separately.

**Needed to close this:** the deck id, or the slide HTML for slide 1.

---

## 7. Ask for the intended output format up front

**Report.** "Could the agent ask for the intended output format (PPTX, GSlides,
PDF) at the start and optimize the build accordingly?" — cites Claude picking
`INDEX/MATCH` for Excel vs `XLOOKUP` for Sheets once told the target.

**Status: Product decision — reasonable, out of scope for a bug pass.**

This is an instruction change, not a code change: it belongs in
`templates/slides/.agents/skills/create-deck/` and the export guidance in
`AGENTS.md`, which currently documents the Google Slides path as a PPTX import
workflow. Worth noting that item 6 is the concrete cost of *not* knowing the
target: geometry that survives one renderer and breaks in another.

---

## Summary

| # | Item | Status |
|---|------|--------|
| 1 | Model default / task-aware selection | Product decision — per-app override exists, unused |
| 2 | Notion Connect no-op | Not reproducible; no-feedback path is the real gap |
| 3 | Reference deck variety / "none" | Confirmed — "none" reachable via Skip, unlabelled |
| 4a | `run_budget_exhausted` | Working as designed |
| 4b | Spinner stuck for an hour | **Fixed** (+ regression tests) |
| 5 | Google Slides export downloaded PPTX | **Fixed** (silent success → real reason) |
| 6 | Title/subtitle overlap | Confirmed in server export only; needs the deck |
| 7 | Ask for output format up front | Product decision |
