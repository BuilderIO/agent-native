import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
} from "../../shared/aspect-ratios.ts";
import { resolvePnpmEntry, pick } from "./resolve-pkg.ts";

const BASE_URL = process.env.SLIDES_BASE_URL ?? "http://localhost:3106";
const REF_OUTPUT_WIDTH = 1600;

function getDims(aspectRatio: string | undefined) {
  const key =
    aspectRatio && aspectRatio in ASPECT_RATIOS
      ? aspectRatio
      : DEFAULT_ASPECT_RATIO;
  return (ASPECT_RATIOS as Record<string, { width: number; height: number }>)[
    key
  ];
}

function parseArgs(argv: string[]) {
  const layoutOnly = argv.includes("--layout-only");
  argv = argv.filter((a) => a !== "--layout-only");
  const outIndex = argv.indexOf("--out");
  if (outIndex === -1 || !argv[outIndex + 1]) {
    throw new Error(
      "Usage: export.ts <fixture.json|--deck <id>> --out <dir> [--layout-only]",
    );
  }
  const outDir = path.resolve(argv[outIndex + 1]);
  if (argv[0] === "--deck") {
    const deckId = argv[1];
    if (!deckId) throw new Error("--deck requires an id");
    return {
      outDir,
      deckId,
      fixturePath: undefined as string | undefined,
      layoutOnly,
    };
  }
  if (!argv[0]) throw new Error("Provide a fixture path or --deck <id>");
  return {
    outDir,
    deckId: undefined as string | undefined,
    fixturePath: path.resolve(argv[0]),
    layoutOnly,
  };
}

/**
 * Runs inside the page. Clones the same DOM node the real exporters read
 * (`findSlideExportSource`) into an UNSCALED 960x540 stage — no `scale()`
 * transform, unlike the reference-PNG stage — so `getBoundingClientRect()`
 * and `Range` measurements come back directly in slide px.
 *
 * "Text element" = the nearest block-level (display !== "inline") ancestor
 * of a run of non-whitespace text nodes. Lines are reconstructed by walking
 * every codepoint of every text node belonging to that element, measuring
 * its rendered rect with a collapsed `Range`, and grouping consecutive
 * glyphs whose vertical center stays within ~2px (a real line-wrap moves
 * the center by a full line-height, never ~2px).
 *
 * Baseline is NOT measured with the textbook "insert a zero-size
 * `vertical-align: baseline` probe span, read its rect" trick — that
 * technique, tested here against multiple real multi-line slide paragraphs,
 * reproducibly returns the FIRST line's baseline for interior lines in
 * Chromium (confirmed independent of probe insertion order, removal,
 * `normalize()`, probe size, and text-align — see README.md). Instead,
 * baseline is derived from the font's own metrics: canvas
 * `measureText().fontBoundingBoxAscent/Descent` for the element's exact
 * computed font shorthand, applied to each line's OWN already-correct
 * (non-mutated) top/bottom via the standard CSS half-leading formula
 * (`baseline = top + (lineBoxHeight - (ascent+descent))/2 + ascent`). This
 * never touches the DOM, so it can't hit the same bug, and it reproduced
 * the two independently-verified-correct baselines (first and last line of
 * a 3-line heading) exactly before being trusted for the interior line.
 *
 * ponytail: does not dedupe collapsed multi-space runs in source text (each
 * source space gets its own Range measurement); add a same-rect skip if a
 * deck ever ships irregular whitespace and lines start double-counting gaps.
 */
async function computeSlideLayoutInPage({
  slideId,
  index,
  total,
  dims,
}: {
  slideId: string;
  index: number;
  total: number;
  dims: { width: number; height: number };
}): Promise<{ texts: any[] }> {
  const GENERIC_FAMILIES = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong",
  ]);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  function isHiddenAncestor(el: Element, root: Element): boolean {
    let cur: Element | null = el;
    while (cur) {
      if (cur.getAttribute("aria-hidden") === "true") return true;
      const cs = getComputedStyle(cur);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      if (cur === root) break;
      cur = cur.parentElement;
    }
    return false;
  }

  function domPath(el: Element, root: Element): string {
    const parts: number[] = [];
    let cur: Element | null = el;
    while (cur && cur !== root) {
      const parent: Element | null = cur.parentElement;
      if (!parent) break;
      parts.unshift(Array.prototype.indexOf.call(parent.children, cur));
      cur = parent;
    }
    return parts.join(".");
  }

  function stackFamilies(computedFamily: string): string[] {
    return computedFamily
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, ""));
  }

  let measureCtx: CanvasRenderingContext2D | null = null;
  const fontAvailabilityCache = new Map<string, boolean>();
  function isFontAvailable(family: string): boolean {
    const cached = fontAvailabilityCache.get(family);
    if (cached !== undefined) return cached;
    if (!measureCtx)
      measureCtx = document.createElement("canvas").getContext("2d");
    const ctx = measureCtx!;
    const testString = "mmmmmmmmmmlli 0123 WwQq";
    ctx.font = `72px "${family}", monospace`;
    const withMono = ctx.measureText(testString).width;
    ctx.font = `72px monospace`;
    const mono = ctx.measureText(testString).width;
    ctx.font = `72px "${family}", serif`;
    const withSerif = ctx.measureText(testString).width;
    ctx.font = `72px serif`;
    const serif = ctx.measureText(testString).width;
    const available = !(withMono === mono && withSerif === serif);
    fontAvailabilityCache.set(family, available);
    return available;
  }

  function renderedFamilyGuess(computedFamily: string): string | undefined {
    return stackFamilies(computedFamily).find((f) =>
      GENERIC_FAMILIES.has(f.toLowerCase()),
    );
  }

  type Glyph = { char: string; node: Text; offset: number; rect: DOMRect };

  function collectGlyphs(textNodes: Text[]): Glyph[] {
    const range = document.createRange();
    const glyphs: Glyph[] = [];
    for (const node of textNodes) {
      const value = node.nodeValue ?? "";
      let offset = 0;
      for (const ch of Array.from(value)) {
        const len = ch.length;
        range.setStart(node, offset);
        range.setEnd(node, offset + len);
        const rect = Array.from(range.getClientRects()).find(
          (r) => r.width > 0 || r.height > 0,
        );
        if (rect) glyphs.push({ char: ch, node, offset, rect });
        offset += len;
      }
    }
    return glyphs;
  }

  function groupIntoLines(glyphs: Glyph[]): Glyph[][] {
    const lines: Glyph[][] = [];
    let current: Glyph[] | null = null;
    let refCenter = 0;
    for (const g of glyphs) {
      const center = (g.rect.top + g.rect.bottom) / 2;
      if (current && Math.abs(center - refCenter) <= 2) {
        current.push(g);
      } else {
        current = [g];
        refCenter = center;
        lines.push(current);
      }
    }
    return lines;
  }

  let metricsCtx: CanvasRenderingContext2D | null = null;
  const fontMetricsCache = new Map<
    string,
    { ascent: number; descent: number }
  >();
  function fontAscentDescent(fontShorthand: string): {
    ascent: number;
    descent: number;
  } {
    const cached = fontMetricsCache.get(fontShorthand);
    if (cached) return cached;
    if (!metricsCtx)
      metricsCtx = document.createElement("canvas").getContext("2d");
    const ctx = metricsCtx!;
    const canvasFont = fontShorthand.replace(/\s*\/\s*\S+/, "");
    ctx.font = "10px serif";
    ctx.font = canvasFont;
    if (ctx.font === "10px serif" && canvasFont !== "10px serif") {
      throw new Error(`canvas refused the font shorthand: ${fontShorthand}`);
    }
    const m: any = ctx.measureText("Hxg");
    const result = {
      ascent: m.fontBoundingBoxAscent,
      descent: m.fontBoundingBoxDescent,
    };
    fontMetricsCache.set(fontShorthand, result);
    return result;
  }

  document.querySelectorAll("[data-layout-stage]").forEach((el) => el.remove());
  const { findSlideExportSource }: any = await import(
    "/app/" + "lib/export-pdf-client.ts"
  );
  const source = findSlideExportSource(slideId, index, total);

  const stage = document.createElement("div");
  stage.setAttribute("data-layout-stage", "true");
  Object.assign(stage.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: `${dims.width}px`,
    height: `${dims.height}px`,
    overflow: "hidden",
    zIndex: "2147483647",
  });
  const clone = source.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: "absolute",
    top: "0",
    left: "0",
    width: `${dims.width}px`,
    height: `${dims.height}px`,
    maxWidth: `${dims.width}px`,
    maxHeight: `${dims.height}px`,
    transform: "none",
  });
  clone.removeAttribute("contenteditable");
  for (const el of Array.from(clone.querySelectorAll("[contenteditable]"))) {
    el.removeAttribute("contenteditable");
  }
  stage.appendChild(clone);
  document.body.appendChild(stage);

  const images = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", () => resolve(undefined));
            img.addEventListener("error", () => resolve(undefined));
          }),
    ),
  );
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

  const cloneRect = clone.getBoundingClientRect();

  const groups: { owner: HTMLElement; textNodes: Text[] }[] = [];
  const groupIndex = new Map<
    HTMLElement,
    { owner: HTMLElement; textNodes: Text[] }
  >();
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    const value = node.nodeValue ?? "";
    if (!value.trim()) continue;
    const parent = node.parentElement;
    if (!parent || isHiddenAncestor(parent, clone)) continue;
    let owner: HTMLElement | null = parent;
    while (
      owner &&
      owner !== clone &&
      getComputedStyle(owner).display === "inline"
    ) {
      owner = owner.parentElement;
    }
    if (!owner) continue;
    let group = groupIndex.get(owner);
    if (!group) {
      group = { owner, textNodes: [] };
      groupIndex.set(owner, group);
      groups.push(group);
    }
    group.textNodes.push(node);
  }

  const texts: any[] = [];
  for (const { owner, textNodes } of groups) {
    const glyphs = collectGlyphs(textNodes);
    if (glyphs.length === 0) continue;
    const lineGroups = groupIntoLines(glyphs);

    const cs = getComputedStyle(owner);

    const lines = lineGroups.map((line) => {
      const top = Math.min(...line.map((g) => g.rect.top));
      const bottom = Math.max(...line.map((g) => g.rect.bottom));
      const lineFont = getComputedStyle(line[0].node.parentElement!).font;
      const { ascent, descent } = fontAscentDescent(lineFont);
      const halfLeading = (bottom - top - (ascent + descent)) / 2;
      const baseline = top + halfLeading + ascent;
      return {
        text: line.map((g) => g.char).join(""),
        x: round2(line[0].rect.left - cloneRect.left),
        right: round2(line[line.length - 1].rect.right - cloneRect.left),
        top: round2(top - cloneRect.top),
        bottom: round2(bottom - cloneRect.top),
        baseline: round2(baseline - cloneRect.top),
      };
    });

    const rect = owner.getBoundingClientRect();
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const paddingRight = parseFloat(cs.paddingRight) || 0;
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
    const borderRight = parseFloat(cs.borderRightWidth) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;

    const box = {
      x: round2(rect.left - cloneRect.left),
      y: round2(rect.top - cloneRect.top),
      w: round2(rect.width),
      h: round2(rect.height),
    };
    const contentBox = {
      x: round2(box.x + borderLeft + paddingLeft),
      y: round2(box.y + borderTop + paddingTop),
      w: round2(
        rect.width - borderLeft - borderRight - paddingLeft - paddingRight,
      ),
      h: round2(
        rect.height - borderTop - borderBottom - paddingTop - paddingBottom,
      ),
    };

    const family = (cs.fontFamily.split(",")[0] ?? "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const unavailableFamily = Boolean(family) && !isFontAvailable(family);
    const weightNum = Number(cs.fontWeight);

    const entry: any = {
      path: domPath(owner, clone),
      tag: owner.tagName,
      font: {
        family,
        sizePx: round2(parseFloat(cs.fontSize) || 0),
        weight: Number.isFinite(weightNum) ? weightNum : cs.fontWeight,
        letterSpacingPx:
          cs.letterSpacing === "normal"
            ? 0
            : round2(parseFloat(cs.letterSpacing) || 0),
        lineHeightPx:
          cs.lineHeight === "normal"
            ? null
            : round2(parseFloat(cs.lineHeight) || 0),
        textTransform: cs.textTransform,
      },
      align: cs.textAlign,
      box,
      contentBox,
      lines,
    };
    if (unavailableFamily) {
      entry.unavailableFamily = true;
      const guess = renderedFamilyGuess(cs.fontFamily);
      if (guess) entry.renderedFamilyGuess = guess;
    }
    texts.push(entry);
  }

  stage.remove();
  return { texts };
}

async function main() {
  const {
    outDir,
    deckId: existingDeckId,
    fixturePath,
    layoutOnly,
  } = parseArgs(process.argv.slice(2));
  await mkdir(outDir, { recursive: true });
  if (!layoutOnly) await mkdir(path.join(outDir, "ref"), { recursive: true });

  const playwrightMod: any = await import(
    resolvePnpmEntry("playwright", "1.63")
  );
  const chromium = pick<any>(playwrightMod, "chromium");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    console.log(`[export] signing in at ${BASE_URL}`);
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    const localDevButton = page
      .locator('button:has-text("Continue as local dev")')
      .first();
    await localDevButton.waitFor({ state: "visible", timeout: 15_000 });
    await localDevButton.click();
    await page
      .waitForFunction(
        () => !document.body.innerText.includes("Continue as local dev"),
        {
          timeout: 15_000,
        },
      )
      .catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});

    let deckId = existingDeckId;
    if (!deckId) {
      console.log(`[export] creating deck from fixture ${fixturePath}`);
      const fixture = JSON.parse(await readFile(fixturePath!, "utf8"));
      const created = await page.evaluate(async (body: unknown) => {
        const res = await fetch("/_agent-native/actions/create-deck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`create-deck ${res.status}: ${text}`);
        return JSON.parse(text);
      }, fixture);
      deckId = created.id;
      console.log(`[export] created deck ${deckId}`);
    }

    console.log(`[export] opening /deck/${deckId}`);
    await page.goto(`${BASE_URL}/deck/${deckId}`, {
      waitUntil: "domcontentloaded",
    });

    const deck = await page.evaluate(async (id: string) => {
      const res = await fetch(
        `/_agent-native/actions/get-deck?id=${encodeURIComponent(id)}&compact=false`,
      );
      const text = await res.text();
      if (!res.ok) throw new Error(`get-deck ${res.status}: ${text}`);
      return JSON.parse(text);
    }, deckId);

    const slideIds: string[] = deck.slides.map((s: any) => s.id);
    const dims = getDims(deck.aspectRatio);
    console.log(
      `[export] deck "${deck.title}" — ${slideIds.length} slides, aspect ${deck.aspectRatio ?? "16:9"} (${dims.width}x${dims.height})`,
    );

    console.log("[export] waiting for slide canvases + fonts");
    await page.waitForFunction(
      (ids: string[]) =>
        ids.every((id) =>
          document.querySelector(`[data-slide-canvas="${CSS.escape(id)}"]`),
        ),
      slideIds,
      { timeout: 30_000 },
    );
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );

    await page.evaluate(() => {
      const w = window as any;
      if (!w.__name) {
        w.__name = (target: any, value: string) => {
          try {
            Object.defineProperty(target, "name", {
              value,
              configurable: true,
            });
          } catch {
            // coercion-ok: best-effort name preservation only, never load-bearing.
          }
          return target;
        };
      }
    });

    console.log(
      `[export] computing per-line text layout for ${slideIds.length} slides`,
    );
    await mkdir(path.join(outDir, "layout"), { recursive: true });
    const layoutSummaryLines: string[] = [];
    let anyBaselineOutOfOrder = false;
    for (let i = 0; i < slideIds.length; i++) {
      const slideId = slideIds[i];
      const { texts }: { texts: any[] } = await page.evaluate(
        computeSlideLayoutInPage,
        {
          slideId,
          index: i,
          total: slideIds.length,
          dims,
        },
      );
      const num = String(i + 1).padStart(2, "0");
      const layoutPath = path.join(outDir, "layout", `slide-${num}.json`);
      await writeFile(
        layoutPath,
        JSON.stringify({ slide: i + 1, texts }, null, 2),
      );

      const totalLines = texts.reduce((sum, t) => sum + t.lines.length, 0);
      const unavailable = Array.from(
        new Set(
          texts.filter((t) => t.unavailableFamily).map((t) => t.font.family),
        ),
      );
      layoutSummaryLines.push(
        `slide-${num}: textElements=${texts.length} lines=${totalLines} unavailableFamilies=${
          unavailable.length ? unavailable.join(",") : "none"
        }`,
      );

      for (const t of texts) {
        for (let li = 1; li < t.lines.length; li++) {
          if (t.lines[li].baseline <= t.lines[li - 1].baseline) {
            anyBaselineOutOfOrder = true;
            console.error(
              `[export]   BASELINE OUT OF ORDER on slide-${num} ${t.path} line ${li}: ${t.lines[li - 1].baseline} -> ${t.lines[li].baseline}`,
            );
          }
        }
      }
      console.log(
        `[export]   ${layoutPath} (${texts.length} text elements, ${totalLines} lines)`,
      );
    }
    const summaryPath = path.join(outDir, "layout", "summary.txt");
    await writeFile(summaryPath, `${layoutSummaryLines.join("\n")}\n`);
    console.log(`[export] wrote ${summaryPath}`);
    if (anyBaselineOutOfOrder) {
      throw new Error(
        "Baseline was not strictly increasing across lines of a text element — see BASELINE OUT OF ORDER lines above.",
      );
    }

    if (layoutOnly) {
      console.log(
        `[export] --layout-only: skipping PPTX export and reference PNGs. deckId=${deckId}`,
      );
      return;
    }

    console.log(
      "[export] invoking buildDeckPptxBlob via the real browser exporter",
    );
    const exportResult = await page.evaluate(
      async ({ title, slides, aspectRatio }: any) => {
        const mod: any = await import("/app/" + "lib/export-pptx-client.ts");
        const { blob, filename, blankShapes } = await mod.buildDeckPptxBlob(
          title,
          slides,
          aspectRatio,
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return {
          base64: btoa(binary),
          filename,
          blankShapes,
          byteLength: bytes.length,
        };
      },
      {
        title: deck.title,
        slides: deck.slides.map((s: any) => ({
          id: s.id,
          notes: s.notes ?? undefined,
        })),
        aspectRatio: deck.aspectRatio,
      },
    );

    const pptxPath = path.join(outDir, "deck.pptx");
    await writeFile(pptxPath, Buffer.from(exportResult.base64, "base64"));
    console.log(
      `[export] wrote ${pptxPath} (${exportResult.byteLength} bytes, blankShapes=${exportResult.blankShapes})`,
    );
    if (exportResult.blankShapes > 0) {
      console.error(
        `[export] FAILED: ${exportResult.blankShapes} shape(s) rasterized empty and are missing from ${pptxPath}`,
      );
      process.exitCode = 1;
    }

    await writeFile(
      path.join(outDir, "meta.json"),
      JSON.stringify(
        {
          deckId,
          deckTitle: deck.title,
          aspectRatio: deck.aspectRatio ?? DEFAULT_ASPECT_RATIO,
          dims,
          slideIds,
          blankShapes: exportResult.blankShapes,
          filename: exportResult.filename,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    console.log(
      `[export] rendering ${slideIds.length} reference PNGs at ${REF_OUTPUT_WIDTH}x${Math.round((dims.height / dims.width) * REF_OUTPUT_WIDTH)}`,
    );
    const scale = REF_OUTPUT_WIDTH / dims.width;
    const outputHeight = Math.round(dims.height * scale);
    for (let i = 0; i < slideIds.length; i++) {
      const slideId = slideIds[i];
      await page.evaluate(
        async ({
          slideId,
          index,
          total,
          dims,
          scale,
          outputWidth,
          outputHeight,
        }: any) => {
          document
            .querySelectorAll("[data-ref-stage]")
            .forEach((el) => el.remove());
          const { findSlideExportSource }: any = await import(
            "/app/" + "lib/export-pdf-client.ts"
          );
          const source = findSlideExportSource(slideId, index, total);

          const stage = document.createElement("div");
          stage.setAttribute("data-ref-stage", "true");
          Object.assign(stage.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: `${outputWidth}px`,
            height: `${outputHeight}px`,
            overflow: "hidden",
            zIndex: "2147483647",
          });

          const clone = source.cloneNode(true) as HTMLElement;
          Object.assign(clone.style, {
            position: "absolute",
            top: "0",
            left: "0",
            width: `${dims.width}px`,
            height: `${dims.height}px`,
            maxWidth: `${dims.width}px`,
            maxHeight: `${dims.height}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          });
          clone.removeAttribute("contenteditable");
          for (const el of Array.from(
            clone.querySelectorAll("[contenteditable]"),
          )) {
            el.removeAttribute("contenteditable");
          }

          stage.appendChild(clone);
          document.body.appendChild(stage);

          const images = Array.from(clone.querySelectorAll("img"));
          await Promise.all(
            images.map((img) =>
              img.complete
                ? Promise.resolve()
                : new Promise((resolve) => {
                    img.addEventListener("load", () => resolve(undefined));
                    img.addEventListener("error", () => resolve(undefined));
                  }),
            ),
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        },
        {
          slideId,
          index: i,
          total: slideIds.length,
          dims,
          scale,
          outputWidth: REF_OUTPUT_WIDTH,
          outputHeight,
        },
      );

      const num = String(i + 1).padStart(2, "0");
      const refPath = path.join(outDir, "ref", `slide-${num}.png`);
      await page
        .locator('[data-ref-stage="true"]')
        .screenshot({ path: refPath });
      console.log(`[export]   ${refPath}`);
    }

    await page.evaluate(() => {
      document
        .querySelectorAll("[data-ref-stage]")
        .forEach((el) => el.remove());
    });

    console.log(`[export] done. deckId=${deckId}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[export] FAILED:", err);
  process.exit(1);
});
