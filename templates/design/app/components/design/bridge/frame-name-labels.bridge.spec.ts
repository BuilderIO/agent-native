import { chromium, type Browser } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(boardSurface: boolean): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("frame-label-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", boardSurface ? "true" : "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.GITHUB_ACTIONS === "true" ? { channel: "chrome" } : {}),
  });
}

const content = `<!doctype html><html><head></head><body data-agent-native-layer-name="Screen 1" style="margin:0">
  <div data-agent-native-node-id="draft-frame-1" layer-name="Imported frame" data-an-primitive="frame" style="position:absolute;left:184px;top:109px;width:382px;height:283px;background:#ffffff">
    <div data-agent-native-node-id="rect-1" data-agent-native-layer-name="Rectangle" data-an-primitive="rectangle" style="position:absolute;left:16px;top:16px;width:48px;height:48px;background:#d4d4d8"></div>
  </div>
</body></html>`;

async function frameLabelTexts(
  browser: Browser,
  boardSurface: boolean,
): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.setContent(content);
    await page.addScriptTag({
      content: hydratedEditorChromeBridgeScript(boardSurface),
    });
    await page.waitForTimeout(1_000);
    return await page.evaluate(() =>
      Array.from(
        document.querySelectorAll("[data-agent-native-frame-label]"),
        (label) => label.textContent ?? "",
      ),
    );
  } finally {
    await page.close();
  }
}

async function dragFrameByLabel(browser: Browser, interact = false) {
  const page = await browser.newPage();
  try {
    await page.setContent(content);
    await page.addScriptTag({
      content: hydratedEditorChromeBridgeScript(true),
    });
    const label = page.locator("[data-agent-native-frame-label]");
    await label.waitFor();
    if (interact) {
      await page.evaluate(() =>
        window.postMessage(
          { type: "set-interaction-mode", interact: true },
          "*",
        ),
      );
      await page.waitForFunction(() =>
        document.documentElement.hasAttribute("data-agent-native-interact"),
      );
    }
    const frame = page.locator('[data-agent-native-node-id="draft-frame-1"]');
    const before = await frame.boundingBox();
    const box = await label.boundingBox();
    if (!before || !box) throw new Error("frame or label not rendered");
    const start = { x: box.x + 8, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(start.x + step * 10, start.y + step * 5);
    }
    const during = await frame.boundingBox();
    await page.mouse.up();
    return { before, during };
  } finally {
    await page.close();
  }
}

async function clickLabelSelection(browser: Browser): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.setContent(content);
    await page.evaluate(() => {
      (window as unknown as { selected: string[] }).selected = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type !== "element-select") return;
        (window as unknown as { selected: string[] }).selected.push(
          event.data.payload?.sourceId ?? event.data.payload?.id ?? "",
        );
      });
    });
    await page.addScriptTag({
      content: hydratedEditorChromeBridgeScript(true),
    });
    await page.locator("[data-agent-native-frame-label]").click();
    await page.waitForTimeout(200);
    return await page.evaluate(
      () => (window as unknown as { selected: string[] }).selected,
    );
  } finally {
    await page.close();
  }
}

describe("editor chrome frame name labels", () => {
  it("renames a board frame from its title", { timeout: 60_000 }, async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(content);
      await page.evaluate(() => {
        window.addEventListener("message", (event) => {
          if (event.data?.type === "frame-label-rename")
            (window as any).renamed = event.data;
        });
      });
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(true),
      });
      await page.locator("[data-agent-native-frame-label]").dblclick();
      const input = page.locator("[data-agent-native-frame-label-input]");
      expect(await input.count()).toBe(1);
      await input.fill("Workspace");
      await input.press("Enter");
      await page.waitForFunction(() => Boolean((window as any).renamed));
      expect(await page.evaluate(() => (window as any).renamed.name)).toBe(
        "Workspace",
      );
      expect(
        await page.evaluate(() => (window as any).renamed.payload.sourceId),
      ).toBe("draft-frame-1");
    } finally {
      await browser.close();
    }
  });

  it(
    "selects a board frame once when its name label is clicked",
    { timeout: 60_000 },
    async () => {
      const browser = await launchBrowser();
      try {
        expect(await clickLabelSelection(browser)).toEqual(["draft-frame-1"]);
      } finally {
        await browser.close();
      }
    },
  );

  it("drags a board frame by its name label", { timeout: 60_000 }, async () => {
    const browser = await launchBrowser();
    try {
      const { before, during } = await dragFrameByLabel(browser);
      expect(during).not.toBeNull();
      expect(Math.round(during!.x - before.x)).toBe(60);
      expect(Math.round(during!.y - before.y)).toBe(30);
    } finally {
      await browser.close();
    }
  });

  it(
    "leaves a board frame in place when its label is dragged in interaction mode",
    {
      timeout: 60_000,
    },
    async () => {
      const browser = await launchBrowser();
      try {
        const { before, during } = await dragFrameByLabel(browser, true);
        expect(during).toEqual(before);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "labels a top-level board frame but nothing inside a screen document",
    { timeout: 60_000 },
    async () => {
      const browser = await launchBrowser();
      try {
        expect(await frameLabelTexts(browser, true)).toEqual([
          "Imported frame",
        ]);
        expect(await frameLabelTexts(browser, false)).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});
