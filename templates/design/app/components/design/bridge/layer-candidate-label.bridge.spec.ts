import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("label-fixture"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage" style="position:relative;width:400px;height:300px;background:#eee">
    <div data-agent-native-node-id="card" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#fff"><span>Tiana</span></div>
  </div>
</body></html>`;

const LEGACY_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage" style="position:relative;width:400px;height:300px;background:#eee">
    <div data-agent-native-node-id="card" layer-name="Imported card" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#fff"><span>Tiana</span></div>
  </div>
</body></html>`;

async function contextMenuLayerCandidates(
  content: string,
  clientX: number,
  clientY: number,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 600, height: 500 },
    });
    await page.setContent(content);
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        (window as any).__messages.push(event.data);
      });
    });
    await page.evaluate(
      ({ x, y }) => {
        const shield = document.querySelector(
          '[data-agent-native-edit-overlay="shield"]',
        );
        shield?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: x,
            clientY: y,
          }),
        );
      },
      { x: clientX, y: clientY },
    );
    await page.waitForFunction(() =>
      ((window as any).__messages ?? []).some(
        (message: any) => message.type === "element-contextmenu",
      ),
    );
    const messages: Array<Record<string, unknown>> = await page.evaluate(
      () => (window as any).__messages,
    );
    const contextMenu = messages.find(
      (message) => message.type === "element-contextmenu",
    ) as { layerCandidates?: Array<{ label?: string; info?: unknown }> };
    return contextMenu.layerCandidates ?? [];
  } finally {
    await browser.close();
  }
}

describe("layer candidate label matches the layers-panel name", () => {
  it("names an unnamed non-leaf container by what it is ('Frame'), not its child's text", async () => {
    const candidates = await contextMenuLayerCandidates(FIXTURE, 190, 140);
    const cardCandidate = candidates.find(
      (candidate) => (candidate.info as any)?.sourceId === "card",
    );
    expect(cardCandidate?.label).toBe("Frame");
    expect(cardCandidate?.label).not.toBe("Tiana");
  });

  it("reads a legacy imported layer-name attribute for nested layers", async () => {
    const candidates = await contextMenuLayerCandidates(
      LEGACY_FIXTURE,
      190,
      140,
    );
    const cardCandidate = candidates.find(
      (candidate) => (candidate.info as any)?.sourceId === "card",
    );
    expect(cardCandidate?.label).toBe("Imported card");
  });
});
