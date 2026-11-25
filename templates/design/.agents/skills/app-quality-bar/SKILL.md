---
name: app-quality-bar
description: >-
  Plan, build, and verify a new app or a user-facing extension. Choose reusable
  interaction patterns, write DESIGN.md, and gate readiness on independent
  visual review and a Playwright walkthrough.
scope: dev
---

# App quality pipeline

Run these five stages for a new app or a user-facing extension. A scaffold is
a starting point. Readiness is earned on the running preview.

1. **Choose the patterns.** Identify the user's primary object and repeated
   action. Read one or two specs below. For an extension, inspect the host's
   nearest shipped interaction, tokens, spacing, focus, and shortcuts.
2. **Decide and document.** Write or update the app's `DESIGN.md` before
   implementation. Record the visual direction, semantic tokens, type scale,
   density, route map, shortcuts, and behavior in populated, empty, pending,
   narrow, error, and offline states. Use the decision log below to compare
   three concrete options and record rejected options. Keep it in
   `DESIGN.md`, the single required design contract.
3. **Implement the contract.** Register `app.manifest.ts` with screens,
   entities, `viewPolicy`, and `suggestableCapabilities` that match actual
   routes and actions. For a runtime-only extension, update the host manifest
   when it owns the new capability and use the extension APIs for live state.
   Use shared actions and SQL, publish current screen state, and make
   `navigate` report kept, queued, or confirmed navigation accurately. Opt in
   to realtime `useDbSync` where another tab or actor can change visible work.
   Resolve the deployed mount and landing from the workspace registry or preview gateway. React Router uses app-local paths.
4. **Review the preview.** Follow the canonical [capture procedure, 12-row
   rubric, and automatic fails](visual-review.md).
   Give a blind reviewer subagent only screenshots, the rubric, and the brief.
   Keep the lower score per row. Batch fixes, recapture, and require a mean
   of at least 4.0, every row at least 3, and zero automatic fails. If
   independent review is unavailable, mark that gate pending.
5. **Verify interactions.** Run the Playwright walkthrough below on a signed-in
   disposable preview. Attach the scored rubric, screenshots, and independent task receipts from [preview acceptance](preview-acceptance.md).
   Report an unavailable preview, fixture, or chat provider as incomplete.

## Pattern index

| Workflow | Pattern |
| --- | --- |
| Sort and act on many items | [Dense triage workspace](patterns/dense-triage-workspace.md) |
| Move quickly across commands and views | [Command palette and keyboard](patterns/command-palette-and-keyboard.md) |
| Schedule or reposition timed work | [Time grid and direct manipulation](patterns/time-grid-and-direct-manipulation.md) |
| Edit structured content in place | [Inline document and thread editor](patterns/inline-document-and-thread-editor.md) |
| Query and review data outputs | [Data notebook and dashboard](patterns/data-notebook-and-dashboard.md) |
| Connect, index, and share sources | [Connectors and provenance](patterns/connectors-and-provenance.md) |
| Decide what to build beyond existing behavior | [Extrapolation decision log](patterns/extrapolation-decision-log.md) |

## 60-second interactive verification

Write a Playwright test against real routes, controls, actions, and chat. Give
the interaction run a 60-second deadline after setup. Seed disposable fixtures
outside the timed run and keep the ordered assertions reproducible.

- Visit the mounted app and exercise four states: empty, populated, split
  pane at 520 px or narrower, and an injected error with retry. Check the
  visual rubric separately at 390 px.
- Click every user-facing navigation item and assert the destination and
  active state. Use Back and Escape. Assert focus restoration and no
  horizontal overflow. Count main-frame document requests to catch reloads
  during client-side navigation.
- Create a fixture record, edit it, explicitly reload once, and verify the
  saved values. Exercise rollback or undo and confirm the persisted result.
  Observe console errors, unexpected request failures, visible
  `Loading...` (including its ellipsis variant), and native
  `alert` / `confirm` / `prompt` dialogs. Fail on regressions.
- Read the capability manifest from the mounted discovery endpoint when the
  running framework exposes it. On older runtimes use `app.manifest.ts` to
  plan the same prompts and verify each binding in the signed-in preview.
  Send
  three fresh prompts derived from its screens and actions: explicitly open
  a declared screen, query or narrow the current work, and create or edit a
  fixture. Assert active route or kept view, visible result, and saved state
  as indicated by `viewPolicy`. Hand-edit or select the result and check that
  `view-screen` reports the change. Check an actionable suggestion when the
  manifest declares the corresponding capability.
