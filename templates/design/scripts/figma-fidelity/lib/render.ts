/// <reference lib="dom" />
/**
 * Renders a fidelity candidate (imported HTML, or an exported SVG) to a PNG at
 * exactly the source frame's canvas size.
 *
 * Every wait here exists because skipping it produces a *plausible* screenshot
 * that silently omits content — a blank web font, an image still in flight, a
 * pending layout pass. A fidelity harness that screenshots early reports a
 * false diff and sends the next fix at the wrong target, so unmet waits are
 * raised, never swallowed.
 */
import type { Browser, Page } from "@playwright/test";

export interface RenderOptions {
  width: number;
  height: number;
  /** 2 matches the scale the Figma REST image endpoint is asked for. */
  deviceScaleFactor?: number;
  /** Extra <link>/<style> injected into <head> (web fonts for imports). */
  headHtml?: string;
  /** Milliseconds to wait for fonts/images before failing. */
  timeoutMs?: number;
  /**
   * Element to capture instead of the whole viewport. The screen frame — not
   * `<body>` — is what ships to Figma, and body carries page padding the frame
   * does not.
   */
  rootSelector?: string | null;
  /**
   * Where the frame's own origin sits inside the captured canvas.
   *
   * Figma's `/images` renders a node's INK extent (`absoluteRenderBounds`),
   * not its frame box: an unclipped frame whose content or shadow spills out
   * comes back larger, and when the spill is up or left the whole image is
   * shifted too. Rendering the frame box against that compares every pixel at
   * the wrong offset — it read as a 10% conversion defect on a table whose
   * only sin was a 2px shadow. Draw the frame at this offset inside an
   * ink-sized canvas so both sides cover the same region.
   */
  contentOffset?: { left: number; top: number };
}

export interface RenderResult {
  png: Buffer;
  /** Non-fatal notes worth surfacing in the run report. */
  warnings: string[];
}

const DOCUMENT_SHELL = (
  body: string,
  head: string,
  width: number,
  height: number,
  offset: { left: number; top: number },
) => `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  /* The canvas is the region Figma rendered; nothing may reflow it. */
  #figma-fidelity-root{position:relative;width:${width}px;height:${height}px;overflow:hidden}
  /* The frame's own origin, which is not the canvas origin when ink spills up/left. */
  #figma-fidelity-frame{position:absolute;left:${offset.left}px;top:${offset.top}px}
</style>
${head}
</head>
<body><div id="figma-fidelity-root"><div id="figma-fidelity-frame">${body}</div></div></body></html>`;

async function waitForAssets(page: Page, timeoutMs: number): Promise<string[]> {
  return page.evaluate(async (timeout) => {
    const warnings: string[] = [];
    const deadline = Date.now() + timeout;

    const images = Array.from(document.images);
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            let settled = false;
            const settle = (warning?: string) => {
              if (settled) return;
              settled = true;
              if (warning) warnings.push(warning);
              resolve();
            };
            if (img.complete) {
              // A broken image also reports complete; naturalWidth tells them apart.
              settle(
                img.naturalWidth
                  ? undefined
                  : `image failed: ${img.src.slice(0, 120)}`,
              );
              return;
            }
            img.addEventListener("load", () => settle(), { once: true });
            img.addEventListener(
              "error",
              () => settle(`image failed: ${img.src.slice(0, 120)}`),
              {
                once: true,
              },
            );
            setTimeout(
              () => settle(`image timed out: ${img.src.slice(0, 120)}`),
              Math.max(0, deadline - Date.now()),
            );
          }),
      ),
    );

    await document.fonts.ready;
    // document.fonts.ready resolves once pending loads settle, including
    // failures. Report families the page asked for but did not get, because a
    // silent fallback shifts every glyph and reads as a text-mapping bug.
    const requested = new Set<string>();
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const family = getComputedStyle(el)
        .fontFamily.split(",")[0]
        ?.replace(/['"]/g, "")
        .trim();
      if (family) requested.add(family);
    });
    for (const family of requested) {
      if (!document.fonts.check(`16px "${family}"`))
        warnings.push(`font unavailable: ${family}`);
    }

    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    return warnings;
  }, timeoutMs);
}

export async function renderHtmlToPng(
  browser: Browser,
  bodyHtml: string,
  options: RenderOptions,
): Promise<RenderResult> {
  const { width, height } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const context = await browser.newContext({
    viewport: { width: Math.ceil(width), height: Math.ceil(height) },
    deviceScaleFactor: options.deviceScaleFactor ?? 2,
  });
  const page = await context.newPage();
  try {
    await page.setContent(
      DOCUMENT_SHELL(
        bodyHtml,
        options.headHtml ?? "",
        width,
        height,
        options.contentOffset ?? { left: 0, top: 0 },
      ),
      { waitUntil: "load", timeout: timeoutMs },
    );
    await page.evaluate("globalThis.__name ||= (fn) => fn;");
    const warnings = await waitForAssets(page, timeoutMs);
    const root = page.locator("#figma-fidelity-root");
    const png = await root.screenshot({
      omitBackground: true,
      timeout: timeoutMs,
    });
    return { png, warnings };
  } finally {
    await context.close();
  }
}

/**
 * Renders a complete stored HTML document (what `design_files.content` holds)
 * at the screen's authored frame size. Unlike `renderHtmlToPng` this does not
 * wrap the markup — the document's own <head>, fonts and styles are the thing
 * under test.
 */
export async function renderDocumentToPng(
  browser: Browser,
  documentHtml: string,
  options: RenderOptions,
): Promise<RenderResult> {
  const { width, height } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const context = await browser.newContext({
    viewport: { width: Math.ceil(width), height: Math.ceil(height) },
    deviceScaleFactor: options.deviceScaleFactor ?? 2,
  });
  const page = await context.newPage();
  try {
    await page.setContent(documentHtml, {
      waitUntil: "load",
      timeout: timeoutMs,
    });
    await page.evaluate("globalThis.__name ||= (fn) => fn;");
    // Alpine.js and the Tailwind CDN JIT mutate the DOM after load; the export
    // walker waits the same 300ms, so the two sides see the same tree.
    await page.waitForTimeout(300);
    const warnings = await waitForAssets(page, timeoutMs);
    if (options.rootSelector) {
      const target = page.locator(options.rootSelector);
      if (!(await target.count())) {
        // Silently falling back to the viewport would compare two different
        // regions and score the mismatch as a rendering difference.
        throw new Error(
          `rootSelector matched nothing: ${options.rootSelector}`,
        );
      }
      const png = await target.first().screenshot({ timeout: timeoutMs });
      return { png, warnings };
    }
    const png = await page.screenshot({
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    });
    return { png, warnings };
  } finally {
    await context.close();
  }
}

/**
 * Renders an SVG string at the size it declares. Used for the export half of
 * the round trip, where the candidate is the SVG we hand to Figma.
 */
export async function renderSvgToPng(
  browser: Browser,
  svg: string,
  options: RenderOptions,
): Promise<RenderResult> {
  const sized = svg.replace(/<svg\b([^>]*)>/, (match, attrs: string) =>
    /\bwidth=/.test(attrs) && /\bheight=/.test(attrs)
      ? match
      : `<svg${attrs} width="${options.width}" height="${options.height}">`,
  );
  return renderHtmlToPng(browser, sized, options);
}
