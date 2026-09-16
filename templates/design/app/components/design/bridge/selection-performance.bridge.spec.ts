import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Selection is a hot path, and the two gestures below used to rebuild the full
 * `getElementInfo` payload — which snapshots portable computed styles for an
 * element AND its whole subtree — once per candidate, per frame.
 *
 * These assert bounded WORK, not elapsed time: a timing threshold would be
 * flaky on shared CI, while "how many elements did we build info for" and "how
 * many computed-style reads did the gesture cost" are exactly the quantities
 * that regressed, and they are deterministic.
 */
function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const CARDS = 60;

/** A grid of cards, each with three children — the shape of a generated
 *  screen, at a size where per-candidate work is measurable. */
function fixture(): string {
  const cols = 6;
  let html = `<!doctype html><html><body style="margin:0;width:800px;height:${
    Math.ceil(CARDS / cols) * 120 + 80
  }px">`;
  for (let i = 0; i < CARDS; i += 1) {
    const x = 20 + (i % cols) * 120;
    const y = 20 + Math.floor(i / cols) * 120;
    html += `<div data-agent-native-node-id="card-${i}" data-agent-native-layer-name="Card ${i}" style="position:absolute;left:${x}px;top:${y}px;width:100px;height:100px;background:#111827">
      <div data-agent-native-node-id="title-${i}" data-agent-native-layer-name="Title ${i}" style="position:absolute;left:8px;top:8px;width:80px;height:16px;background:#3b82f6"></div>
      <div data-agent-native-node-id="body-${i}" data-agent-native-layer-name="Body ${i}" style="position:absolute;left:8px;top:32px;width:80px;height:40px;background:#6b7280"></div>
      <div data-agent-native-node-id="action-${i}" data-agent-native-layer-name="Action ${i}" style="position:absolute;left:8px;top:78px;width:40px;height:14px;background:#a855f7"></div>
    </div>`;
  }
  return `${html}</body></html>`;
}

type CollectedInfo = {
  sourceId?: string;
  computedStyles?: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
};

async function openBridgePage(page: Page) {
  await page.setContent(fixture());
  // Count computed-style reads; the gesture's cost is dominated by them.
  await page.evaluate(`
    window.__styleReads = 0;
    var rawGetComputedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = function (el, pseudo) {
      window.__styleReads += 1;
      return rawGetComputedStyle(el, pseudo);
    };
    window.__marqueeMessages = [];
    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "agent-native:layer-marquee-selection") {
        window.__marqueeMessages.push(event.data);
      }
    });
  `);
  await page.addScriptTag({ content: hydratedBridge() });
  await page.waitForTimeout(150);
}

async function collectSelectableRects(
  page: Page,
  options: { deep: boolean; atPoint?: { x: number; y: number } },
): Promise<CollectedInfo[]> {
  return page.evaluate(
    ([deep, atPoint]) =>
      new Promise<CollectedInfo[]>((resolve) => {
        const id = `spec-${Math.random().toString(36).slice(2)}`;
        const onMessage = (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            correlationId?: string;
            payload?: CollectedInfo[];
          };
          if (
            data?.type !== "agent-native:selectable-rects-result" ||
            data.correlationId !== id
          ) {
            return;
          }
          window.removeEventListener("message", onMessage);
          resolve(data.payload ?? []);
        };
        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            type: "agent-native:collect-selectable-rects",
            correlationId: id,
            deep,
            ...(atPoint ? { atPoint } : {}),
          },
          "*",
        );
      }),
    [options.deep, options.atPoint ?? null] as const,
  );
}

function rectContainsPoint(
  info: CollectedInfo,
  point: { x: number; y: number },
): boolean {
  const { x, y, width, height } = info.boundingRect;
  return (
    point.x >= x &&
    point.x <= x + width &&
    point.y >= y &&
    point.y <= y + height
  );
}

describe("selectable-rects collect is bounded by the point it was asked about", () => {
  it("returns the containment chain, not every selectable node", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      // Inside card-0's "Body" child: the chain is card-0 > body-0.
      const point = { x: 60, y: 70 };
      const all = await collectSelectableRects(page, { deep: true });
      const atPoint = await collectSelectableRects(page, {
        deep: true,
        atPoint: point,
      });

      expect(errors, errors.join("\n")).toEqual([]);
      // Guard the fixture itself: the unfiltered collect must be big, or the
      // comparison below proves nothing.
      expect(all.length).toBeGreaterThan(200);

      // The host re-filters in board space (drillInChainAtPoint), so this pass
      // must never DROP a candidate the host would have kept.
      const hostWouldKeep = all
        .filter((info) => rectContainsPoint(info, point))
        .map((info) => info.sourceId)
        .sort();
      const returned = atPoint.map((info) => info.sourceId).sort();
      expect(hostWouldKeep.length).toBeGreaterThan(0);
      expect(returned).toEqual(expect.arrayContaining(hostWouldKeep));

      // ...and it must be a small superset, not the whole document. This is
      // the regression guard: an unfiltered collect here is what pushed
      // double-click drill-in past the host's 400 ms reply timeout.
      expect(atPoint.length).toBeLessThan(all.length / 10);
      expect(atPoint.length).toBeLessThanOrEqual(hostWouldKeep.length + 4);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("agrees with the reported boundingRect space when the document is scrolled", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 400 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      // The host derives `atPoint` by inverting the same mapping it applied to
      // `info.boundingRect`, and rectInfoForElement reports that rect in
      // DOCUMENT space (client rect + scroll). Scrolling is where a filter
      // written in viewport space would silently drop the element under the
      // pointer, so pin the two spaces against each other with the page
      // scrolled well past the first row.
      await page.evaluate("window.scrollTo(0, 420);");
      await page.waitForTimeout(50);
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(0);

      const all = await collectSelectableRects(page, { deep: true });
      // Pick a small, deep target that is on screen after the scroll.
      const target = all.find((info) => info.sourceId?.startsWith("action-"));
      expect(target).toBeDefined();
      const centre = {
        x: target!.boundingRect.x + target!.boundingRect.width / 2,
        y: target!.boundingRect.y + target!.boundingRect.height / 2,
      };

      const atPoint = await collectSelectableRects(page, {
        deep: true,
        atPoint: centre,
      });

      expect(errors, errors.join("\n")).toEqual([]);
      expect(atPoint.map((info) => info.sourceId)).toContain(target!.sourceId);
      // Still narrowed, not silently widened back to the whole document.
      expect(atPoint.length).toBeLessThan(all.length / 10);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("builds full element info for the chain it returns", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      await openBridgePage(page);
      const atPoint = await collectSelectableRects(page, {
        deep: true,
        atPoint: { x: 60, y: 70 },
      });
      // Narrowing the candidate set must not also lean out the payload: the
      // host canonicalizes this into `selectedElement`, and style commits,
      // nudge, paste-over and motion all read `computedStyles` off it.
      expect(atPoint.length).toBeGreaterThan(0);
      for (const info of atPoint) {
        expect(Object.keys(info.computedStyles ?? {}).length).toBeGreaterThan(
          0,
        );
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("a marquee drag does not rebuild element info every frame", () => {
  it("keeps computed-style reads proportional to elements, not to frames", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      await page.evaluate("window.__styleReads = 0;");
      await page.mouse.move(8, 8);
      await page.mouse.down();
      await page.mouse.move(780, 700, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(80);

      const { styleReads, messages, selectedCount } = await page.evaluate(
        () => {
          const msgs = (
            window as unknown as {
              __marqueeMessages: Array<{ payload?: unknown[] }>;
            }
          ).__marqueeMessages;
          return {
            styleReads: (window as unknown as { __styleReads: number })
              .__styleReads,
            messages: msgs.length,
            selectedCount: (msgs[msgs.length - 1]?.payload ?? []).length,
          };
        },
      );

      expect(errors, errors.join("\n")).toEqual([]);
      // The drag really did sweep a large hit-set over many frames.
      expect(messages).toBeGreaterThan(5);
      expect(selectedCount).toBeGreaterThan(20);

      // Before the per-gesture memo, every frame rebuilt getElementInfo for
      // every element still inside the band, so reads scaled with
      // frames x elements. They must now scale with elements alone.
      expect(styleReads).toBeLessThan(messages * selectedCount);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("still reports the swept elements, and tags exactly one final report", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      await openBridgePage(page);
      await page.mouse.move(8, 8);
      await page.mouse.down();
      await page.mouse.move(780, 700, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(80);

      const { finals, lastIsFinal, lastIds } = await page.evaluate(() => {
        const msgs = (
          window as unknown as {
            __marqueeMessages: Array<{
              intent?: { final?: boolean };
              payload?: Array<{ sourceId?: string }>;
            }>;
          }
        ).__marqueeMessages;
        return {
          finals: msgs.filter((m) => m.intent?.final === true).length,
          lastIsFinal: msgs[msgs.length - 1]?.intent?.final === true,
          lastIds: (msgs[msgs.length - 1]?.payload ?? []).map(
            (p) => p.sourceId ?? "",
          ),
        };
      });

      // rAF-coalescing the move handler must not swallow or duplicate the
      // mouseup report: the host records one undo step per gesture off it.
      expect(finals).toBe(1);
      expect(lastIsFinal).toBe(true);
      expect(lastIds).toEqual(expect.arrayContaining(["card-0"]));
    } finally {
      await browser.close();
    }
  }, 60_000);
});
