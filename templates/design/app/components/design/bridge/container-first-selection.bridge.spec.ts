import { chromium } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return (
    editorChromeBridgeScript
      .replace("__READ_ONLY__", "false")
      .replace("__TEXT_EDITING_ENABLED__", "false")
      .replace("__EDITOR_CHROME_SCALE_X__", "1")
      .replace("__EDITOR_CHROME_SCALE_Y__", "1")
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
      // This suite exercises the board's Figma container-first policy. Screen
      // content intentionally uses direct single-click selection instead.
      .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
      .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
      .replace(/__INITIAL_SOURCE_HEAD__/g, '""')
  );
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
       style="position:absolute;left:40px;top:40px;width:280px;height:200px;background:#111827">
    <div data-agent-native-node-id="kid-a" data-agent-native-layer-name="Kid A"
         style="position:absolute;left:16px;top:16px;width:110px;height:80px;background:#3b82f6"></div>
  </div>
  <div data-agent-native-node-id="solo-a" data-agent-native-layer-name="Solo A"
       style="position:absolute;left:40px;top:300px;width:120px;height:80px;background:#a855f7"></div>
  <div data-agent-native-node-id="solo-b" data-agent-native-layer-name="Solo B"
       style="position:absolute;left:190px;top:300px;width:120px;height:80px;background:#ec4899"></div>
</body></html>`;

describe("container-first click selection", () => {
  it("clicking a child nested inside Card selects Card, not the child", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const selected: string[] = [];
      await page.exposeFunction("__pushSelected", (id: string) =>
        selected.push(id),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as {
            type?: string;
            payload?: { sourceId?: string };
          };
          if (data?.type === "element-select") {
            (window as any).__pushSelected(data.payload?.sourceId ?? "");
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.mouse.click(111, 96);
      await vi.waitFor(() => expect(selected.length).toBeGreaterThan(0));

      expect(selected[selected.length - 1]).toBe("card");
      expect(selected).not.toContain("kid-a");
    } finally {
      await browser.close();
    }
  });

  it("shift+click toggles an already-selected object off", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const overlayCount = () =>
        page.evaluate(
          () =>
            document.querySelectorAll(
              "[data-agent-native-edit-overlay='multi-selection']:not([data-agent-native-multi-selection-bounds])",
            ).length,
        );

      await page.mouse.click(100, 340);
      await page.waitForTimeout(50);
      await page.keyboard.down("Shift");
      await page.mouse.click(250, 340);
      await page.waitForTimeout(50);

      expect(await overlayCount()).toBe(1);

      await page.mouse.click(250, 340);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(50);

      expect(await overlayCount()).toBe(0);
      const finalPrimary = await page.evaluate(() => {
        const overlay = document.querySelector(
          "[data-agent-native-edit-overlay='selection']",
        ) as HTMLElement | null;
        if (!overlay || overlay.style.display === "none") return null;
        return { left: overlay.style.left, top: overlay.style.top };
      });
      expect(finalPrimary?.left).toBe("40px");
    } finally {
      await browser.close();
    }
  });
});
