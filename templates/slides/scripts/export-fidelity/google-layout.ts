// Runs INSIDE the Google Slides editor page (paste into devtools, or invoke
// via a browser automation tool's page-eval), once per slide. Do a full page
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
export function extractGoogleSlideLayout(slideNumber: number): string[] {
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
      (r) => r.width > 300 && Math.abs(r.width / r.height - 16 / 9) < 0.02,
    )
    .sort((a, b) => b.width - a.width)[0];
  if (!f) {
    throw new Error(
      "extractGoogleSlideLayout: no 16:9 slide frame (path/rect) found inside the slide SVG",
    );
  }

  const k = 960 / f.width;
  type Run = { text: string; x: number; base: number; right: number };
  const byShape = new Map<string, Run[]>();
  for (const t of svg.querySelectorAll("text")) {
    const g = t.closest('g[id^="editor-"]:not([id*="paragraph"])');
    const id = g ? g.id : "";
    const m = t.getScreenCTM();
    if (!m) continue;
    const x = Number(t.getAttribute("x")) || 0;
    // Transform the whole point, not just x: Google keeps each line's offset in
    // the element's own transform today, so `y` is usually 0 and dropping its
    // terms happens to land right — until a run carries one.
    const y = Number(t.getAttribute("y")) || 0;
    const bb = t.getBoundingClientRect();
    const runs = byShape.get(id) ?? [];
    runs.push({
      text: t.textContent || "",
      x: (m.a * x + m.c * y + m.e - f.left) * k,
      base: (m.b * x + m.d * y + m.f - f.top) * k,
      right: (bb.right - f.left) * k,
    });
    byShape.set(id, runs);
  }

  const lines: Run[] = [];
  for (const [, runs] of byShape) {
    runs.sort((a, b) => a.base - b.base || a.x - b.x);
    let cur: Run | null = null;
    for (const r of runs) {
      if (cur && Math.abs(cur.base - r.base) < 1) {
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
