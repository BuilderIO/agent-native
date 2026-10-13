import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("screen-root-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, () => JSON.stringify(""));
}

const SCREEN_ROOT = `<!doctype html><html><body style="margin:0;display:flex;flex-direction:column;gap:20px;width:320px;height:260px">
  <section data-agent-native-node-id="first" style="width:280px;height:100px;flex:none">First</section>
  <section data-agent-native-node-id="second" style="width:280px;height:100px;flex:none">Second</section>
  <div data-agent-native-node-id="moving" style="position:absolute;left:360px;top:40px;width:60px;height:40px;background:#2563eb">Move</div>
</body></html>`;

describe("Settings navigation row drag targeting", () => {
  it("drags tab buttons instead of starting marquee selection", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;position:relative;width:640px;height:480px">
        <nav role="tablist" style="position:absolute;left:40px;top:40px;display:flex;flex-direction:column;gap:8px;width:240px;padding:8px">
          <button id="general-tab" data-agent-native-node-id="general" role="tab" style="display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:8px"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" /></svg><span>General</span></button>
          <button id="notifications-tab" data-agent-native-node-id="notifications" role="tab" style="display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:8px"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" /></svg><span>Notifications</span></button>
        </nav>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as any).__structureMessages = [];
        (window as any).__marqueeMessages = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-structure-change") {
            (window as any).__structureMessages.push(event.data);
          }
          if (event.data?.type === "agent-native:layer-marquee-selection") {
            (window as any).__marqueeMessages.push(event.data);
          }
        });
      });

      const source = (await page.locator("#general-tab").boundingBox())!;
      const target = (await page.locator("#notifications-tab").boundingBox())!;
      const start = {
        x: source.x + source.width - 8,
        y: source.y + source.height / 2,
      };
      expect(
        await page.evaluate(
          ({ x, y }) =>
            Array.from(document.elementsFromPoint(x, y)).find(
              (element) => !element.closest("[data-agent-native-edit-overlay]"),
            )?.id,
          start,
        ),
      ).toBe("general-tab");

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 8, start.y + 6, { steps: 2 });
      await page.mouse.move(
        target.x + target.width - 8,
        target.y + target.height / 2,
        { steps: 8 },
      );
      await page.mouse.up();
      await page.waitForTimeout(50);

      const result = await page.evaluate(() => ({
        structure: (window as any).__structureMessages,
        marquee: (window as any).__marqueeMessages,
        order: Array.from(
          document.querySelectorAll("nav > button"),
          (element) => element.id,
        ),
      }));
      expect(result.structure, JSON.stringify(result)).toHaveLength(1);
      expect(result.marquee).toHaveLength(0);
      expect(result.order).toEqual(["notifications-tab", "general-tab"]);
    } finally {
      await browser.close();
    }
  });
});

describe("Screen-root auto-layout drag", () => {
  it("flow-inserts an absolute layer into the root without falling back to coordinates", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(SCREEN_ROOT);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as any).__structureMessages = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-structure-change") {
            (window as any).__structureMessages.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="moving"]',
          },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        const target = document.querySelector(
          '[data-agent-native-node-id="moving"]',
        );
        if (!overlay || !target) return false;
        const overlayRect = overlay.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        return (
          getComputedStyle(overlay).display === "block" &&
          Math.abs(overlayRect.left - targetRect.left) < 2
        );
      });

      const source = await page
        .locator('[data-agent-native-node-id="moving"]')
        .boundingBox();
      expect(source).not.toBeNull();
      await page.mouse.move(
        source!.x + source!.width / 2,
        source!.y + source!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source!.x + source!.width / 2 + 10,
        source!.y + source!.height / 2 + 6,
        {
          steps: 4,
        },
      );
      await page.mouse.move(80, 115, { steps: 12 });
      await page.locator("[data-agent-native-insertion-guide]").waitFor();
      expect(
        await page
          .locator("[data-agent-native-insertion-guide]")
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe("block");
      await page.mouse.up();

      await page.waitForFunction(
        () => (window as any).__structureMessages.length === 1,
      );
      const message = await page.evaluate(
        () => (window as any).__structureMessages[0],
      );
      expect(message).toMatchObject({
        anchorSelector: '[data-agent-native-node-id="second"]',
        placement: "before",
        dropMode: "flow-insert",
      });
      expect(
        await page
          .locator("body > [data-agent-native-node-id]")
          .evaluateAll((elements) =>
            elements.map((element) =>
              element.getAttribute("data-agent-native-node-id"),
            ),
          ),
      ).toEqual(["first", "moving", "second"]);
      expect(
        await page
          .locator('[data-agent-native-node-id="moving"]')
          .evaluate((element) => ({
            position: getComputedStyle(element).position,
            left: (element as HTMLElement).style.left,
            top: (element as HTMLElement).style.top,
          })),
      ).toEqual({ position: "static", left: "", top: "" });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("does not use a root-flow anchor after the pointer leaves the root bounds", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(SCREEN_ROOT);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as any).__structureMessages = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-structure-change") {
            (window as any).__structureMessages.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="moving"]',
          },
          "*",
        );
      });
      await page.waitForSelector('[data-agent-native-node-id="moving"]');
      const source = await page
        .locator('[data-agent-native-node-id="moving"]')
        .boundingBox();
      expect(source).not.toBeNull();
      await page.mouse.move(
        source!.x + source!.width / 2,
        source!.y + source!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source!.x + source!.width / 2 + 10,
        source!.y + source!.height / 2 + 6,
        { steps: 4 },
      );
      await page.mouse.move(500, 115, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(50);

      expect(
        await page
          .locator("[data-agent-native-insertion-guide]")
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe("none");
      expect(
        await page.evaluate(() => (window as any).__structureMessages),
      ).toEqual([]);
      expect(
        await page
          .locator('[data-agent-native-node-id="moving"]')
          .evaluate((element) => getComputedStyle(element).position),
      ).toBe("absolute");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
