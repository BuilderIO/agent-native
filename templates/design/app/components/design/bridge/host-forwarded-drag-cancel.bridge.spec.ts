import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("board"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="box-a"
       style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

describe("host-forwarded board drag", () => {
  it("is cancelled by the host's cancel-active-drag even when the board iframe loaded after the host", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(
        `<!doctype html><html><body style="margin:0"></body></html>`,
      );
      // The board iframe's time origin must trail the host's by more than the
      // gesture lasts, as it does whenever the board mounts after page load.
      await page.waitForTimeout(1500);
      await page.evaluate((srcdoc) => {
        const iframe = document.createElement("iframe");
        iframe.style.cssText =
          "border:0;width:800px;height:600px;position:absolute;left:0;top:0";
        iframe.srcdoc = srcdoc;
        document.body.appendChild(iframe);
        return new Promise((resolve) => (iframe.onload = resolve));
      }, FIXTURE);
      const frame = page.frames()[1];
      await frame.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        document.querySelector("iframe")!.contentWindow!.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      const boxPosition = () =>
        frame
          .locator('[data-agent-native-node-id="box-a"]')
          .evaluate((el: HTMLElement) => ({
            left: el.style.left,
            top: el.style.top,
          }));

      // Mirrors MultiScreenCanvas.beginBoardElementDrag: events are built in
      // the host realm and dispatched into the board document.
      const hostDispatch = (
        type: string,
        x: number,
        y: number,
        onOverlay = false,
      ) =>
        page.evaluate(
          ([type, x, y, onOverlay]) => {
            const doc = document.querySelector("iframe")!.contentDocument!;
            const target = onOverlay
              ? doc.querySelector(
                  '[data-agent-native-edit-overlay="selection"]',
                )!
              : doc;
            target.dispatchEvent(
              new MouseEvent(type as string, {
                clientX: x as number,
                clientY: y as number,
                buttons: type === "mouseup" ? 0 : 1,
                bubbles: true,
                cancelable: true,
              }),
            );
          },
          [type, x, y, onOverlay] as const,
        );

      await hostDispatch("mousedown", 90, 320, true);
      for (let step = 1; step <= 8; step += 1) {
        await hostDispatch("mousemove", 90 + step * 25, 320 + step * 12);
      }
      await page.waitForTimeout(50);
      expect(
        (await boxPosition()).left,
        "the forwarded drag must have moved the box, or the cancel proves nothing",
      ).not.toBe("30px");

      await page.evaluate(() => {
        document.querySelector("iframe")!.contentWindow!.postMessage(
          {
            type: "agent-native:cancel-active-drag",
            pressedAt: performance.timeOrigin + performance.now(),
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      expect(await boxPosition()).toEqual({ left: "30px", top: "280px" });

      await hostDispatch("mousemove", 400, 500);
      await page.waitForTimeout(50);
      expect(
        await boxPosition(),
        "a cancelled drag must stop following the pointer",
      ).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  }, 30_000);
});
