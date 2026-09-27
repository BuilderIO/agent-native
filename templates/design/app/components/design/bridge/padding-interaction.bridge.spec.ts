import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("padding-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const WIDE_FRAME = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="frame" style="position:absolute;left:20px;top:20px;width:600px;height:40px;padding:20px;background:#333">
    <div style="width:20px;height:20px;background:#fff"></div>
  </div>
</body></html>`;

const PADDING_FRAME = `<!doctype html><html><body style="margin:0">
  <div id="card" data-agent-native-node-id="card" style="position:absolute;left:200px;top:150px;width:360px;height:220px;padding:40px 30px 20px 10px;background:#333;box-sizing:border-box">
    <div style="width:20px;height:20px;background:#fff"></div>
  </div>
</body></html>`;

const GAP_FRAME = `<!doctype html><html><body style="margin:0">
  <div id="row" data-agent-native-node-id="row" style="position:absolute;left:100px;top:100px;width:220px;height:100px;display:flex;gap:20px;background:#333">
    <div style="width:60px;height:40px;background:#fff"></div>
    <div style="width:60px;height:40px;background:#fff"></div>
  </div>
</body></html>`;

const THIN_PADDING_FRAME = `<!doctype html><html><body style="margin:0">
  <div id="card" data-agent-native-node-id="card" style="position:absolute;left:200px;top:150px;width:160px;height:100px;margin:0;padding:1px;background:#333;box-sizing:border-box"></div>
</body></html>`;

const MARGIN_LEAF = `<!doctype html><html><body style="margin:0">
  <div id="leaf" data-agent-native-node-id="leaf" style="position:absolute;left:240px;top:180px;width:160px;height:100px;margin:0;background:#c33"></div>
</body></html>`;

const MARGIN_MIRROR_LEAF = `<!doctype html><html><body style="margin:0">
  <div id="leaf" data-agent-native-node-id="leaf" style="position:absolute;left:240px;top:180px;width:160px;height:100px;margin:10px 20px 30px 40px;background:#c33"></div>
</body></html>`;

const MARGIN_AUTO_FLEX_ITEM = `<!doctype html><html><head><style>
  .row { position:absolute; left:100px; top:100px; display:flex; width:400px; height:80px }
  .item { width:80px; height:40px; margin-left:auto; background:#c33 }
</style></head><body style="margin:0">
  <div class="row"><div id="auto" data-agent-native-node-id="auto" class="item"></div></div>
</body></html>`;

async function installBridge(page: import("@playwright/test").Page) {
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

describe("padding interaction bridge", () => {
  it("uses one visual tick length for horizontal and vertical padding indicators", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(WIDE_FRAME);
      await installBridge(page);

      const box = (await page
        .locator('[data-agent-native-node-id="frame"]')
        .boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-agent-native-spacing-line="padding"]',
          ).length === 4,
      );

      const geometry = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '[data-agent-native-spacing-line="padding"]',
          ),
        ).map((node) => {
          const line = node as HTMLElement;
          return {
            width: parseFloat(line.style.width),
            height: parseFloat(line.style.height),
          };
        }),
      );
      const [top, bottom, left, right] = geometry;
      const tickLengths = [top.width, bottom.width, left.height, right.height];
      for (const length of tickLengths) {
        expect(length).toBeCloseTo(tickLengths[0], 5);
      }
    } finally {
      await browser.close();
    }
  });

  it("Shift-drag snaps all padding sides to the dragged value and scales them together", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(PADDING_FRAME);
      await installBridge(page);

      await page.mouse.click(205, 160);
      await page.waitForSelector('[data-spacing-key="padding:top"]');
      const handle = page.locator('[data-spacing-key="padding:top"]');
      const handleBox = (await handle.boundingBox())!;
      const handleX = handleBox.x + handleBox.width / 2;
      const handleY = handleBox.y + handleBox.height / 2;

      await page.keyboard.down("Shift");
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();

      const snapped = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById("card")!);
        return [
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
        ];
      });
      expect(snapped).toEqual(["40px", "40px", "40px", "40px"]);

      await page.mouse.move(handleX, handleY + 20, { steps: 5 });
      const scaled = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById("card")!);
        return [
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
        ];
      });
      expect(scaled).toEqual(["60px", "60px", "60px", "60px"]);

      await page.mouse.up();
      await page.keyboard.up("Shift");
    } finally {
      await browser.close();
    }
  });

  it("restores untouched margins when Shift is released during a drag", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(MARGIN_MIRROR_LEAF);
      await page.evaluate(() => {
        const target = window as typeof window & {
          __styleChanges?: Record<string, string>[];
        };
        target.__styleChanges = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-change") {
            target.__styleChanges?.push(event.data.styles);
          }
        });
      });
      await installBridge(page);

      const item = page.locator("#leaf");
      const margins = () =>
        item.evaluate((node) => {
          const style = (node as HTMLElement).style;
          return [
            style.marginTop,
            style.marginRight,
            style.marginBottom,
            style.marginLeft,
          ];
        });
      const itemBox = (await item.boundingBox())!;
      await page.mouse.click(
        itemBox.x + itemBox.width / 2,
        itemBox.y + itemBox.height / 2,
      );
      const handle = page.locator('[data-spacing-key="margin:top"]');
      await handle.waitFor({ timeout: 4_000 });
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.keyboard.down("Shift");
      await page.mouse.move(x, y - 8, { steps: 4 });

      expect(await margins()).toEqual(["18px", "18px", "18px", "18px"]);

      await page.keyboard.up("Shift");
      expect(await margins()).toEqual(["18px", "20px", "30px", "40px"]);

      await page.mouse.move(x, y - 12, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(() =>
        (
          window as typeof window & {
            __styleChanges?: Record<string, string>[];
          }
        ).__styleChanges?.some((styles) => styles.marginTop === "22px"),
      );

      expect(await margins()).toEqual(["22px", "20px", "30px", "40px"]);
      expect(
        await page.evaluate(
          () =>
            (
              window as typeof window & {
                __styleChanges?: Record<string, string>[];
              }
            ).__styleChanges?.slice(-1)[0],
        ),
      ).toEqual({ marginTop: "22px" });
    } finally {
      await browser.close();
    }
  });

  it("Shift-dragging a gap does not write padding", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(GAP_FRAME);
      await installBridge(page);

      const row = page.locator("#row");
      const rowBox = (await row.boundingBox())!;
      await page.mouse.click(rowBox.x + 4, rowBox.y + 80);
      const handle = page.locator('[data-spacing-key="gap:column:0"]');
      await handle.waitFor();
      const handleBox = (await handle.boundingBox())!;
      const x = handleBox.x + handleBox.width / 2;
      const y = handleBox.y + handleBox.height / 2;

      await page.keyboard.down("Shift");
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 8, y, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up("Shift");

      expect(
        await row.evaluate((node) => {
          const style = (node as HTMLElement).style;
          return [
            style.paddingTop,
            style.paddingRight,
            style.paddingBottom,
            style.paddingLeft,
            style.columnGap,
          ];
        }),
      ).toEqual(["", "", "", "", "28px"]);
    } finally {
      await browser.close();
    }
  });

  it("keeps a thin padding handle above the overlapping zero-margin handle", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(THIN_PADDING_FRAME);
      await page.evaluate(() => {
        const target = window as typeof window & {
          __styleChanges?: Record<string, string>[];
        };
        target.__styleChanges = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-change") {
            target.__styleChanges?.push(event.data.styles);
          }
        });
      });
      await installBridge(page);

      const card = page.locator("#card");
      const cardBox = (await card.boundingBox())!;
      await page.mouse.click(
        cardBox.x + cardBox.width / 2,
        cardBox.y + cardBox.height / 2,
      );
      const handle = page.locator('[data-spacing-key="padding:top"]');
      await handle.waitFor();
      const handleBox = (await handle.boundingBox())!;
      const x = handleBox.x + handleBox.width / 2;
      const y = handleBox.y + handleBox.height / 2;

      expect(
        await page.evaluate(
          ({ x, y }) =>
            document
              .elementsFromPoint(x, y)
              .find((node) =>
                node.matches("[data-agent-native-spacing-region]"),
              )
              ?.getAttribute("data-spacing-key"),
          { x, y },
        ),
      ).toBe("padding:top");

      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 6, { steps: 4 });
      await page.mouse.up();

      expect(
        await card.evaluate((node) => {
          const style = (node as HTMLElement).style;
          return [style.paddingTop, style.marginTop];
        }),
      ).toEqual(["7px", "0px"]);
      await page.waitForFunction(() =>
        (
          window as typeof window & {
            __styleChanges?: Record<string, string>[];
          }
        ).__styleChanges?.some(
          (styles) =>
            styles.paddingTop === "7px" && Object.keys(styles).length === 1,
        ),
      );
      expect(
        await page.evaluate(() =>
          (
            window as typeof window & {
              __styleChanges?: Record<string, string>[];
            }
          ).__styleChanges?.filter((styles) => styles.paddingTop === "7px"),
        ),
      ).toContainEqual({ paddingTop: "7px" });
    } finally {
      await browser.close();
    }
  });

  it("shows editable zero margin handles on leaves and commits signed CSS margins", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(MARGIN_LEAF);
      await page.evaluate(() => {
        const target = window as typeof window & {
          __styleChanges?: Record<string, string>[];
        };
        target.__styleChanges = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-change") {
            target.__styleChanges?.push(event.data.styles);
          }
        });
      });
      await installBridge(page);

      const item = page.locator("#leaf");
      const itemBox = (await item.boundingBox())!;
      await page.mouse.click(
        itemBox.x + itemBox.width / 2,
        itemBox.y + itemBox.height / 2,
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-spacing-key^="margin:"]').length ===
          4,
      );
      const handle = page.locator('[data-spacing-key="margin:top"]');
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 12, { steps: 4 });
      await page.mouse.up();

      await expectMargin(page, "12px");
      await page.waitForFunction(() =>
        (
          window as typeof window & {
            __styleChanges?: Record<string, string>[];
          }
        ).__styleChanges?.some((styles) => styles.marginTop === "12px"),
      );

      const updatedHandle = page.locator('[data-spacing-key="margin:top"]');
      const updatedBox = (await updatedHandle.boundingBox())!;
      await page.mouse.move(
        updatedBox.x + updatedBox.width / 2,
        updatedBox.y + updatedBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        updatedBox.x + updatedBox.width / 2,
        updatedBox.y + updatedBox.height / 2 + 24,
        { steps: 4 },
      );
      await page.mouse.up();

      await expectMargin(page, "-12px");
      await page.waitForFunction(() =>
        (
          window as typeof window & {
            __styleChanges?: Record<string, string>[];
          }
        ).__styleChanges?.some((styles) => styles.marginTop === "-12px"),
      );
    } finally {
      await browser.close();
    }
  });

  it("shows authored auto margins on canvas and preserves them on a no-op drag", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(MARGIN_AUTO_FLEX_ITEM);
      await page.evaluate(() => {
        const target = window as typeof window & {
          __styleChanges?: Record<string, string>[];
          __selectedMarginLeft?: string;
        };
        target.__styleChanges = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            target.__selectedMarginLeft =
              event.data.payload?.computedStyles?.marginLeft;
          }
          if (event.data?.type === "visual-style-change") {
            target.__styleChanges?.push(event.data.styles);
          }
        });
      });
      await installBridge(page);

      const item = page.locator("#auto");
      const itemBox = (await item.boundingBox())!;
      await page.mouse.click(
        itemBox.x + itemBox.width / 2,
        itemBox.y + itemBox.height / 2,
      );
      await page.waitForFunction(
        () =>
          (window as typeof window & { __selectedMarginLeft?: string })
            .__selectedMarginLeft === "auto",
      );
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __selectedMarginLeft?: string })
              .__selectedMarginLeft,
        ),
      ).toBe("auto");
      const handle = page.locator('[data-spacing-key="margin:left"]');
      await handle.waitFor();
      const handleBox = (await handle.boundingBox())!;
      const x = handleBox.x + handleBox.width / 2;
      const y = handleBox.y + handleBox.height / 2;

      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-agent-native-spacing-badge]")
            ?.textContent === "auto",
      );
      await page.mouse.up();

      expect(
        await item.evaluate((node) => (node as HTMLElement).style.marginLeft),
      ).toBe("");
      expect(
        await item.evaluate((node) => getComputedStyle(node).marginLeft),
      ).toBe("320px");
      expect(
        await page.evaluate(
          () =>
            (
              window as typeof window & {
                __styleChanges?: Record<string, string>[];
              }
            ).__styleChanges,
        ),
      ).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("restores a mirrored margin when Alt is released during a drag", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(MARGIN_MIRROR_LEAF);
      await page.evaluate(() => {
        const target = window as typeof window & {
          __styleChanges?: Record<string, string>[];
        };
        target.__styleChanges = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-change") {
            target.__styleChanges?.push(event.data.styles);
          }
        });
      });
      await installBridge(page);

      const item = page.locator("#leaf");
      const itemBox = (await item.boundingBox())!;
      await page.mouse.click(
        itemBox.x + itemBox.width / 2,
        itemBox.y + itemBox.height / 2,
      );
      const handle = page.locator('[data-spacing-key="margin:top"]');
      await handle.waitFor({ timeout: 4_000 });
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.keyboard.down("Alt");
      await page.mouse.move(x, y - 8, { steps: 4 });

      expect(
        await page.evaluate(() => {
          const element = document.getElementById("leaf") as HTMLElement;
          return [element.style.marginTop, element.style.marginBottom];
        }),
      ).toEqual(["18px", "18px"]);

      await page.keyboard.up("Alt");
      expect(
        await page.evaluate(() => {
          const element = document.getElementById("leaf") as HTMLElement;
          return [element.style.marginTop, element.style.marginBottom];
        }),
      ).toEqual(["18px", "30px"]);

      await page.mouse.move(x, y - 12, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(() =>
        (
          window as typeof window & {
            __styleChanges?: Record<string, string>[];
          }
        ).__styleChanges?.some((styles) => styles.marginTop === "22px"),
      );

      expect(
        await page.evaluate(() => {
          const element = document.getElementById("leaf") as HTMLElement;
          return [element.style.marginTop, element.style.marginBottom];
        }),
      ).toEqual(["22px", "30px"]);
      expect(
        await page.evaluate(
          () =>
            (
              window as typeof window & {
                __styleChanges?: Record<string, string>[];
              }
            ).__styleChanges?.slice(-1)[0],
        ),
      ).toEqual({ marginTop: "22px" });
    } finally {
      await browser.close();
    }
  });
});

async function expectMargin(
  page: import("@playwright/test").Page,
  value: string,
) {
  const actual = await page
    .locator("#leaf")
    .evaluate((node) => (node as HTMLElement).style.marginTop);
  expect(actual).toBe(value);
}
