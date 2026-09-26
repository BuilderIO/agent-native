import { chromium } from "@playwright/test";
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

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="box-a"
       style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

describe("Escape mid-drag cancels an in-screen move even when it loses the postMessage race", () => {
  it("reverts a commit that already landed before the cancel message arrived", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const committed: Record<string, string>[] = [];
      await page.exposeFunction(
        "__pushCommit",
        (styles: Record<string, string>) => committed.push(styles),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as {
            type?: string;
            styles?: Record<string, string>;
          };
          if (data?.type === "visual-style-change") {
            (window as any).__pushCommit(data.styles);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      // as the host would, at the real keydown — even though, per the race
      const pressedAt = await page.evaluate(() => Date.now());
      await page.mouse.up();
      await page.waitForTimeout(30);

      expect(
        committed[committed.length - 1]?.left,
        "the drag must have committed AWAY from the start position first, or this test proves nothing about the race",
      ).not.toBe("30px");

      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, pressedAt);
      await page.waitForTimeout(30);

      expect(
        committed[committed.length - 1],
        "a cancel that arrives after the commit must still revert it",
      ).toMatchObject({ left: "30px", top: "280px" });

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(domPosition).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  });

  it("does nothing when no drag is active", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage({ type: "agent-native:cancel-active-drag" }, "*");
      });
      await page.waitForTimeout(30);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("a normal (non-racing) Escape mid-drag still cancels the move", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.evaluate(() => {
        window.postMessage({ type: "agent-native:cancel-active-drag" }, "*");
      });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(domPosition).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  });

  it("physically pressing Escape during a same-frame drag cancels before release", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.mouse.up();

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(domPosition).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  });

  it("does not revert a completed drag from an unrelated Escape reaching the local (focus-in-iframe) path after mouseup", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const afterCommit = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterCommit).not.toBe("30px");

      await page.keyboard.press("Escape");
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(
        domPosition.left,
        "an unrelated Escape after the drag already committed must not revert it",
      ).not.toBe("30px");
    } finally {
      await browser.close();
    }
  });

  it("does not revert a completed drag from a host cancel-message whose Escape was pressed genuinely after the mouseup", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const afterCommit = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterCommit).not.toBe("30px");

      const pressedAt = await page.evaluate(() => Date.now());
      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, pressedAt);
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(
        domPosition.left,
        "an Escape pressed after the drag already released must not revert it",
      ).not.toBe("30px");
    } finally {
      await browser.close();
    }
  });

  it("a stale cancel for gesture A does not revert it once a new gesture has started", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(200, 380, { steps: 6 });
      await page.waitForTimeout(20);
      await page.mouse.up();
      await page.waitForTimeout(20);
      const afterA = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterA, "gesture A must have moved the box").not.toBe("30px");

      await page.mouse.move(500, 500);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(20);

      await page.evaluate(() => {
        window.postMessage({ type: "agent-native:cancel-active-drag" }, "*");
      });
      await page.waitForTimeout(20);

      const finalLeft = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(
        finalLeft,
        "A's own stale cancel must not revert A after the user moved on",
      ).toBe(afterA);
    } finally {
      await browser.close();
    }
  });

  it("a same-tick release and Escape (equal timestamps) does not revert", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        var capture = (e: Event) => {
          (window as any).__capturedReleaseTimeStamp = e.timeStamp;
        };
        window.addEventListener("mouseup", capture, true);
        window.addEventListener("pointerup", capture, true);
      });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const afterCommit = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterCommit).not.toBe("30px");

      const tiedPressedAt = await page.evaluate(
        () =>
          performance.timeOrigin + (window as any).__capturedReleaseTimeStamp,
      );
      expect(typeof tiedPressedAt).toBe("number");
      expect(Number.isNaN(tiedPressedAt)).toBe(false);
      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, tiedPressedAt);
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({ left: el.style.left }));
      expect(
        domPosition.left,
        "a tied pressedAt/releasedAt must not revert the commit",
      ).not.toBe("30px");
    } finally {
      await browser.close();
    }
  });

  it("a delayed cancel for gesture A arriving after gesture B has already started does not cancel B", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(150, 350, { steps: 4 });
      await page.waitForTimeout(20);
      const staleAPressedAt = await page.evaluate(() => Date.now());
      await page.mouse.up();
      await page.waitForTimeout(20);
      const afterA = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterA, "gesture A must have moved the box").not.toBe("30px");

      await page.mouse.move(150, 350);
      await page.mouse.down();
      await page.mouse.move(250, 400, { steps: 6 });
      await page.waitForTimeout(20);
      const duringB = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(duringB, "gesture B must be actively dragging").not.toBe(afterA);

      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, staleAPressedAt);
      await page.waitForTimeout(20);

      await page.mouse.up();
      await page.waitForTimeout(20);
      const afterB = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(
        afterB,
        "A's stale, delayed cancel must not cancel gesture B",
      ).toBe(duringB);
    } finally {
      await browser.close();
    }
  });
});
