# Shape: Fix Content sidebar human-QA regressions

## Summary

Ship one implementation PR for Agent-Native Content that makes sidebar interactions settle in the state the user just requested, at every supported viewport. The PR owns four confirmed sidebar regressions: closing search must restore the normal tree, creating a child must reveal it under its parent, mobile navigation must dismiss the drawer, and compact layouts must preserve usable content width. It also adds latency instrumentation and budgets for these interactions.

The broader hosted cold-load investigation remains in the existing vault task, **Bound Content page-load latency across cold and cached loads**. This PR may remove a sidebar-owned request waterfall discovered while implementing these fixes, but it must not claim to solve whole-page DCL/FCP/load latency without separate root-cause evidence and hosted acceptance.

## Context

Human QA ran against Agent-Native Content revision `9e760783396e9e69ff4ec588e6107fd768506cf3`. Its durable evidence is linked from vault task **Fix Content sidebar human-QA regressions** (`f42d3f60-35c2-4cef-b715-ef01d8613881`) and the AI chat **QA Agent-Native Content Sidebar 2026-09-02**. The visual packet is at `C:/Users/emdis/.codex/visualizations/2026/09/02/content-sidebar-human-qa-v15-9e76078339`.

The focused sidebar suite passed 103 tests across 11 files, showing that the current coverage does not exercise the failed settled states. Measured acknowledgement times were already fast for expand, search, and Settings; the defects are primarily correctness and perceived-readiness failures rather than slow click handlers.

The repository instruction references a `content-product-development` skill that is absent from this checkout. This shape therefore uses the current Content code, tests, QA evidence, and the governing `frontend-design`, `native-navigation`, `client-side-routing`, `real-time-sync`, `performance`, and `verifying-changes` guidance. Restoring that missing product-contract skill is not part of this PR.

## Problem

The sidebar has several independent-looking symptoms caused by state transitions that do not complete atomically from the user's perspective:

1. The search button only toggles `isSearching`; when it closes a populated search, `searchQuery` remains non-empty, so the hidden input leaves the sidebar trapped in the results branch.
2. Child creation navigates immediately, but neither optimistic creation nor the non-optimistic success path records the parent as expanded. The active-child ancestor derivation depends on list data catching up, so the destination can be active while absent from the visible tree.
3. Mobile drawer dismissal is passed through `onNavigate`, but some nested database-item paths return or navigate through lower-level link behavior without one single guaranteed close-at-navigation boundary.
4. `useIsMobile()` switches at the `md` boundary, so 768px becomes desktop and reserves the hard minimum 240px sidebar. The main database remains technically present but horizontally constrained/clipped.
5. Human QA also observed a `VisualEditor` render-phase update warning and repeated `list-document-properties` requests for a missing welcome-document ID. These are important diagnostics, but neither is yet proven to originate in the sidebar boundary.

## Desired outcome

A person can search, create and open nested content, and use the sidebar across mobile, compact, and desktop widths without corrective clicks, stale chrome, hidden destinations, or content-width breakage. Every sidebar interaction acknowledges immediately and reaches the correct settled state within a small, explicit budget.

## Options considered

### A. Patch each event handler independently

Clear the query in the search button, expand a parent in child-create callbacks, add more `onNavigate` calls, and move the mobile breakpoint. This is quick but leaves navigation completion distributed across buttons, links, mutations, and database views; the same mobile and reveal defects can recur through an unpatched path.

### B. Centralize sidebar transition helpers and keep existing primitives

Introduce small app-owned helpers for `closeSearch`, `revealDocument`, and mobile navigation settlement. Continue using React Router links for pure navigation, imperative navigation only after mutations, React Query optimistic cache updates, the existing expansion state, and the existing Sheet. Make the compact responsive policy explicit in `Layout` rather than adding another sidebar implementation.

This is the recommended direction because it fixes the boundary while preserving native navigation and the persistent app shell.

### C. Redesign the sidebar or move its state into a new shared framework service

This would exceed the demonstrated need, increase localization and compatibility surface, and delay correction of bounded regressions. There is no evidence that a new framework abstraction is required.

## Recommended direction

Implement option B as the smallest compatible delta:

- Make search dismissal one operation that closes the input and clears the query. Escape, toggle-close, result selection, route changes, and mobile drawer dismissal must converge on that operation.
- Make child creation reveal its destination before navigation: add the parent to user-expanded state synchronously, inject the optimistic child where supported, and preserve the reveal across reconciliation. For non-optimistic sources, keep a short-lived pending reveal keyed by created ID until refreshed list data can derive the ancestry.
- Close the mobile Sheet from a route-settlement boundary owned by `Layout`, while retaining explicit `onNavigate` for post-mutation flows. Do not convert real links into buttons; normal click, Ctrl/Cmd-click, middle-click, and keyboard semantics must remain intact. A modified/new-tab click must not dismiss the current drawer.
- Treat compact portrait/tablet widths as overlay navigation rather than reserving 240px. Use one named layout media-query policy shared by rendering and tests; preserve the current persistent desktop rail above that range and the existing narrow-desktop agent-panel behavior.
- Add development/test timing markers around user input, route commit, drawer/search settlement, and destination readiness. Budgets are acceptance assertions, not permanent analytics or a new telemetry system.
- During implementation, trace the missing-document property request and the `VisualEditor` warning only far enough to classify them. Fix either in this PR only if the root cause is directly introduced by a sidebar transition and the focused fix stays within the named files/boundary. Otherwise attach reproducible evidence to the existing latency task or a separate editor task; do not bury unrelated changes in this PR.

No feature flag is warranted: these are bounded corrections to already-shipped behavior, and the acceptance story exercises the real interface before merge.

## Shipping surface

- **Repository:** `BuilderIO/agent-native`, current branch at work handoff; no branch operation is implied by this shape.
- **Product surface:** Agent-Native Content authenticated app shell, document sidebar/tree, nested database navigation, and responsive layout.
- **Constituency:** Content users navigating personal/organization/local spaces on mouse, keyboard, touch, mobile, compact tablet, and desktop viewports.
- **Durable destination:** one reviewable GitHub implementation PR in `BuilderIO/agent-native`, plus the existing linked teenylilthoughts task retaining QA provenance and deferred hosted-load work.
- **Ordinary integration action:** reviewed PR merge to `main`; the normal beta publisher then deploys the Content template for post-merge smoke verification. No production promotion is shaped here.
- **Execution placement:** local. The change and focused real-interface verification do not require framework compute or a persistent remote workload.

## Governing architecture

- Keep `Layout` mounted once above route content; navigation must not remount the app shell.
- Preserve React Router `<Link>` behavior for pure navigation. Use imperative `navigate()` only for post-mutation redirects already owned by the sidebar workflow.
- Keep writes on existing Content actions and cache/state synchronization on React Query plus the existing action/sync substrate. Do not add REST routes, polling, or a second event stream.
- Keep transient search, drawer, and pending-reveal state in the UI. Persist only existing user expansion preferences through the current application-state mechanism.
- Keep a single `DocumentSidebar` rendering model. Responsive behavior changes its container mode, not its data or action contract.
- Prefer optimistic UI and immediate navigation; reconcile or roll back loudly on mutation failure.
- Make one layout breakpoint policy authoritative instead of combining an implicit toolkit mobile boundary with unrelated CSS visibility classes.

## Architecture grounding and fit

### Demonstrated caller and request

The demonstrated caller is a Content user operating the left sidebar to close search, create/open a nested page or database, and navigate at 390px, 768px, and 1280px widths. The request is that each interaction feel instantaneous and leave the interface visibly settled.

### Existing primitives and seams

- `DocumentSidebar.tsx` owns `isSearching`, `searchQuery`, expansion state, optimistic document creation, and post-mutation navigation.
- `Layout.tsx` owns mobile Sheet state, the `onNavigate` close callback, sidebar width, and the mobile/desktop container decision.
- `DocumentTreeItem` and `ContentFilesSidebarView` render nested items and real navigation surfaces.
- React Query action hooks and existing query keys own cache reconciliation.
- `useDbSync`/action invalidation are the existing cross-writer freshness seam; they should not be expanded into broad invalidation.

### Boundaries and legacy contracts

- **Service/data owner:** existing Content actions and SQL-backed document model remain authoritative.
- **UI owner:** Content's `DocumentSidebar` and `Layout` own these transient transitions.
- **Vocabulary:** document, parent, active ancestor, expanded, search query, drawer, route settlement, destination readiness.
- **Unchanged contracts:** sidebar resize persistence on desktop; collapsed 48px rail; content-space selection; local-file-mode mutation behavior; DnD; favorites/trash; native link semantics; agent sidebar persistence; action names and payloads; localization catalogs unless new user-facing copy is introduced.

### Smallest compatible delta

Centralize three transition helpers, make the layout breakpoint explicit, and add behavioral tests/timing evidence. Do not create a shared package abstraction, new route, database schema, feature flag, or telemetry product.

### Evidence classification

- **Direct evidence:** the four settled-state failures and timings from the Human QA packet; current state ownership and handlers in `DocumentSidebar.tsx` and `Layout.tsx`; existing passing focused tests.
- **Inference to verify during Work:** closing on route settlement will cover every same-tab navigation path; active-ancestor lag is the reason the optimistic child remains hidden; overlay mode is the least disruptive 768px correction.
- **Unresolved but non-blocking:** root cause of the editor warning, missing welcome-document property calls, and whole-page cold-load latency. These do not change the sidebar's public contract.

## Acceptance story

Acceptance modality is **real-interface**. Independence is **preferred** and custody is **same-context-allowed** because the changes are reversible authenticated UI fixes with no destructive data contract; focused automated tests and proportional review still precede the browser pass. The final acceptance pass should ideally be performed by a context that did not implement the fixes, using the frozen script and original QA seed data.

Every assertion below must pass on the implementation commit, with a screenshot or trace attached to the PR/task and no new console error or failed 4xx/5xx request attributable to the flow:

1. **Search settlement:** at 1280×800, 768×1024, and 390×844, open search, enter a zero-result query, then close it with the search toggle and separately with Escape. The normal sidebar tree is visible, the query is cleared, reopening starts empty, and focus is sensible.
2. **Child reveal:** from a collapsed parent, create a child page and a child database. The route changes immediately, the parent is expanded before the destination editor/view becomes usable, and the active child is visible without a manual expand or refresh. Repeat for optimistic and non-optimistic source paths that are available in the fixture.
3. **Mobile drawer settlement:** at 390×844, normal-click a page, nested child, child database, favorite, Settings, and a search result. Same-tab navigation closes the drawer by route commit. Ctrl/Cmd-click or middle-click preserves native new-tab behavior and does not mutate the current drawer/route.
4. **Compact layout:** verify widths 767, 768, 834, 1024, 1099, and 1100px. Compact widths use overlay navigation and leave the primary database/editor usable without viewport-level horizontal clipping; desktop keeps the persistent resizable/collapsible sidebar. Crossing the boundary does not strand an open drawer or agent panel.
5. **Failure recovery:** force document/database creation failure. The optimistic child and route roll back, the prior sidebar state is restored, and the error is visible rather than represented as success.
6. **Performance budgets:** input acknowledgement (pressed/focus/optimistic route or drawer motion) occurs within 100ms; local settled UI for search close, expand, and drawer close occurs within 200ms; mutation-backed child creation shows its optimistic destination within 200ms. Record median and worst of five warm repetitions. Network persistence may finish later without blocking the optimistic state. Any regression beyond the budget blocks acceptance or requires an explicit return to Shape.
7. **Diagnostics:** confirm whether the tested flows emit the prior `VisualEditor` render-phase warning or request `list-document-properties` for an absent document. If reproduced and sidebar-caused, fix and retest in this PR. If not sidebar-caused, capture the route, request ID/document ID, timing, and console stack in the linked follow-up rather than claiming resolution.

Automated proof must include focused component/state tests for search dismissal, reveal reconciliation/rollback, mobile route-close semantics, and the responsive boundary, followed by the Content typecheck and applicable formatting/i18n guards. The real-page pass must drive the exact flows above against the implementation commit; source-string layout assertions alone are insufficient.

## Constraints

- Do not change branches during shaping or infer branch authority for Work.
- Preserve unrelated worktree changes.
- Do not add user-facing copy unless necessary; if copy changes, update configured locales and run both i18n guards.
- Do not use a feature flag, new dependency, new API route, broad query invalidation, manual polling, or browser `alert`/`confirm`/`prompt`.
- Keep the PR reviewable as one sidebar/layout correction. Whole-page server cold-start work stays in its existing task unless direct evidence proves a tiny sidebar-owned cause.

## Risks and assumptions

- Closing the drawer on every location change could also close it after modified-click navigation or external state sync; route-settlement logic must distinguish current-tab commits.
- Persisting an automatically revealed parent as user intent may make it stay open longer than expected. The implementation should explicitly decide whether creation reveal is durable user expansion or transient pending reveal and test that contract.
- A wider overlay breakpoint changes tablet muscle memory. The acceptance widths freeze the intended behavior and prevent a one-pixel 767/768 split from returning accidentally.
- Timing in dev mode is noisy. Use browser performance marks for interaction budgets and retain the existing hosted latency task for DCL/FCP/load conclusions.
- QA seed data may include missing legacy documents. Diagnostics must distinguish fixture corruption from a product request waterfall.

## Open questions

No user decision blocks implementation. During Work, the implementer must answer from code and behavior whether creation reveal should become a persisted expansion or remain transient; choose the smallest behavior that keeps the newly created child visible while preserving the current rule that navigation-derived ancestor expansion does not permanently alter user preference.

## Next steps

1. Invoke Work against this exact artifact and re-read the current branch/diff before editing.
2. Add failing behavioral tests for the four confirmed regressions and failure rollback.
3. Implement the centralized transitions and explicit responsive policy using existing primitives.
4. Run focused tests, Content typecheck/format/required guards, then the complete real-interface acceptance script with performance marks and console/network inspection.
5. Attach evidence to the implementation PR and the linked vault task. Keep broader hosted-load results on the existing latency task.

## Architecture fingerprint

```yaml
authoritySchemaVersion: 3
stage: shape
ledgerRevision: 1
authoritySource: user request on 2026-09-03 to shape an implementation PR from the completed Content sidebar Human QA and triage evidence
governingArtifact: plans/shape-content-sidebar-human-qa-regressions.md
allowedMutations:
  - artifact-write:plans/shape-content-sidebar-human-qa-regressions.md
outcome: Content sidebar interactions settle immediately and correctly across mobile, compact, and desktop layouts
shippingSurfaces:
  - repository: BuilderIO/agent-native
    productSurface: Agent-Native Content authenticated app shell and document sidebar
    constituency: Content users across mouse, keyboard, touch, mobile, compact, and desktop
    durableDestination: one reviewable GitHub implementation PR plus linked teenylilthoughts task evidence
    integrationAction: reviewed merge to main followed by normal beta deployment and smoke verification
governingArchitecture: app-owned centralized sidebar transition helpers, existing React Router links and post-mutation navigation, existing action/React Query/sync substrate, one responsive DocumentSidebar with Layout-owned container policy
acceptance:
  modality: real-interface
  independence: preferred
  custody: same-context-allowed
  interface: Agent-Native Content browser UI at frozen mobile, compact, and desktop viewport widths
  assertions: search settlement; child reveal; mobile drawer settlement with native link semantics; compact layout; rollback; interaction budgets; console and network diagnostics
riskStrategy:
  rollout: no feature flag
  rationale: bounded reversible fixes to shipped behavior with pre-merge real-interface acceptance
executionPlacement: local
architectureGrounding: required-and-complete
sourceRevision: 9e760783396e9e69ff4ec588e6107fd768506cf3
deferredWork:
  - whole-page hosted cold-load latency investigation
  - editor warning unless proven sidebar-caused
  - missing welcome-document property request unless proven sidebar-caused
```
