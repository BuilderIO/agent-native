import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

// A single screen's iframe: the body is the screen frame.
function hydratedScreenBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "true")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// The shape the design agent writes: a card of rows, each row holding leaves.
const FIXTURE = `<!doctype html><html><body style="margin:0;width:900px;height:600px">
  <div data-agent-native-node-id="card" style="position:absolute;left:40px;top:40px;width:400px;height:260px;background:#f4f4f5;display:flex;flex-direction:column;gap:20px;padding:20px;box-sizing:border-box">
    <div data-agent-native-node-id="title" style="height:40px;background:#a1a1aa"></div>
    <div data-agent-native-node-id="actions" style="height:80px;display:flex;gap:20px;background:#d4d4d8">
      <div data-agent-native-node-id="primary" style="width:120px;height:80px;background:#3b82f6">
        <div data-agent-native-node-id="primary-label" style="margin:20px;width:80px;height:40px;background:#1d4ed8"></div>
      </div>
      <div data-agent-native-node-id="secondary" style="width:120px;height:80px;background:#22c55e"></div>
    </div>
  </div>
  <section data-agent-native-node-id="hero" style="position:absolute;left:480px;top:40px;width:360px;height:260px;background:#fde68a">
    <div data-agent-native-node-id="hero-copy" style="margin:40px;width:200px;height:60px;background:#f59e0b"></div>
  </section>
</body></html>`;

// Points inside each layer, deepest first.
const PRIMARY_LABEL = { x: 120, y: 160 };
const SECONDARY = { x: 260, y: 160 };
const HERO_COPY = { x: 600, y: 110 };

async function openFixture(page: Page, html = FIXTURE) {
  await page.setContent(html);
  await page.evaluate(() => {
    (window as any).__selected = [];
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type === "element-select") {
        (window as any).__selected.push(event.data.payload?.sourceId ?? "");
      }
    });
  });
  await page.addScriptTag({ content: hydratedScreenBridge() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
}

async function selectionAfter(page: Page, gesture: () => Promise<void>) {
  const before = await page.evaluate(
    () => ((window as any).__selected as string[]).length,
  );
  await gesture();
  await page.waitForFunction(
    (count) => ((window as any).__selected as string[]).length > count,
    before,
    { timeout: 2_000 },
  );
  // A double-click fires two clicks first; let every message land.
  await page.waitForTimeout(150);
  const selected = await page.evaluate(() => {
    const ids = (window as any).__selected as string[];
    return ids[ids.length - 1];
  });
  // Clear the double-click window before the next gesture.
  await page.waitForTimeout(500);
  return selected;
}

async function withPage(run: (page: Page) => Promise<void>, html = FIXTURE) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await openFixture(page, html);
    await run(page);
  } finally {
    await browser.close();
  }
}

const click = (page: Page, point: { x: number; y: number }) => () =>
  page.mouse.click(point.x, point.y);
const dblclick = (page: Page, point: { x: number; y: number }) => () =>
  page.mouse.dblclick(point.x, point.y);

describe("click depth inside a screen", () => {
  // oracle-change: screen clicks directly select semantic content; the board retains container-first selection.
  it("a plain click selects the nested layer under the pointer", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, click(page, PRIMARY_LABEL))).toBe(
        "primary-label",
      );
    });
  });

  it("the click-only shield path selects the same nested layer", async () => {
    await withPage(async (page) => {
      expect(
        await selectionAfter(page, () =>
          page
            .locator('[data-agent-native-edit-overlay="shield"]')
            .dispatchEvent("click", {
              clientX: PRIMARY_LABEL.x,
              clientY: PRIMARY_LABEL.y,
              detail: 1,
            }),
        ),
      ).toBe("primary-label");
    });
  });

  it("selects content inside a section directly", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, click(page, HERO_COPY))).toBe(
        "hero-copy",
      );
    });
  });

  it("a double-click on a non-text leaf keeps that leaf selected", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, dblclick(page, PRIMARY_LABEL))).toBe(
        "primary-label",
      );
    });
  });

  it("selects siblings and content in another container without retaining depth", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, click(page, PRIMARY_LABEL))).toBe(
        "primary-label",
      );
      expect(await selectionAfter(page, click(page, SECONDARY))).toBe(
        "secondary",
      );
      expect(await selectionAfter(page, click(page, HERO_COPY))).toBe(
        "hero-copy",
      );
      expect(await selectionAfter(page, click(page, PRIMARY_LABEL))).toBe(
        "primary-label",
      );
    });
  });

  it.each(["frame", "auto-layout"] as const)(
    "clicks select a child while dragging at the same point moves its selected %s",
    async (kind) => {
      const html = `<!doctype html><html><body style="margin:0;width:900px;height:600px">
        <div data-agent-native-node-id="parent" ${kind === "frame" ? 'data-an-primitive="frame"' : ""}
          style="position:absolute;left:40px;top:40px;width:300px;height:220px;background:#ddd;${kind === "auto-layout" ? "display:flex;padding:20px;box-sizing:border-box" : ""}">
          <div data-agent-native-node-id="child" style="${kind === "frame" ? "position:absolute;left:20px;top:20px;" : ""}width:100px;height:80px;background:#333"></div>
        </div>
      </body></html>`;
      await withPage(async (page) => {
        const selectParent = async () => {
          await selectionAfter(page, () =>
            page.evaluate(() => {
              window.postMessage(
                {
                  type: "select-element",
                  selector: '[data-agent-native-node-id="parent"]',
                },
                "*",
              );
            }),
          );
        };
        await selectParent();
        expect(await selectionAfter(page, click(page, { x: 100, y: 90 }))).toBe(
          "child",
        );
        await selectParent();
        const child = page.locator('[data-agent-native-node-id="child"]');
        const before = await child.boundingBox();
        if (!before) throw new Error("Child geometry is missing");
        await page.mouse.move(100, 90);
        await page.mouse.down();
        await page.mouse.move(173, 147, { steps: 8 });
        await page.mouse.up();
        await expect
          .poll(() =>
            page
              .locator('[data-agent-native-node-id="parent"]')
              .evaluate((el) => ({
                left: (el as HTMLElement).style.left,
                top: (el as HTMLElement).style.top,
              })),
          )
          .toEqual({ left: "113px", top: "97px" });
        const after = await child.boundingBox();
        if (!after) throw new Error("Child geometry is missing after dragging");
        expect(after).toEqual({
          ...before,
          x: before.x + 73,
          y: before.y + 57,
        });
        expect(
          await child.evaluate((el) =>
            el.parentElement?.getAttribute("data-agent-native-node-id"),
          ),
        ).toBe("parent");
      }, html);
    },
  );

  it("previews the same nested target that a click selects", async () => {
    await withPage(async (page) => {
      await page.mouse.move(PRIMARY_LABEL.x, PRIMARY_LABEL.y);
      const highlight = page.locator(
        '[data-agent-native-edit-overlay="highlight"]',
      );
      await highlight.waitFor({ state: "visible" });
      const leaf = await page
        .locator('[data-agent-native-node-id="primary-label"]')
        .boundingBox();
      expect(await highlight.boundingBox()).toEqual(leaf);
      expect(await selectionAfter(page, click(page, PRIMARY_LABEL))).toBe(
        "primary-label",
      );
    });
  });

  it("Cmd+click deep-selects the leaf under the pointer", async () => {
    await withPage(async (page) => {
      await page.keyboard.down("Meta");
      expect(await selectionAfter(page, click(page, PRIMARY_LABEL))).toBe(
        "primary-label",
      );
      await page.keyboard.up("Meta");
    });
  });
});

describe("right-click inside a screen", () => {
  const contextMenuTarget = async (
    page: Page,
    point: { x: number; y: number },
  ) => {
    await page.evaluate(() => {
      (window as any).__menu = undefined;
      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (event.data?.type === "element-contextmenu") {
            (window as any).__menu = event.data.payload?.sourceId ?? null;
          }
        },
        { once: false },
      );
    });
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.waitForFunction(() => (window as any).__menu !== undefined, {
      timeout: 2_000,
    });
    return page.evaluate(() => (window as any).__menu as string | null);
  };

  it("targets the same nested content as a plain click", async () => {
    await withPage(async (page) => {
      expect(await contextMenuTarget(page, PRIMARY_LABEL)).toBe(
        "primary-label",
      );
    });
  });

  it("keeps a nested selection the pointer is inside", async () => {
    await withPage(async (page) => {
      expect(await selectionAfter(page, click(page, { x: 200, y: 220 }))).toBe(
        "card",
      );
      expect(await contextMenuTarget(page, PRIMARY_LABEL)).toBe("card");
    });
  });
});
