---
name: design-clip-repro
description: >-
  Required for any bug fix or behaviour change in the Design editor (the canvas,
  layers, inspector and export in templates/design/app), and for clips of Design
  editor bugs: copy the real design, reproduce the bug on it in a browser, fix
  obvious bugs directly, measure Figma only when the right behaviour is unclear,
  and verify side by side. Not for Design's server, actions or AI generation.
  Runs in a Fusion branch or on your own machine.
globs: "templates/design/app/{pages/DesignEditor*,pages/design-editor/**,components/design/**}"
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Design editor bugs: reproduce, decide, fix

Work like a careful engineer: reproduce the bug on the real design, fix what is
obviously wrong, and measure Figma only when the right behaviour is unclear.
There is no time limit; a skipped step is a failed run, so report what blocked
you instead.

## Where this runs

The harness detects a Fusion branch (`FUSION_ENVIRONMENT`) and otherwise
assumes your own machine. Run everything from the repo root.

| | Fusion branch | Your machine |
| --- | --- | --- |
| Design app | `127.0.0.1:8080/design` on the branch's dev gateway | `.agents/skills/design-clip-repro/harness/start-dev.sh`: one port and database per worktree |
| Shared browser (Figma, osmouse) | headed Chromium on display `:99`, DevTools `:9222`, started with the branch | your Chrome, started with `--remote-debugging-port=9222` and logged in to Figma |
| Figma login | `scripts/figma-login.mjs`, from the `FIGMA_COOKIES_B64` secret | your own session; the script only checks it |
| osmouse | `harness/osmouse-linux` (xdotool) | build once: `swiftc -O .agents/skills/design-clip-repro/harness/osmouse.swift -o templates/design/.tmp/osinput/osmouse`, and give the terminal Accessibility permission |
| Real designs | `copy-design.mjs` as the test account (`DESIGN_TEST_EMAIL` / `DESIGN_TEST_PASSWORD`) | the same, if you set those variables |

## The loop

1. **Start both at once** (two commands in one turn, from the repo root):
   - `node .agents/skills/design-clip-repro/harness/doctor.mjs`: PASS → go on. WAIT → run it
     again (the dev server is still compiling). FAIL → report the line and its
     screenshot, and stop.
   - For each clip: `node .agents/skills/design-clip-repro/scripts/clip.mjs "<link>"`, then open
     its contact sheet. Open a single frame only when you need its detail.
2. **Copy the design:** `node .agents/skills/design-clip-repro/scripts/copy-design.mjs <id>`. The id
   comes from clip.mjs or the URL bar in the frames; if neither shows it, ask.
   It prints a production copy (the unfixed build) and a local copy (this
   checkout). Read its `source.json`, the real HTML, before theorising.
3. **Reproduce** each issue on the production copy with
   `openEditor(prodCopyId, { prod: true })`. **Gate:** change no source until
   every issue is reproduced and its capture matches the clip frame (lay them
   side by side with `sheet`). If you cannot reproduce it, stop and ask for the
   design id, sharing, or the exact steps. Never prove a bug on a design you
   built yourself.
4. **Decide:**
   - **Obviously wrong** (the export differs from the canvas, a control does
     nothing, data is lost, it crashes): fix it. No Figma.
   - **Unclear how it should behave:** measure the same interaction in Figma,
     on the same kind of layer as the clip, then follow Figma's approach.
5. **Fix at the boundary** (see Fixing) and add a regression test.
6. **Verify** on the local copy with the same steps. For each issue, one
   sheet: Clip | Production before | Figma (if measured) | Local after. Report
   per issue what changed and which sheet shows it.

No clip? Same loop: get the design where the problem shows up (ask for its id),
reproduce, decide, fix, verify.

## Tools

| Need | Use |
| --- | --- |
| Harness check | `harness/doctor.mjs` (above) |
| Clip | `scripts/clip.mjs "<link>" [atMs,...]`: transcript, frames, contact sheet, design ids |
| Real design | `scripts/copy-design.mjs <id or URL>`; `--delete-prod-copy <id>` when done |
| Design editor | `import { openEditor } from ".agents/skills/design-clip-repro/harness/dlib.mjs"`. `openEditor(id, { prod, reuse })` returns `page`, `close()`, `selectLayer(name)`, `clickLabel(label, { panel })`, `inspector()`, `setField(label, value)`, `styles(nodeId)`, `menu()`, `exportPreview(path)`, `files()`, plus drag and draw helpers. `reuse: true` keeps the tab open in the shared browser between scripts, so only the first load is slow. End every script with `await d.close()`. |
| Figma | `node .agents/skills/design-clip-repro/scripts/figma-login.mjs` once, then `open()` from `harness/figlib.mjs` inside `withLock("osmouse", …)` from `harness/lock.mjs`: `newPage()`, `mkText(x, y, text)`, `tree()`, `selExact(name)`, `click(label)`, `inspector()`, `setField(label, value)`, `panelShot(path)`. Figma runs in the one shared browser, hence the lock. |
| Side by side | `node .agents/skills/design-clip-repro/harness/sheet.mjs "<title>" "Clip=<img>" "Before=<img>" …`, or `sheet(title, cells)` in a script |
| Screenshots | `shots(tag)` from `harness/shot.mjs`; files go to `templates/design/.tmp/parity/shots/` |

Write probe scripts with the file tool in `templates/design/.tmp/parity/`
(gitignored), import the harness by absolute path, and run them from the repo
root. Harness scripts stop themselves with an error before a command would
time out.

## Rules that save the most time

- **Numbers for state, images for looks.** Read `inspector()`, `styles()` and
  `files()` for values; take a screenshot only for a visual or Figma claim, and
  compare with a sheet rather than opening shots one by one.
- **`Read` only opens workspace files**, which is why screenshots live under
  `templates/design/.tmp/parity/shots/`.
- **The copied design is a real person's work.** Never commit it or paste it
  into a PR, comment or commit message. Delete the production copy at the end.
- **Close the tabs you open.** Editor and Figma tabs are large.
- **Heavy checks run alone.** A full `tsc` of `templates/design` next to the
  dev server and the browser has run the machine out of memory. Close editor and
  Figma tabs first, prefer the changed files' tests, and cap a type check with
  `NODE_OPTIONS=--max-old-space-size=4096`.

## Fixing

- Fix the boundary that made the symptom possible, not the symptom. A local
  `|| fallback` beside the bug usually means the layer below it is wrong.
- Figma is the reference for behaviour, not a spec for HTML. Figma disables
  corner radius on text because text has no box; an HTML text element can have
  one (background, border, shadow, backdrop filter). Match Figma for plain
  text, keep the control when the element has a visible box, and check one such
  neighbouring case.
- Before changing editor code, read the repo's `design-editor-architecture`
  skill: editor behaviour lives in `app/pages/design-editor/commands/*.ts`.

## References (open only when the clip needs them)

- `.agents/skills/design-clip-repro/reference/figma.md`: measuring Figma in detail, and refreshing its login
- `.agents/skills/design-clip-repro/reference/input-and-osmouse.md`: HTML drag-and-drop, canvas input, osmouse
- `.agents/skills/design-clip-repro/reference/verification.md`: instrumenting, and rules that each prevented a wrong claim
- `.agents/skills/design-clip-repro/reference/fixing.md`: worked fixes and when not to fix
- `.agents/skills/design-clip-repro/reference/tests-and-blast-radius.md`: changing specs, blast radius
- `.agents/skills/design-clip-repro/reference/performance.md`: lag clips (profile on production, not a local build)
- `.agents/skills/design-clip-repro/reference/evidence.md`: evidence rules and report shape
- `.agents/skills/design-clip-repro/harness-recipes.md`: more harness helpers
