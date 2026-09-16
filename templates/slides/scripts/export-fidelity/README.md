# Export fidelity harness

Verifies Slides → PowerPoint/Google Slides export fidelity by comparing
Chrome's own text layout for a deck against what Google Slides renders after
importing the exported PPTX. This exists because an earlier Google Slides
export fix shipped without ever being checked against real Google Slides —
the PPTX was valid but nobody diffed its rendered layout against the source.

## Prerequisites

- Local Slides dev server running with `AUTH_MODE=local` (the scripts sign in
  via the "Continue as local dev" button).
- Playwright, resolved out of the pnpm store by `resolve-pkg.ts` — no local
  `package.json` entry needed, but `playwright@1.63.x` must exist under the
  workspace root's `node_modules/.pnpm`.
- ImageMagick (`magick` on `PATH`) for `diff.ts` only.

## Commands

Run everything from `templates/slides`, naming the script by its path from
there — `pnpm exec` resolves relative to the package root, so a bare
`<script>.ts` is looked up in `templates/slides` and not found:

```bash
pnpm exec tsx scripts/export-fidelity/export.ts \
  scripts/export-fidelity/fixtures/agent-dark-deck.json --out <dir> --layout-only
```

- **`export.ts <fixture.json> --out <dir>`** or **`export.ts --deck <id> --out <dir>`**
  (add `--layout-only` to skip the PPTX export and reference PNGs) — drives
  the dev server, creates or reuses a deck, dumps per-line Chrome text layout
  to `<dir>/layout/slide-NN.json`, exports a PPTX to `<dir>/deck.pptx`, and
  renders `<dir>/ref/slide-NN.png` reference PNGs.
- **`google-export.ts --deck <id> --out <dir> [--target google-slides|powerpoint]`**
  (or `--fixture <fixture.json>` instead of `--deck` to create the deck
  first) — exports one deck as a PPTX for the given target, writing
  `<dir>/deck.pptx`. Target defaults to `google-slides`.
- **`compare-layout.ts <chrome-layout-dir> <google.txt> [--slides <n>]`** —
  matches Chrome's `layout/slide-NN.json` lines against `google.txt` rows and
  prints per-slide pass/fail plus `|dy|`/`|dx|` percentile stats. This is the
  harness's pass/fail gate: it exits nonzero when a line is unmatched, a line
  break differs, a line sits more than 1.5px out, or a Google row is never
  claimed. Pass `--slides <n>` — the deck's own slide count — so a dump that
  stopped early cannot pass by comparing fewer slides on both sides.
- **`diff.ts <refDir> <candDir> --out <dir>`** — pixel-diffs two directories
  of `slide-NN.png` renders (full-resolution + blurred/downscaled layout
  ratio) and writes `<dir>/report.json` and `<dir>/*-compare.png` montages.
  It is an inspection aid rather than a gate, and fails only when a slide has
  no usable pair: a pixel threshold tight enough to catch a real regression
  also fires on ordinary font-rendering differences between machines. Read its
  ratios and montages; let `compare-layout.ts` decide pass or fail.
- **`generate-calibration.ts`** (run from `templates/slides`) — rebuilds
  `calibration.pptx`/`cases.json` from a real exported deck's package parts.
  Pass `--template <deck.pptx>` — any exported deck, such as the `deck.pptx`
  written by `export.ts --out <dir>`; its presentation, layout, master and
  theme parts are reused and only the slides are replaced.
- **`google-layout.ts`** exports
  `extractGoogleSlideLayout(slideNumber, { aspect, width })`, not a standalone
  script — see the extraction procedure below. `aspect` and `width` default to
  16:9 in a 960-wide coordinate space; pass the deck's own ratio and width for
  a 1:1, 9:16, 4:5 or 4:3 deck, or it will not find the slide frame.

## Google Slides import procedure (for a browser agent)

1. On `docs.google.com`, inject a visible proxy `<input type="file">`.
2. Use the browser tool's file-upload action on that proxy input.
3. Open the Slides file picker — the first click often doesn't open it, click
   again.
4. Select the Upload tab by dispatching mouse events inside the same-origin
   `/picker/` iframe.
5. Copy the file into the picker iframe's own file input using that iframe's
   own `DataTransfer`/`File` constructors, then dispatch `change`.

## Extraction procedure

For each slide N:

1. Fully load `.../edit#slide=id.p<N>` (a real navigation, not a hash change
   — hash-only navigation freezes a hidden tab and the SVG never updates).
2. Emit browser JS from the extractor once, since `google-layout.ts` is
   TypeScript and a console will not parse it:

   ```bash
   pnpm exec tsc scripts/export-fidelity/google-layout.ts --ignoreConfig \
     --target es2022 --lib es2022,dom --outDir /tmp/gl
   sed 's/^export //' /tmp/gl/google-layout.js
   ```

   Paste that output into the page — or hand the same stripped source to a
   browser automation tool's page-eval — and then call
   `extractGoogleSlideLayout(N)`. For a deck that is not 16:9, pass its ratio
   and coordinate width, e.g.
   `extractGoogleSlideLayout(N, { aspect: 4 / 5, width: 720 })`, or the frame
   search finds nothing and it throws.
3. Browser tools may cap output around 1KB per call — page the returned rows
   and append each page to `google.txt`.
4. Once every slide is appended, run
   `compare-layout.ts <chrome-layout-dir> google.txt --slides <n>` with the
   deck's own slide count, so a capture that stopped early on both sides
   cannot pass by comparing matching prefixes.

## Measured Google Slides import rules

- Line pitch = `spcPct × 1.2 × size`.
- `spcPts` is unreliable — use `spcPct`.
- First baseline sits `0.96 × size × min(1, pct)` below the top of the text area.
- Centered and bottom-anchored blocks are `1.2 × size × min(1, pct) + (n−1) × pitch` tall.
- No letter-spacing.
- `roundRect` text inset = `min(w,h) × adj/100000 × 0.29289`.
- Google re-wraps text itself, so pin line breaks rather than relying on the source's.

## Expected result

On `fixtures/agent-dark-deck.json` with `--target google-slides`: all 8
slides within 1.5px, 0 line-break mismatches.
