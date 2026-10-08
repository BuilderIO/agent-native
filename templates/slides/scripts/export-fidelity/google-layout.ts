export function extractGoogleSlideLayout(
  slideNumber: number,
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
    const spans = [...t.querySelectorAll("tspan")].filter(
      (span) => !span.querySelector("tspan"),
    );
    const ownText = [...t.childNodes].some(
      (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
    );
    let carriedX = Number(t.getAttribute("x")) || 0;
    let carriedY = Number(t.getAttribute("y")) || 0;
    for (const node of spans.length && !ownText ? spans : [t]) {
      const m = node.getScreenCTM();
      if (!m) continue;
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
