// Runs INSIDE the Google Slides editor page, once per slide. This file is
// TypeScript, so no console will take it as it stands — emit browser JS first,
// from templates/slides:
//   pnpm exec tsc scripts/export-fidelity/google-layout.ts --ignoreConfig \
//     --target es2022 --lib es2022,dom --outDir /tmp/gl
//   sed 's/^export //' /tmp/gl/google-layout.js
// Paste that output into the page (or hand the same stripped source to a
// browser automation tool's page-eval), then call the function. Do a full page
// navigation to `.../edit#slide=id.p<N>` first — hash-only navigation freezes
// a hidden tab, so the slide must actually be (re)loaded before this runs.
// See README.md for the full import + extraction procedure.
//
// Finds the largest on-screen <svg> (Slides renders each slide as its own
// SVG; >400px wide filters out toolbar/icon SVGs), then the largest 16:9
// path/rect inside it (the slide background) to get the px-per-slide-unit
// scale factor and the frame's screen origin. Every <text> is grouped by its
// nearest editor-owned shape ancestor, projected into 960-wide slide space
// via its own screen CTM, then runs within 1px of the same baseline are
// merged (Google splits a wrapped line into multiple adjacent <text> runs).
export function extractGoogleSlideLayout(
  slideNumber: number,
  // Decks ship in 16:9, 1:1, 9:16, 4:5 and 4:3, so the frame to look for and
  // the coordinate space to report in both come from the deck being checked.
  { aspect = 16 / 9, width = 960 }: { aspect?: number; width?: number } = {},
): string[] {
  const svg = [...document.querySelectorAll("svg")]
    .map((s) => ({ s, r: s.getBoundingClientRect() }))
    .filter((x) => x.r.width > 400)
    .sort((a, b) => b.r.width - a.r.width)[0]?.s;
  if (!svg) {
    throw new Error(
      "extractGoogleSlideLayout: no slide <svg> >400px wide found on the page",
    );
  }

  const f = [...svg.querySelectorAll("path,rect")]
    .map((e) => e.getBoundingClientRect())
    .filter(
      (r) => r.width > 300 && Math.abs(r.width / r.height - aspect) < 0.02,
    )
    .sort((a, b) => b.width - a.width)[0];
  if (!f) {
    throw new Error(
      `extractGoogleSlideLayout: no ${aspect.toFixed(3)}:1 slide frame (path/rect) found inside the slide SVG`,
    );
  }

  const k = width / f.width;
  type Run = { text: string; x: number; base: number; right: number };
  const byShape = new Map<string, Run[]>();
  for (const t of svg.querySelectorAll("text")) {
    const g = t.closest('g[id^="editor-"]:not([id*="paragraph"])');
    const id = g ? g.id : "";
    // Every rendered run counts. A styling tspan inherits the point declared
    // before it, so taking only the ones that state x/y drops their text and
    // reads back as a broken line. Leaf tspans only, or a wrapper's text would
    // be counted twice.
    const spans = [...t.querySelectorAll("tspan")].filter(
      (span) => !span.querySelector("tspan"),
    );
    // A <text> that holds its own text as well as tspans would lose that text
    // if only the tspans were measured, so measure the element as one run.
    const ownText = [...t.childNodes].some(
      (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
    );
    let carriedX = Number(t.getAttribute("x")) || 0;
    let carriedY = Number(t.getAttribute("y")) || 0;
    for (const node of spans.length && !ownText ? spans : [t]) {
      const m = node.getScreenCTM();
      if (!m) continue;
      // Transform the whole point rather than x alone: Google keeps each
      // line's offset in the element's own transform today, so `y` is usually
      // 0 and dropping its terms happens to land right — until a run has one.
      const declaredX = node.getAttribute("x");
      const declaredY = node.getAttribute("y");
      if (declaredX !== null) carriedX = Number(declaredX) || 0;
      if (declaredY !== null) carriedY = Number(declaredY) || 0;
      const x = carriedX;
      const y = carriedY;
      const bb = node.getBoundingClientRect();
      const runs = byShape.get(id) ?? [];
      runs.push({
        text: node.textContent || "",
        x: (m.a * x + m.c * y + m.e - f.left) * k,
        base: (m.b * x + m.d * y + m.f - f.top) * k,
        right: (bb.right - f.left) * k,
      });
      byShape.set(id, runs);
    }
  }

  const lines: Run[] = [];
  for (const [, runs] of byShape) {
    runs.sort((a, b) => a.base - b.base || a.x - b.x);
    let cur: Run | null = null;
    for (const r of runs) {
      if (cur && Math.abs(cur.base - r.base) < 1) {
        // Joined with a space on purpose: Google splits a line where it
        // consumed one far more often than it splits mid-word, and the
        // comparison collapses runs of whitespace — so a space too many costs
        // nothing, while a space too few reads as a changed line.
        cur.text += " " + r.text;
        cur.right = Math.max(cur.right, r.right);
        cur.x = Math.min(cur.x, r.x);
      } else {
        cur = { ...r };
        lines.push(cur);
      }
    }
  }

  return lines.map(
    (l) =>
      `${slideNumber}|${l.x.toFixed(1)}|${l.base.toFixed(1)}|${l.right.toFixed(1)}|${l.text}`,
  );
}
