import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Figma parity: selecting a short element and immediately dragging it from
 * its own center must start a MOVE, never a resize. Reported by Steve: a
 * freshly created text wordmark couldn't be dragged — the pointer moved
 * 200px+ horizontally with zero net `left` change, because the drag landed
 * on the south edge-resize handle instead of the shield.
 *
 * Root cause: applySelectionHandleHitGeometry's clamp of each handle's
 * inward reach is correct at rest (it leaves the central 50% of a short
 * element free, per multi-screen/handle-hit-zones.ts's own tested
 * invariant). But the handle spans are singletons reused across every
 * selection, and their geometry properties carry a 150ms CSS transition
 * meant only to ease a same-element chrome-scale (zoom) change. Selecting a
 * DIFFERENT element reuses those same spans, so the transition instead
 * eases from the PREVIOUS target's geometry to the new one — including from
 * the null-element page-load call, whose unclamped nominal reach can be
 * several times the new element's own half-height. A click landing inside
 * that ~150ms window can hit the transiently oversized handle even though
 * the settled geometry is safe.
 *
 * Runs the real generated bridge in a real browser: hit-testing and CSS
 * transitions need a real layout/paint engine, not happy-dom's stub.
 */
function hydratedEditorChromeBridgeScript(zoomFactor: number): string {
  // chromeScaleY() = 1 / editorChromeScaleY, so a placeholder of 1/3.1858
  // reproduces the reported chrome scale (a canvas zoomed to ~31%).
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", String(zoomFactor))
    .replace("__EDITOR_CHROME_SCALE_Y__", String(zoomFactor))
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// A large frame plus a short single-line text primitive sized like the
// reported wordmark (~19px tall), at the reported chrome scale (canvas
// zoomed to ~31%, chromeScaleY ~3.19).
const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="screen" style="position:absolute;left:10px;top:10px;width:800px;height:600px;background:#333"></div>
  <div data-agent-native-node-id="wordmark" style="position:absolute;left:900px;top:100px;width:70px;height:19.1875px;background:#111827"></div>
</body></html>`;
const ZOOM_FACTOR = 1 / 3.1858;
const AXIS_ALIGNED_TRANSFORM_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="wordmark" style="position:absolute;left:300px;top:100px;width:70px;height:19.1875px;background:#111827;transform:translate(80px, 30px) scale(1.4, 0.8)"></div>
</body></html>`;

describe("selection handle hit geometry", () => {
  it("dragging a just-selected short element from its own center never starts a resize", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
      });
      await page.setContent(FIXTURE);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(ZOOM_FACTOR),
      });

      // Select a large element first, exactly like a screen frame already
      // being selected (or simply having settled handle geometry from an
      // earlier interaction) before the short wordmark is selected.
      const screenBox = (await page
        .locator('[data-agent-native-node-id="screen"]')
        .boundingBox())!;
      await page.mouse.click(
        screenBox.x + screenBox.width / 2,
        screenBox.y + screenBox.height / 2,
      );
      await page.waitForTimeout(300);

      // Now select the short wordmark and immediately probe its own center
      // — no settle time, matching a real select-then-drag gesture where
      // the drag's mousedown can land within a frame or two of the select.
      const box = (await page
        .locator('[data-agent-native-node-id="wordmark"]')
        .boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx, cy);

      const hitAttr = await page.evaluate(
        ([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit
            ? (hit.getAttribute("data-agent-native-edge-handle") ??
                hit.getAttribute("data-agent-native-edit-handle"))
            : null;
        },
        [cx, cy],
      );

      expect(hitAttr).toBeNull();
    } finally {
      await browser.close();
    }
  });

  it("recomputes stale scaled handles before moving a resized runtime node", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
      });
      await page.setContent(FIXTURE);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(ZOOM_FACTOR),
      });

      const el = page.locator('[data-agent-native-node-id="wordmark"]');
      const initialBox = (await el.boundingBox())!;
      await page.mouse.click(
        initialBox.x + initialBox.width / 2,
        initialBox.y + initialBox.height / 2,
      );
      await page.waitForTimeout(300);

      // A runtime insert can be selected at its source size and settle into a
      // shorter destination layout before ResizeObserver gets a chance to
      // repaint the singleton selection handles. Keep the old geometry stale
      // on purpose, then drag from the node's center.
      await el.evaluate((node) => {
        (node as HTMLElement).style.height = "28px";
      });
      const settledBox = (await el.boundingBox())!;
      const before = await el.getAttribute("style");
      await page.mouse.move(
        settledBox.x + settledBox.width / 2,
        settledBox.y + settledBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        settledBox.x + settledBox.width / 2 + 60,
        settledBox.y + settledBox.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.waitForTimeout(200);

      const after = (await el.getAttribute("style")) ?? "";
      const leftOf = (style: string) =>
        Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN);
      const heightOf = (style: string) =>
        Number(/height:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN);
      expect(
        leftOf(after),
        `center drag of a settled runtime node must move it (before ${before}, after ${after})`,
      ).toBeGreaterThan(leftOf(before ?? ""));
      expect(heightOf(after)).toBeCloseTo(28, 2);
    } finally {
      await browser.close();
    }
  });

  it("keeps the center of a translated and scaled node move-draggable", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
      });
      await page.setContent(AXIS_ALIGNED_TRANSFORM_FIXTURE);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(ZOOM_FACTOR),
      });

      const el = page.locator('[data-agent-native-node-id="wordmark"]');
      const box = (await el.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);

      const before = await el.getAttribute("style");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 60,
        box.y + box.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.waitForTimeout(200);

      const after = (await el.getAttribute("style")) ?? "";
      const leftOf = (style: string) =>
        Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN);
      expect(
        leftOf(after),
        `center drag of an axis-aligned transformed node must move it (before ${before}, after ${after})`,
      ).toBeGreaterThan(leftOf(before ?? ""));
    } finally {
      await browser.close();
    }
  });
});

/**
 * Figma parity §3: the edge/corner resize band straddles the selection edge
 * — grabbing it a couple of px INSIDE the box resizes, it does not move. The
 * band's inward half is deliberate and already bounded by
 * clampHandleInwardReach (mirrored in multi-screen/handle-hit-zones.ts),
 * which guarantees the central 50% of each axis stays body-grabbable.
 *
 * A rotated element makes the point unmissable: the overlay (and its
 * handles) rotate with the element, so every edge handle sits strictly
 * inside the element's own axis-aligned getBoundingClientRect(). Any
 * mousedown rule phrased as "inside the element's rect is never a resize"
 * therefore disables edge resize for rotated elements entirely.
 */
const ROTATED_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="tilted" style="position:absolute;left:300px;top:200px;width:240px;height:160px;background:#2563eb;transform:rotate(45deg)"></div>
</body></html>`;

describe("rotated selection resize handles", () => {
  it("dragging a rotated element's east edge handle resizes it instead of moving it", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
      });
      await page.setContent(ROTATED_FIXTURE);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(1),
      });

      const el = page.locator('[data-agent-native-node-id="tilted"]');
      const box = (await el.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);

      const before = await el.getAttribute("style");
      const handle = page.locator('[data-agent-native-edge-handle="e"]');
      const handleBox = (await handle.boundingBox())!;
      const hx = handleBox.x + handleBox.width / 2;
      const hy = handleBox.y + handleBox.height / 2;

      await page.mouse.move(hx, hy);
      await page.mouse.down();
      await page.mouse.move(hx + 60, hy + 60, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      const after = (await el.getAttribute("style")) ?? "";
      const widthOf = (style: string) =>
        Number(/width:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN);
      const leftOf = (style: string) =>
        Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN);

      expect(
        widthOf(after),
        `east-handle drag on a rotated element must change its width (before ${before}, after ${after})`,
      ).not.toBeCloseTo(widthOf(before ?? ""), 1);
      expect(
        leftOf(after),
        `east-handle drag on a rotated element must not translate it (before ${before}, after ${after})`,
      ).toBeCloseTo(leftOf(before ?? ""), 0);
    } finally {
      await browser.close();
    }
  });
});
