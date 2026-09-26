# Edit fidelity harness

Drives the real Slides editor in Chromium and checks one rule: clicking into
text, typing, pressing Enter, or just leaving an edit must not change any
styling or layout on the slide. Unit tests have repeatedly missed breaks on
this path. The clicked element becomes the editor in place, the save
serializes the rendered DOM, and only a real browser rendering real CSS shows
what the user sees.

## Run

Run the script from `templates/slides`:

```bash
pnpm exec tsx scripts/edit-fidelity/run.ts [case-filter] [options]
```

By default the harness starts its own scratch dev server with this command,
run from the repo root:

```
pnpm exec tsx scripts/claude-launch.ts --name slides-edit-fidelity --dir templates/slides \
  --env AUTH_MODE=local --env AUTH_DISABLED=true -- dev --port <free port>
```

That server uses a throwaway PGlite database, which is wiped when the harness
exits.

To reuse a server that is already running, set
`SLIDES_BASE_URL=http://localhost:<port>`. The harness refuses any other host,
because it creates and rewrites decks.

| Option                         | Meaning                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `case-filter`                  | Substring of the corpus file name                                                          |
| `--corpus <dir>`               | Corpus directory. Default: `corpus/` next to this file                                     |
| `--baseline <file>`            | Ratchet file. Default: `<corpus>/../baseline.json`                                         |
| `--update`                     | Rewrite the baseline entries for everything that ran. Entries that did not run are kept    |
| `--accept-failing`             | With `--update`, also record `fail`/`no-edit` results as accepted ceilings (never `error`) |
| `--scenarios a,b`              | A subset of `noop,typedelete,append,enter3,clickout`                                       |
| `--max-slides N`               | Run the first N slides of each case, after `--slides`                                      |
| `--slides 1,3`                 | 1-based slide numbers                                                                      |
| `--max-targets-per-slide N`    | Default 4. A case's `targets` entry overrides this per slide                               |
| `--targets 0,2`                | Target indexes, from the slide's `targets.json`                                            |
| `--concurrency N`              | Runs N cases in parallel, each in its own page against the same server                     |
| `--out <dir>` / `--run <name>` | Output directory. Default: `<repo>/.tmp/slides-edit-fidelity/<run>/`                       |
| `--resume <run>`               | Reuse `<run>`'s output and keep every result that did not error                            |
| `--cpu-throttle N`             | Slow each editor page's CPU N times, to reproduce timing-dependent saves                   |
| `--headed`                     | Show the browser                                                                           |

Exit codes:

- **0**: every result is within its baseline ceiling.
- **1**: a regression, a missing baseline entry, a baselined scenario that did
  not run, or a slide that errored.
- **2**: the harness could not run. Causes include a bad corpus, a non-localhost
  URL, a server that never started, a run where no scenario ran, or a browser
  that closed before every case ran.

An error from the dev server or the browser (a navigation or selector
timeout, a page reload, a closed page) is retried once on a fresh page. If it
repeats, the result is marked `infra` and counted as `infra-error`, apart from
editor failures. A run cut short, by a reboot for example, continues with
`--resume <run>`: it skips every scenario whose `result.json` exists with a
status other than `error`, and every slide whose scenarios all have one.

A run that exercised nothing never exits 0.

A full run of the committed corpus takes about 10 s per scenario. For example,
56 slides × 4 targets × 5 scenarios takes about 3 hours serially. Use
`--concurrency 4` together with `--max-targets-per-slide` or `--scenarios` for
quicker loops.

## Private corpus

Customer and internal decks must never be committed. Put them under the
gitignored `.tmp/` and point the harness at them:

```bash
pnpm exec tsx scripts/edit-fidelity/run.ts --corpus ../../.tmp/my-decks/corpus --update
pnpm exec tsx scripts/edit-fidelity/run.ts --corpus ../../.tmp/my-decks/corpus
```

The baseline defaults to `../../.tmp/my-decks/baseline.json`, so it stays
private as well. Committed fixtures in `corpus/` must be synthetic and
anonymized: no real company, person or deal names.

## Corpus format

Each case is one file, `corpus/<case-id>.json`:

```jsonc
{
  "title": "Account review", // required
  "notes": "what this case covers", // optional, ignored by the runner
  "aspectRatio": "16:9", // optional, passed to create-deck
  "slides": [
    // required, non-empty
    {
      "id": "slide-1", // optional; defaults to slide-<n>
      "content": "<div class=\"fmd-slide\">…</div>", // raw slide HTML or markdown, exactly as stored
      "layout": "blank", // optional create-deck layout
      "notes": "speaker notes", // optional
    },
  ],
  "targets": { "0": 6 }, // optional: max text targets per slide, keyed by 0-based slide index
  "expectStyles": [
    // optional: computed styles that must hold on a fresh load and after reload
    {
      "slide": 0,
      "selector": ".card .value",
      "property": "font-size",
      "value": "28px",
    },
  ],
}
```

Corpus files are strict JSON. The comments and trailing commas above are
annotation only.

The harness creates the deck with `create-deck`. It then reads the slides back
with `get-deck` and uses that stored copy as the baseline, not the fixture,
because `create-deck` normalizes padding.

## What one scenario does

The harness enumerates **targets**: each `[data-slide-text-block]` inside the
main canvas, skipping `<style>` and zero-size elements. `targets.json` records
them per slide. For each target and scenario:

1. **Restore.** Write the stored slide back through `patch-deck`, then load
   `/deck/<id>?slide=N` fresh, with chrome masked, caret and transitions off,
   and two animation frames waited once every stylesheet has loaded and
   `document.fonts` reports `loaded`. The renderer injects a webfont
   stylesheet per slide font, so `fonts.ready` alone can resolve before the
   slide's font is requested. Scenarios never contaminate each other.
2. **View.** Capture `view.png` and a style snapshot of the slide.
3. **Enter edit.** Try click, then a second click, then double-click. The
   gesture that worked is recorded. A click must leave a caret within one
   grapheme of the click point (`caretPositionFromPoint`, compared in
   rendered characters), and a double-click a selection inside the word
   under it plus one trailing space; either way it must be in the point's
   row (nearest block, or the row of a bullet marker, which counts up to the
   start of the row's text). Anything else is a violation. The double-click
   selection is then collapsed to a caret before any keys. If none enters
   edit, the status is `no-edit`; the scenario fails and is never skipped. The clicks must still change nothing: a `no-edit` result also
   gets a violation for any write, any change to the stored slide (both
   skipped when opening the slide rewrites it anyway), and a view→after
   pixel diff above tolerance.
4. **Editing.** Capture `editing.png` and a snapshot before typing.
5. **Keys.**
   - `noop`: none.
   - `typedelete`: `x`, then Backspace.
   - `append`: End, then ` ok`.
   - `enter3`: End, then Enter three times, then `new line`. After each Enter
     (the first measured from the entry caret, since a caret End left at a
     soft wrap measures as the next line; from the caret End left only when
     entry left none) it records `enter-N.png`, the edited element's height,
     the canvas change, and the caret's line, measured from the top of the
     element's rendered text so that centred and bottom-anchored text, or a
     label beside a taller icon, still shows a full line per Enter. The caret must
     be collapsed inside the edited element and move to another line; a
     caret that cannot be measured is its own violation.
   - `clickout`: like `typedelete`.

   Once the keys are in, it captures `typed.png`: the slide as the live
   editor shows it, caret hidden.

6. **Exit.** Escape, except `clickout`, which clicks the empty editor
   background beside the slide. The harness then polls `get-deck` until the
   stored content stops changing, and captures `after.png` and `saved.html`.
   A save still in flight after 75 s errors the scenario.
7. **Reload.** Capture `reload.png`, then read the stored slide again: a
   write that lands after the edit settled (a `pagehide` flush, say) is a
   violation, unless opening the slide rewrites it anyway. Playwright does
   not report the keepalive writes Slides sends on `pagehide`, so the page
   counts them in `sessionStorage`. When there was one, the harness waits
   up to 15 s for it to land, and then, as when a write it does see is still
   in flight, polls until the stored slide settles before reading.
8. **Idempotence (`typedelete` only).** A second identical edit must save
   exactly what the first one did.

Each scenario writes this directory:

```
<out>/<case>/sNN/tNN-<scenario>/{view,editing,enter-1..3,typed,after,reload}.png
<out>/<case>/sNN/tNN-<scenario>/diff-{editing,after,reload,typed}.png
<out>/<case>/sNN/tNN-<scenario>/{stored,saved,saved2}.html
<out>/<case>/sNN/tNN-<scenario>/html.diff, html-outside.diff
<out>/<case>/sNN/tNN-<scenario>/result.json, sheet.png
```

Each slide directory also holds `view.png`, `noise-diff.png` and
`targets.json`. The run root holds `summary.json` and `server.log`. The console
prints one row per scenario, with pixel % for editing/after/reload, style
deltas for editing/after, the html diff, and the violation count.

## Metrics and invariants

- **Noise floor.** Each slide is loaded twice with no edit and the two loads
  are diffed. The tolerance used below is `max(0.02%, 2 × noise)`.
- **Pixels.** pixelmatch runs at threshold 0.1 on view→editing, view→after,
  after→reload and typed→after. Each pair is measured over the whole slide and again
  "outside" the edited element: the element's old and new rects, padded 4px,
  are blanked and left out of the denominator. A rect covers the element's
  content as well as its box, because text that overflows a fixed-size box
  (a freeform object, an imported text frame) is still the edited element.
  - Every scenario: view→editing outside must be ~0, and after→reload whole
    must be ~0.
  - Every scenario that edits: typed→after whole must be exactly 0 px. Both
    shots come from one page load, so no noise floor applies. Leaving edit
    mode must not change what the editor showed, so a line the save adds or
    drops, or a style the live element only had while editing, fails here.
  - `noop` / `typedelete` / `clickout`: view→editing and view→after whole
    must be ~0.
  - `append` / `enter3`: view→after outside must be ~0 while the edited
    element keeps its size. Once it grows or shrinks, the content after it
    legitimately moves, and the outside style and stored-bytes checks below
    carry the rule instead.
- **Computed styles.** Every element with its own text yields a text record.
  It carries these longhands: font family, size, weight and style;
  line-height; letter-spacing and word-spacing; text-transform; color and
  `-webkit-text-fill-color`; text-shadow; text-decoration-line; font feature
  and variation settings; text-align; white-space; opacity; visibility. The
  record is keyed by the text, so a run that moves into an editor `<p>` still
  pairs up.
  - Every element that paints yields a box record: background, border,
    box-shadow, or an svg/img/hr, including `::before`/`::after`. It carries
    display, margins, paddings, border width/style/color per side, radii,
    background color/image, box-shadow, opacity and visibility. An `auto`
    margin is recorded as `auto`, not as the length it resolves to, because
    that length moves whenever a flex sibling grows.
  - Geometry (x/y/width/height, 1px tolerance) is counted separately.
  - Editing must add 0 style deltas and lose 0 styled elements.
  - `noop` / `typedelete` / `clickout` must add 0 style or geometry deltas, 0
    missing or added elements, and must not change the visible text.
  - `append` / `enter3` must add 0 style deltas outside the edited element.
- **Writes.** Every `patch-deck`, `save-deck` or `update-slide` request from
  entering edit to the end of the scenario (the `typedelete` rerun included)
  is recorded in `result.json`: `writeDetails` has each request's slides,
  fields, phase (`edit` or the `rerun`), and whether its content equals the
  stored string, and `writeStacks` has the client call stack of each.
  `noop` / `typedelete` / `clickout` must send none.
- **Saved bytes.** For `append` / `enter3`, the edited element is located in
  the stored source by tag, exact full text and occurrence (the same rule
  for every lookup), and the saved string must
  start with every stored byte before it and end with every stored byte after
  it. `bytes-outside.txt` shows the first difference.
- **Saved text.** For `append` / `enter3`, text is read as lines: a `<br>` or
  a block box breaks a line; zero-width spaces and blank lines are dropped,
  and `text-transform` is not applied. The saved
  content must differ from the stored content; the editor's text must be the
  element's text with the token (` ok` / `new line`) inserted exactly once,
  with whitespace runs compared as one space, so a lost space fails (beside
  the token, only marker glyphs such as a cloned `●`); for `enter3`,
  `new line` must start a line; and the reloaded slide must have an element
  with exactly those lines, so a dropped line break fails. Typed text that
  lands in a new text node on the reloaded slide must share its computed
  text style with some text the element had before the edit. The ratchet
  only bounds numbers from above, so lost text has to fail here.
- **Saved HTML.** Both versions are parsed in the page and canonicalized:
  attributes and classes sorted, style declarations parsed by the CSSOM (which
  normalizes colors and units) and sorted, whitespace collapsed.
  - `noop` / `typedelete` / `clickout`: either nothing is saved, or the saved
    canonical form equals the stored one.
  - `append` / `enter3`: the edited element (plus any list items the edit
    added after it) is replaced by a placeholder on both sides, and the rest
    must match. When the element cannot be located, only that is reported:
    the outside checks stay unknown (`null`), never "changed outside".
- **Hard failures** in the saved HTML, counted against the stored HTML:
  - `data-slide-content-scope`, `visibility:hidden`, `data-editing-block`,
    `contenteditable`, `data-builder-id`, `ProseMirror` or `data-src-i`
    appearing more often;
  - changed `<style>` text;
  - fewer `<svg>` or `<img>`.
- **Inventory.** Counts of elements, visible and hidden styled elements, svg,
  img and style, with deltas for editing/after/reload.

A scenario is `pass` when it has no violations. Otherwise it is `fail`,
`no-edit` or `error`, and `result.json` lists every violation.

## Baseline ratchet

`baseline.json` maps `case/sNN/tNN/scenario` to a status and to ceilings.

- **Pixel ceilings:** `ceilingFor(d) = d + max(0.1, 15% of d)`, the same as the
  Design harness. An entry recorded before a pixel field existed is held
  to `ceilingFor(0)` for it.
- **Count ceilings:** style deltas, missing elements, html diff lines, hard
  failures and violations are exact.

A regression is any of:

- a worse status (`pass < fail < no-edit < error`);
- a number above its ceiling;
- a result with no baseline entry;
- a baselined scenario inside the run's filters and limits that did not run;
- in a run over the whole corpus (no case filter, `--slides`, `--targets`,
  `--max-slides`, scenario subset, or `--max-targets-per-slide` below 4), a
  baselined case or slide that is no longer in the corpus. `--update` refuses
  to write until those entries are pruned.

`--update` records only passing results: a ratchet seeded from a failing run
would accept the failure as its ceiling. Record a known failure deliberately
with `--accept-failing`; an `error` is never recorded. `--update` keeps the
stricter of the old and new value, so ceilings only go down, and it refuses to
write while a slide errored or a baselined scenario did not run. With no
baseline file the run cannot gate and exits 2.

## Limitations

- Targets are matched by index plus text after each fresh load, and the
  editor's `data-builder-id` is re-stamped after every commit. A slide whose
  target list changes when it is opened will error the affected scenario
  loudly rather than test a different element.
- Text records are keyed by their own text. Duplicate strings on one slide
  pair up in document order.
- `append` and `enter3` press End, which moves to the end of the visual line.
  In a wrapped paragraph the text lands mid-block, so the saved-text check
  accepts the token at any point.
- Needs `playwright@1.63.x`, `pixelmatch@7.2.x` and `pngjs@7.x` in the root
  pnpm store. They are resolved by `../export-fidelity/resolve-pkg.ts`.
