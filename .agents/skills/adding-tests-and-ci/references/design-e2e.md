# Design E2E harness

Every Design spec imports its fixture from `templates/design/e2e/rails.ts`:
`import { test, expect, expectOnlyChanged, childrenOf, styleOf } from "./rails"`.
The `app` fixture is automatic, and it fails the test on the app errors listed
in the skill.

| Need                           | Use                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A design for this test         | `app.seed(html, { files })`, with explicit `data-agent-native-node-id`s; it is deleted after the page leaves                       |
| A design the product created   | `app.adopt(designId)`                                                                                                              |
| Open it, ready for geometry    | `app.open(id)`, then `app.zoomToFit()`                                                                                             |
| A pointer position             | `app.designRect(nodeId, screen?)`, then `app.pagePoint(x, y, screen?)`                                                             |
| A second screen                | pass its seeded filename, or `{ fileId }` for a screen created in the editor                                                       |
| Saved state                    | `await app.settled()`, then `app.savedNodes(id)` or `app.savedRecord(id)` (`data` arrives parsed)                                  |
| Nothing else changed           | `expectOnlyChanged(before, after, ["edited-node-id"])`                                                                             |
| Selection                      | `await expect.poll(() => app.selectedLayers()).toEqual([...])`                                                                     |
| A failure the scenario expects | `app.allowFailure(pattern, reason)`; the pattern matches `"<kind> <detail>"`, for example `http 403 POST /_agent-native/actions/x` |

## Traps

- Copies, pastes, cross-screen moves, and generated groups save
  `data-agent-native-clone-root`, `-preserve-styles`, and `-group-wrapper` on
  purpose. Assert them as part of the end state.
- Layers lists auto-layout children in layout order, first child on top.
- Compare id arrays with `toStrictEqual`; `toEqual` treats `[undefined]` like
  `[]`.
- A title pinned in `scripts/design-e2e-regression-pins.ts` cannot carry
  `fixme` or `skip`. Renaming or deleting one also means updating the pin count
  asserted in `design-e2e-regression-pins.test.ts` and `ci-change-scope.test.ts`.
- `scripts/design-e2e-spec-selection.ts` and `ci.yml` route a few slow tests to
  their own shards by exact title. Renaming one breaks every changed-spec shard.
- Run the suite against a dev server serving a checkout nobody is editing:
  Vite reloads every open editor when a watched file changes, spec files
  included.
- From a `.claude/worktrees/` checkout, `oxfmt` silently skips every file,
  because the root `.gitignore` excludes that path. Pass `--ignore-path` with
  an empty file, and read the whole `--check` output, not only its last line.
