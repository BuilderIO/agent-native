import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

const IGNORE_AUTO_LAYOUT_KEY = process.platform === "darwin" ? "Control" : "s";

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

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:16px;padding:24px">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row"
         style="display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha"
           style="width:100px;height:60px;background:#3b82f6"></div>
      <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta"
           style="width:100px;height:60px;background:#22c55e"></div>
    </div>
    <div data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"
         style="width:100px;height:60px;background:#f59e0b"></div>
  </main>
</body></html>`;

describe("Ctrl-drag out of an auto-layout parent", () => {
  it("never posts a cross-screen-drag message, and the child actually leaves the row", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const crossScreenMessages: string[] = [];
      await page.exposeFunction("__pushCrossScreen", (phase: string) =>
        crossScreenMessages.push(phase),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as { type?: string; phase?: string };
          if (data?.type === "agent-native:cross-screen-drag") {
            (window as any).__pushCrossScreen(data.phase ?? "");
          }
        });
      });
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
      await page.keyboard.down(IGNORE_AUTO_LAYOUT_KEY);
      await page.mouse.down();
      await page.mouse.move(74, 130, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.keyboard.up(IGNORE_AUTO_LAYOUT_KEY);
      await page.waitForTimeout(50);

      expect(
        crossScreenMessages,
        "a ctrl-drag overriding auto-layout resistance must never hand the gesture to the host's cross-screen path",
      ).toEqual([]);

      const rowHtml = await page
        .locator('[data-agent-native-node-id="row"]')
        .evaluate((el) => el.outerHTML);
      expect(
        rowHtml.includes('data-agent-native-node-id="alpha"'),
        `Ctrl-drag should be able to pull Alpha out of the flex row against normal auto-layout drag resistance; row still contains it: ${rowHtml}`,
      ).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it("late Control cancels the host path before local Ignore Auto Layout resolves", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const crossScreenMessages: string[] = [];
      await page.exposeFunction("__pushCrossScreenLate", (phase: string) =>
        crossScreenMessages.push(phase),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as { type?: string; phase?: string };
          if (data?.type === "agent-native:cross-screen-drag") {
            (window as any).__pushCrossScreenLate(data.phase ?? "");
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
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
      await page.mouse.move(74, 62, { steps: 2 });
      const beforeModifier = crossScreenMessages.length;
      await page.keyboard.down("Control");
      await page.mouse.move(74, 260, { steps: 10 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.keyboard.up("Control");

      expect(
        crossScreenMessages.slice(beforeModifier),
        "a late Control transition must revoke the already-armed host gesture",
      ).toEqual(["cancel"]);
      const result = await page
        .locator('[data-agent-native-node-id="alpha"]')
        .evaluate((element) => ({
          parent: element.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          position: getComputedStyle(element).position,
        }));
      expect(result.position).toBe("absolute");
    } finally {
      await browser.close();
    }
  });

  it("Control pressed after a host claim still cancels locally without another pointer move", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      const phases: string[] = [];
      await page.exposeFunction("__pushCrossScreenNoMove", (phase: string) =>
        phases.push(phase),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as { type?: string; phase?: string };
          if (data?.type !== "agent-native:cross-screen-drag") return;
          (window as any).__pushCrossScreenNoMove(data.phase ?? "");
          if (data.phase === "start") {
            setTimeout(() => {
              window.postMessage(
                { type: "agent-native:cross-screen-claim", claimed: true },
                "*",
              );
            }, 4);
          }
        });
      });
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
      await page.mouse.move(74, 70, { steps: 3 });
      await page.waitForTimeout(30);
      await page.mouse.move(250, 200, { steps: 10 });
      await page.keyboard.down("Control");
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.waitForTimeout(50);

      expect(phases).toContain("start");
      expect(phases).toContain("cancel");
      expect(phases).not.toContain("end");
      const result = await page
        .locator('[data-agent-native-node-id="alpha"]')
        .evaluate((element) => ({
          parent: element.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          position: getComputedStyle(element).position,
        }));
      expect(result.parent).not.toBe("row");
      expect(result.position).toBe("absolute");
    } finally {
      await browser.close();
    }
  });
});
