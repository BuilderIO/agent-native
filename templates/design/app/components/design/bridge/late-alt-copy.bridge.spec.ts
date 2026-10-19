import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
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

const FIXTURE = `<!doctype html><html><body style="margin:0;position:relative;width:900px;height:900px">
  <section data-agent-native-node-id="row" style="position:absolute;left:80px;top:80px;width:360px;height:112px;padding:16px;box-sizing:border-box;display:flex;gap:16px">
    <div data-agent-native-node-id="child" style="width:100px;height:48px;background:#6366f1"></div>
    <div data-agent-native-node-id="peer" style="width:100px;height:48px;background:#a855f7"></div>
  </section>
  <section data-agent-native-node-id="target-row" style="position:absolute;left:520px;top:80px;width:280px;height:112px;padding:16px;box-sizing:border-box;display:flex;gap:16px">
    <div data-agent-native-node-id="target-peer" style="width:100px;height:48px;background:#ec4899"></div>
  </section>
  <div data-agent-native-node-id="free" style="position:absolute;left:80px;top:400px;width:120px;height:64px;background:#22c55e"></div>
</body></html>`;

async function openWithHeldLateAltCopy(
  page: Page,
  duplicates: string[],
  nodeId: string,
  grab: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.setContent(FIXTURE);
  await page.exposeFunction("__pushDuplicate", (cloneHtml: string) =>
    duplicates.push(cloneHtml),
  );
  await page.evaluate(() => {
    window.addEventListener("message", (e: MessageEvent) => {
      if (e.data?.type === "visual-duplicate-change") {
        (window as any).__pushDuplicate(e.data.cloneHtml);
      }
    });
  });
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.evaluate((id) => {
    window.postMessage(
      {
        type: "select-element",
        selector: `[data-agent-native-node-id="${id}"]`,
      },
      "*",
    );
  }, nodeId);
  await page.waitForTimeout(30);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 5, grab.y + 4, { steps: 2 });
  await page.keyboard.down("Alt");
  await page.mouse.move(to.x, to.y, { steps: 10 });
  expect(
    await page.locator('[data-agent-native-clone-root="true"]').count(),
  ).toBe(1);
}

/** With keyboard focus in the host, dispatches the release before the host's already-posted cancel arrives. */
async function releaseBehindForwardedEscape(
  page: Page,
  at: { x: number; y: number },
) {
  await page.evaluate((point) => {
    document.hasFocus = () => false;
    window.postMessage(
      { type: "agent-native:cancel-active-drag", pressedAt: Date.now() - 1 },
      "*",
    );
    for (const type of ["pointerup", "mouseup"]) {
      const Ctor = type === "pointerup" ? PointerEvent : MouseEvent;
      document.dispatchEvent(
        new Ctor(type, {
          bubbles: true,
          clientX: point.x,
          clientY: point.y,
          altKey: true,
        }),
      );
    }
  }, at);
  await page.keyboard.up("Alt");
}

function rectOf(page: Page, nodeId: string) {
  return page
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
}

describe("late-Alt copy", () => {
  it("of a flow child takes no slot in the source row while held and saves without the hold styles", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const duplicates: string[] = [];
      await openWithHeldLateAltCopy(
        page,
        duplicates,
        "child",
        { x: 146, y: 120 },
        { x: 611, y: 120 },
      );

      expect([await rectOf(page, "child"), await rectOf(page, "peer")]).toEqual(
        [
          { x: 96, y: 96, width: 100, height: 48 },
          { x: 212, y: 96, width: 100, height: 48 },
        ],
      );

      await page.mouse.up();
      await page.keyboard.up("Alt");
      await page.waitForTimeout(50);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).not.toMatch(/position|important/);
    } finally {
      await browser.close();
    }
  });

  it("of a flow child is discarded by a forwarded Escape that the release overtook", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const duplicates: string[] = [];
      await openWithHeldLateAltCopy(
        page,
        duplicates,
        "child",
        { x: 146, y: 120 },
        { x: 611, y: 120 },
      );

      await releaseBehindForwardedEscape(page, { x: 611, y: 120 });
      await page.waitForTimeout(50);

      expect(duplicates).toEqual([]);
      expect(
        await page.locator('[data-agent-native-clone-root="true"]').count(),
      ).toBe(0);
      expect(await rectOf(page, "child")).toEqual({
        x: 96,
        y: 96,
        width: 100,
        height: 48,
      });
    } finally {
      await browser.close();
    }
  });

  it("of a free layer is discarded by a forwarded Escape that the release overtook", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const duplicates: string[] = [];
      await openWithHeldLateAltCopy(
        page,
        duplicates,
        "free",
        { x: 140, y: 432 },
        { x: 640, y: 600 },
      );

      await releaseBehindForwardedEscape(page, { x: 640, y: 600 });
      await page.waitForTimeout(50);

      expect(duplicates).toEqual([]);
      expect(
        await page.locator('[data-agent-native-clone-root="true"]').count(),
      ).toBe(0);
      expect(await rectOf(page, "free")).toEqual({
        x: 80,
        y: 400,
        width: 120,
        height: 64,
      });
    } finally {
      await browser.close();
    }
  });
});
