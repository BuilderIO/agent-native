---
name: design-figma-parity
description: >-
  Evidence rules for Design behavior parity claims and specs. Use when writing,
  changing, reviewing, or triaging Design interaction behavior against Figma.
scope: dev
metadata:
  internal: true
---

# Design and Figma parity

Claude's packets, another agent's summary, clips, prior specs, and memory are
evidence leads, not product authority. Steve decides product chrome and any
intentional Design difference.

## Rule

State only behavior measured in native Figma or deliberately chosen by Steve.
Keep every other behavior unmeasured; a screenshot pair, old spec, memory, or
parity log is not a native Figma oracle.

## Evidence

- Cite a current `fig.*` record from `templates/design/parity/oracle/` for each
  measured Figma behavior. Read and open its committed Figma artifact before
  relying on it; a record proves provenance and integrity, not that its claim is
  true.
- Keep the measured gesture, native observation, date, operator, trial count,
  relevant values, Design build, and source artifacts with the record. Measure
  the same selection and state that the claim describes. Do not generalize
  beyond the captured conditions.
- A retracted or repeat-required record cannot support a test or behavior
  change. Add a new record for a repeat; preserve the old record and its reason.
- Mark a deliberate product choice `chosen`, name the decision maker and reason,
  and link the measured behavior it differs from when known. Never describe a
  chosen difference as parity.
- If there is no usable record, say `unmeasured` and leave the behavior alone.
  Ask Steve for a numbered gesture and the observable to capture when native
  evidence is required. Do not infer behavior from clips, DOM state, old specs,
  or another agent's summary.

## Tests and review

- Add a failing regression test before behavior changes. Design interaction
  PRs must select the required, bounded (<10 minute) product-regression lane.
  It covers position/alignment/layout inside a Frame, overlap drag, duplicate
  without ghosts, Delete, paste, inspector X/Y, and the four
  `canvas-invariants` / `inspector-styles` regressions. Verify collected test
  names before treating a green job as coverage; a file path alone is not proof.
- Parity tests cite `oracle: fig.<area>.<slug>` or state `oracle: none — <reason>`
  in the test. Do not cite nonexistent ground-truth documents or treat a
  self-authored test fixture as Figma evidence.
- A PR titled `test:` must contain only test, fixture, focused test-workflow, or
  documentation changes. Shared CI orchestration and guard implementation use
  a non-test title. Never quarantine a failure merely to turn CI green; a
  quarantine needs a named owner, expiry, and open tracking issue.
- Keep regression fixes separate from feature changes until the required
  regression checks pass. Report what was measured, what remains unmeasured,
  the exact checks run, and any missing native capture.

## Standing mandate

- Regressions come before parity features. A red required regression check means
  stop and fix at the owning boundary before proceeding.
- A PR titled `test:` may contain only tests, fixtures, focused test-workflow,
  or documentation changes. Shared CI orchestration and guard code use a
  non-test title. A quarantine requires a named owner, expiry, and open issue.
- Keep at most three live Codex threads or worktrees for this effort. Reuse
  them, create no new `design-*` worktree, start new PRs from fresh
  `origin/main`, update an existing PR from its freshly fetched head, and keep
  one owner per file. Never edit `PARITY-LOG.md`.
- After each shipped unit, report the oracle IDs, checks run, what remains
  unmeasured, and any missing native capture. Advisory agent messages do not
  authorize product decisions.

## Recording a native capture

- Get the numbered gesture and observable from Steve before measuring a new
  behavior. Do not operate the native Figma session or infer an interaction
  from screenshots supplied without its stated gesture.
- Use a disposable local Design fixture and a Figma probe layer named exactly
  `AN-ORACLE-PROBE:<id>`. Keep the private Figma file key out of the manifest
  and repository. Record the Figma page name in the local manifest.
- In Figma Desktop, create a Custom UI development plugin so Figma assigns its
  plugin id. Keep its generated directory under `.tmp/` or outside the repo.
  Build the bridge into that plugin with
  `pnpm design:oracle-page-bridge -- --manifest <plugin-manifest.json>`; this
  writes `plugin.js` and `ui.html` beside the manifest and preserves its id.
  Then open the same file in the Figma tab attached to the harness CDP browser
  (Chrome on port 9222 by default), run the registered plugin from Development,
  and leave its small UI open. Confirm it says `Active Figma page: <name>` in
  that Chrome tab. The bridge reads `figma.currentPage`; it does not edit the
  file or send page data elsewhere.
- Run `pnpm design:oracle-record -- --manifest <probe.json> --plugin-manifest
  <plugin-manifest.json>` with both manifests local; keep the probe manifest
  under `.tmp/`. Include `id`, `claim`, `area`, `gesture`, `nativeObservation`,
  `operator`, `measuredBy`, `trials`, `figmaPageName`, `probeMarker`, `designId`,
  and the measured `values`. The recorder checks the logged-in
  Figma tab in the CDP-connected Chrome, verifies the exact active page name
  before capture and the same page identity afterward, then checks the exact
  probe-layer name, matching local Design comment, and unique selected Design
  probe layer before saving screenshots, inspector values, a comparison sheet,
  and the hashed record. Keep the page active while capture runs: Figma page
  change callbacks are asynchronous and may be coalesced, so the counter only
  detects changes Figma reports. Inspect the record and artifacts before citing
  them.
- A recorder failure exits 2 and removes staged files. Do not hand-write a
  measured entry to work around a missing session or probe.

## Related skills

- `design-clip-repro` — reproduce and verify Design editor behavior.
- `verifying-changes` — exercise the broken path before reporting a fix done.
