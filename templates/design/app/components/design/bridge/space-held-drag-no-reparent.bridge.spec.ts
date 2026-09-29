import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";

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

function embeddedWheelEditModeBridgeScript(): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "false")
    .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
    .replace("__EDITING_SAFETY_ENABLED__", "true");
}

function embeddedWheelInteractModeBridgeScript(): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "false")
    .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "true")
    .replace("__EDITING_SAFETY_ENABLED__", "false");
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:16px;padding:24px">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row"
         style="display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha"
           style="width:100px;height:60px;background:#3b82f6"></div>
      <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta"
           style="width:100px;height:60px;background:#22c55e"></div>
    </div>
    <section data-agent-native-node-id="section" data-agent-native-layer-name="Section"
         style="width:300px;height:200px;padding:16px;background:#1a1d24">
      <h2 data-agent-native-node-id="section-title" data-agent-native-layer-name="Section Title"
          style="margin:0">Section Title</h2>
    </section>
  </main>
</body></html>`;

describe("holding Space mid-drag suppresses reparenting", () => {
  it("keeps the dragged element in its original parent instead of nesting it into the section under the pointer", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: embeddedWheelEditModeBridgeScript() });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="alpha"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      await page.mouse.move(74, 54);
      await page.mouse.down();
      await page.mouse.move(174, 150, { steps: 10 });
      await page.keyboard.down("Space");
      await page.mouse.move(174, 200, { steps: 10 });
      await page.keyboard.up("Space");
      await page.mouse.up();
      await page.waitForTimeout(50);

      const dropped = await page.evaluate(() => {
        const node = document.querySelector(
          '[data-agent-native-node-id="alpha"]',
        );
        return {
          exists: !!node,
          insideSection: !!node?.closest("section"),
          insideMain: !!node?.closest("main"),
        };
      });
      expect(dropped.exists).toBe(true);
      expect(dropped.insideSection).toBe(false);
      expect(dropped.insideMain).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it("a stale 'space released' forward arriving after the drag already ended still clears state for the NEXT gesture", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="alpha"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      await page.mouse.move(74, 54);
      await page.mouse.down();
      await page.mouse.move(174, 150, { steps: 10 });
      await page.evaluate(() =>
        window.postMessage(
          { type: "agent-native:set-space-held", held: true },
          "*",
        ),
      );
      await page.mouse.move(174, 200, { steps: 10 });
      await page.mouse.up();
      await page.evaluate(() =>
        window.postMessage(
          { type: "agent-native:set-space-held", held: false },
          "*",
        ),
      );
      await page.waitForTimeout(50);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="beta"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      const betaBox = await page
        .locator('[data-agent-native-node-id="beta"]')
        .boundingBox();
      const sectionBox = await page
        .locator('[data-agent-native-node-id="section"]')
        .boundingBox();
      if (!betaBox || !sectionBox) throw new Error("missing box");
      await page.mouse.move(
        betaBox.x + betaBox.width / 2,
        betaBox.y + betaBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        sectionBox.x + sectionBox.width / 2,
        sectionBox.y + sectionBox.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.waitForTimeout(50);

      const html = await page.content();
      const mainCloseIdx = html.indexOf("</main>");
      const betaIdx = html.indexOf('data-agent-native-node-id="beta"');
      expect(
        betaIdx > 0 && betaIdx < mainCloseIdx,
        `A plain second drag (no Space) must stay inside <main>, not escape it the way gesture 1's Space-held drag did — a leaked keepCurrentFlowParent would do exactly that; html: ${html}`,
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("forwards Space keyup if the frame changes from Interact to Edit while Space is held", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        const chromeHost = document.createElement("div");
        chromeHost.setAttribute("data-agent-native-editor-chrome-host", "");
        document.body.append(chromeHost);
        (window as any).__spaceEvents = [];
        window.addEventListener("message", (event) => {
          if (
            event.data?.type === "design-hotkey" ||
            event.data?.type === "design-hotkey-up"
          ) {
            (window as any).__spaceEvents.push(event.data.type);
          }
        });
      });
      await page.addScriptTag({
        content: embeddedWheelInteractModeBridgeScript(),
      });

      await page.keyboard.down("Space");
      await page.waitForFunction(() =>
        (window as any).__spaceEvents.includes("design-hotkey"),
      );
      await page.evaluate(() =>
        window.postMessage(
          {
            type: "embedded-canvas-gesture-mode",
            wheelEnabled: false,
            spaceKeyForwardingEnabled: false,
            editingSafetyEnabled: true,
          },
          "*",
        ),
      );
      await page.waitForTimeout(20);
      await page.keyboard.up("Space");

      await expect
        .poll(() => page.evaluate(() => (window as any).__spaceEvents))
        .toEqual(["design-hotkey", "design-hotkey-up"]);
    } finally {
      await browser.close();
    }
  });
});
