import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("grid-track-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, () => JSON.stringify(""));
}

function gridDocument(axis: "row" | "column"): string {
  const children =
    axis === "row"
      ? `
        <div data-agent-native-node-id="span" style="grid-row:1;grid-column:1 / 3;background:#bfdbfe"></div>
        <div data-agent-native-node-id="first" style="grid-row:2;grid-column:1;background:#bbf7d0"></div>
        <div data-agent-native-node-id="second" style="grid-row:2;grid-column:2;background:#fde68a"></div>
        <div data-agent-native-node-id="overlay" style="position:absolute;left:8px;top:8px;width:20px;height:20px;grid-row:1;grid-column:2;background:#f97316"></div>`
      : `
        <div data-agent-native-node-id="span" style="grid-row:1 / 3;grid-column:1;background:#bfdbfe"></div>
        <div data-agent-native-node-id="first" style="grid-row:1;grid-column:2;background:#bbf7d0"></div>
        <div data-agent-native-node-id="second" style="grid-row:2;grid-column:2;background:#fde68a"></div>
        <div data-agent-native-node-id="overlay" style="position:absolute;left:8px;top:8px;width:20px;height:20px;grid-row:2;grid-column:1;background:#f97316"></div>`;
  return `<!doctype html><html><body style="margin:0">
    <div data-agent-native-node-id="grid" style="position:absolute;left:40px;top:40px;width:220px;height:180px;display:grid;grid-template-columns:100px 100px;grid-template-rows:80px 80px;gap:20px">
      ${children}
    </div>
  </body></html>`;
}

function nonContiguousGridDocument(axis: "row" | "column"): string {
  const children =
    axis === "row"
      ? `
        <div data-agent-native-node-id="cross" style="grid-row:1 / 3;grid-column:1;background:#fca5a5"></div>
        <div data-agent-native-node-id="first" style="grid-row:2;grid-column:1;background:#bbf7d0"></div>
        <div data-agent-native-node-id="second" style="grid-row:3;grid-column:1;background:#fde68a"></div>`
      : `
        <div data-agent-native-node-id="cross" style="grid-row:1;grid-column:1 / 3;background:#fca5a5"></div>
        <div data-agent-native-node-id="first" style="grid-row:1;grid-column:2;background:#bbf7d0"></div>
        <div data-agent-native-node-id="second" style="grid-row:1;grid-column:3;background:#fde68a"></div>`;
  const gridStyle =
    axis === "row"
      ? "width:100px;height:220px;grid-template-columns:100px;grid-template-rows:60px 60px 60px"
      : "width:220px;height:100px;grid-template-columns:60px 60px 60px;grid-template-rows:100px";
  return `<!doctype html><html><body style="margin:0">
    <div data-agent-native-node-id="grid" style="position:absolute;left:40px;top:40px;display:grid;gap:20px;${gridStyle}">
      ${children}
    </div>
  </body></html>`;
}

describe("grid track controls reorder complete tracks", () => {
  it.each(["row", "column"] as const)(
    "shows a perpendicular landing line and moves spanning content for %s tracks",
    { timeout: 30_000 },
    async (axis) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 640, height: 480 },
        });
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(gridDocument(axis));
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.evaluate(() => {
          (window as any).__gridTrackBatches = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "visual-style-batch-change") {
              (window as any).__gridTrackBatches.push(event.data);
            }
          });
          window.postMessage(
            {
              type: "select-element",
              selector: '[data-agent-native-node-id="grid"]',
              selectorCandidates: ['[data-agent-native-node-id="grid"]'],
            },
            "*",
          );
        });

        const handle = page.locator(
          `[data-agent-native-grid-track="${axis}"][data-grid-track-index="0"]`,
        );
        await handle.waitFor();
        const grid = page.locator('[data-agent-native-node-id="grid"]');
        const gridBox = await grid.boundingBox();
        const handleBox = await handle.boundingBox();
        expect(gridBox).not.toBeNull();
        expect(handleBox).not.toBeNull();

        const start =
          axis === "row"
            ? { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + 30 }
            : { x: handleBox!.x + 30, y: handleBox!.y + handleBox!.height / 2 };
        const end =
          axis === "row"
            ? {
                x: gridBox!.x + gridBox!.width / 2,
                y: gridBox!.y + gridBox!.height - 10,
              }
            : {
                x: gridBox!.x + gridBox!.width - 10,
                y: gridBox!.y + gridBox!.height / 2,
              };

        const before = await page.evaluate(() => {
          const span = document.querySelector(
            '[data-agent-native-node-id="span"]',
          )!;
          const first = document.querySelector(
            '[data-agent-native-node-id="first"]',
          )!;
          return {
            span: span.getBoundingClientRect().toJSON(),
            first: first.getBoundingClientRect().toJSON(),
            templateRows: getComputedStyle(
              document.querySelector('[data-agent-native-node-id="grid"]')!,
            ).gridTemplateRows,
          };
        });

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 8 });

        const guide = page.locator("[data-agent-native-grid-track-guide]");
        await guide.waitFor();
        const held = await guide.evaluate((element) => ({
          axis: element.getAttribute("data-agent-native-grid-track-axis"),
          index: element.getAttribute("data-agent-native-grid-track-index"),
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          display: getComputedStyle(element).display,
        }));
        expect(held).toMatchObject({
          axis,
          index: "2",
          display: "block",
        });
        if (axis === "row") {
          expect(held.width).toBeGreaterThan(held.height * 10);
        } else {
          expect(held.height).toBeGreaterThan(held.width * 10);
        }

        await page.mouse.up();
        await page.waitForFunction(
          () => (window as any).__gridTrackBatches.length === 1,
        );
        const batch = await page.evaluate(
          () => (window as any).__gridTrackBatches[0],
        );
        expect(batch.changes).toHaveLength(3);
        const changes = new Map<string, Record<string, string>>(
          batch.changes.map(
            (change: { selector: string; styles: Record<string, string> }) =>
              [change.selector, change.styles] as const,
          ),
        );
        const property = axis === "row" ? "gridRow" : "gridColumn";
        expect(
          changes.get('[data-agent-native-node-id="span"]')?.[property],
        ).toBe("2 / 3");
        expect(
          changes.get('[data-agent-native-node-id="first"]')?.[property],
        ).toBe("1 / 2");
        expect(
          changes.get('[data-agent-native-node-id="second"]')?.[property],
        ).toBe("1 / 2");
        expect(changes.has('[data-agent-native-node-id="overlay"]')).toBe(
          false,
        );
        expect(
          batch.changes.find(
            (change: { selector: string }) =>
              change.selector === '[data-agent-native-node-id="first"]',
          )?.elementInfo,
        ).toMatchObject({ sourceId: "first" });

        const after = await page.evaluate(() => {
          const span = document.querySelector(
            '[data-agent-native-node-id="span"]',
          )!;
          const first = document.querySelector(
            '[data-agent-native-node-id="first"]',
          )!;
          return {
            span: span.getBoundingClientRect().toJSON(),
            first: first.getBoundingClientRect().toJSON(),
            templateRows: getComputedStyle(
              document.querySelector('[data-agent-native-node-id="grid"]')!,
            ).gridTemplateRows,
          };
        });
        expect(after.templateRows).toBe(before.templateRows);
        if (axis === "row") {
          expect(after.span.top).toBeCloseTo(before.first.top, 1);
          expect(after.first.top).toBeCloseTo(before.span.top, 1);
        } else {
          expect(after.span.left).toBeCloseTo(before.first.left, 1);
          expect(after.first.left).toBeCloseTo(before.span.left, 1);
        }
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it("rejects track drags when an inline track declaration is important", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(
        gridDocument("row").replace(
          "grid-row:2;grid-column:1",
          "grid-row:2!important;grid-column:1",
        ),
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__gridTrackBatches = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-batch-change") {
            (window as any).__gridTrackBatches.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="grid"]',
          },
          "*",
        );
      });
      const handle = page.locator(
        '[data-agent-native-grid-track="row"][data-grid-track-index="0"]',
      );
      await handle.waitFor();
      const gridBox = await page
        .locator('[data-agent-native-node-id="grid"]')
        .boundingBox();
      const handleBox = await handle.boundingBox();
      expect(gridBox).not.toBeNull();
      expect(handleBox).not.toBeNull();
      await page.mouse.move(
        handleBox!.x + handleBox!.width / 2,
        handleBox!.y + 30,
      );
      await page.mouse.down();
      await page.mouse.move(gridBox!.x + gridBox!.width / 2, gridBox!.y + 160, {
        steps: 8,
      });
      await page.mouse.up();
      await page.waitForTimeout(40);

      expect(
        await page.locator("[data-agent-native-grid-track-guide]").count(),
      ).toBe(0);
      expect(
        await page.evaluate(() => (window as any).__gridTrackBatches),
      ).toEqual([]);
      expect(
        await page
          .locator('[data-agent-native-node-id="first"]')
          .evaluate((element) => (element as HTMLElement).style.gridRow),
      ).toBe("2");
    } finally {
      await browser.close();
    }
  });

  it("includes hidden grid items and preserves auto-placed children", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(
        gridDocument("row")
          .replace(
            "grid-row:2;grid-column:1;background:#bbf7d0",
            "grid-row:2;grid-column:1;visibility:hidden;background:#bbf7d0",
          )
          .replace(
            "grid-row:2;grid-column:2;background:#fde68a",
            "grid-column:2;background:#fde68a",
          ),
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__gridTrackBatches = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-batch-change") {
            (window as any).__gridTrackBatches.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="grid"]',
          },
          "*",
        );
      });
      const handle = page.locator(
        '[data-agent-native-grid-track="row"][data-grid-track-index="0"]',
      );
      await handle.waitFor();
      const gridBox = await page
        .locator('[data-agent-native-node-id="grid"]')
        .boundingBox();
      const handleBox = await handle.boundingBox();
      expect(gridBox).not.toBeNull();
      expect(handleBox).not.toBeNull();
      await page.mouse.move(
        handleBox!.x + handleBox!.width / 2,
        handleBox!.y + 30,
      );
      await page.mouse.down();
      await page.mouse.move(gridBox!.x + gridBox!.width / 2, gridBox!.y + 160, {
        steps: 8,
      });
      await page.mouse.up();
      await page.waitForFunction(
        () => (window as any).__gridTrackBatches.length === 1,
      );

      const batch = await page.evaluate(
        () => (window as any).__gridTrackBatches[0],
      );
      const changes = new Map<string, Record<string, string>>(
        batch.changes.map(
          (change: { selector: string; styles: Record<string, string> }) =>
            [change.selector, change.styles] as const,
        ),
      );
      expect(changes.get('[data-agent-native-node-id="first"]')?.gridRow).toBe(
        "1 / 2",
      );
      expect(changes.has('[data-agent-native-node-id="second"]')).toBe(false);
      expect(
        await page
          .locator('[data-agent-native-node-id="second"]')
          .evaluate((element) => (element as HTMLElement).style.gridRow),
      ).toBe("");
    } finally {
      await browser.close();
    }
  });

  it("preserves named track placements instead of rewriting them numerically", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(
        gridDocument("row").replace(
          "grid-row:2;grid-column:1",
          "grid-row:content-start / content-end;grid-column:1",
        ),
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__gridTrackBatches = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-style-batch-change") {
            (window as any).__gridTrackBatches.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="grid"]',
          },
          "*",
        );
      });
      const handle = page.locator(
        '[data-agent-native-grid-track="row"][data-grid-track-index="0"]',
      );
      await handle.waitFor();
      const gridBox = await page
        .locator('[data-agent-native-node-id="grid"]')
        .boundingBox();
      const handleBox = await handle.boundingBox();
      expect(gridBox).not.toBeNull();
      expect(handleBox).not.toBeNull();
      await page.mouse.move(
        handleBox!.x + handleBox!.width / 2,
        handleBox!.y + 30,
      );
      await page.mouse.down();
      await page.mouse.move(gridBox!.x + gridBox!.width / 2, gridBox!.y + 160, {
        steps: 8,
      });
      await page.mouse.up();
      await page.waitForFunction(
        () => (window as any).__gridTrackBatches.length === 1,
      );

      const batch = await page.evaluate(
        () => (window as any).__gridTrackBatches[0],
      );
      expect(
        batch.changes.some(
          (change: { selector: string }) =>
            change.selector === '[data-agent-native-node-id="first"]',
        ),
      ).toBe(false);
      expect(
        await page
          .locator('[data-agent-native-node-id="first"]')
          .evaluate((element) => (element as HTMLElement).style.gridRow),
      ).toBe("content-start / content-end");
    } finally {
      await browser.close();
    }
  });

  it.each(["row", "column"] as const)(
    "does not widen a span across non-contiguous %s track mappings",
    { timeout: 30_000 },
    async (axis) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 640, height: 480 },
        });
        await page.setContent(nonContiguousGridDocument(axis));
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.evaluate(() => {
          (window as any).__gridTrackBatches = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "visual-style-batch-change") {
              (window as any).__gridTrackBatches.push(event.data);
            }
          });
          window.postMessage(
            {
              type: "select-element",
              selector: '[data-agent-native-node-id="grid"]',
            },
            "*",
          );
        });

        const handle = page.locator(
          `[data-agent-native-grid-track="${axis}"][data-grid-track-index="0"]`,
        );
        await handle.waitFor();
        const gridBox = await page
          .locator('[data-agent-native-node-id="grid"]')
          .boundingBox();
        const handleBox = await handle.boundingBox();
        expect(gridBox).not.toBeNull();
        expect(handleBox).not.toBeNull();
        const start =
          axis === "row"
            ? { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + 30 }
            : { x: handleBox!.x + 30, y: handleBox!.y + handleBox!.height / 2 };
        const end =
          axis === "row"
            ? { x: gridBox!.x + 30, y: gridBox!.y + 160 }
            : { x: gridBox!.x + 160, y: gridBox!.y + 30 };

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 8 });
        expect(
          await page
            .locator("[data-agent-native-grid-track-guide]")
            .getAttribute("data-agent-native-grid-track-index"),
        ).toBe("2");
        await page.mouse.up();
        await page.waitForFunction(
          () => (window as any).__gridTrackBatches.length === 1,
        );

        const selectors = await page.evaluate(() =>
          (window as any).__gridTrackBatches[0].changes.map(
            (change: { selector: string }) => change.selector,
          ),
        );
        expect(selectors).toEqual([
          '[data-agent-native-node-id="first"]',
          '[data-agent-native-node-id="second"]',
        ]);
      } finally {
        await browser.close();
      }
    },
  );

  it.each(["row", "column"] as const)(
    "restores the original %s placement when the held drag is cancelled",
    { timeout: 30_000 },
    async (axis) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 640, height: 480 },
        });
        await page.setContent(gridDocument(axis));
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.evaluate(() => {
          (window as any).__gridTrackBatches = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "visual-style-batch-change") {
              (window as any).__gridTrackBatches.push(event.data);
            }
          });
          window.postMessage(
            {
              type: "select-element",
              selector: '[data-agent-native-node-id="grid"]',
            },
            "*",
          );
        });
        const handle = page.locator(
          `[data-agent-native-grid-track="${axis}"][data-grid-track-index="0"]`,
        );
        await handle.waitFor();
        const gridBox = await page
          .locator('[data-agent-native-node-id="grid"]')
          .boundingBox();
        const handleBox = await handle.boundingBox();
        expect(gridBox).not.toBeNull();
        expect(handleBox).not.toBeNull();
        const start =
          axis === "row"
            ? { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + 30 }
            : { x: handleBox!.x + 30, y: handleBox!.y + handleBox!.height / 2 };
        const end =
          axis === "row"
            ? {
                x: gridBox!.x + gridBox!.width / 2,
                y: gridBox!.y + gridBox!.height - 10,
              }
            : {
                x: gridBox!.x + gridBox!.width - 10,
                y: gridBox!.y + gridBox!.height / 2,
              };
        const property = axis === "row" ? "gridRow" : "gridColumn";
        const original = await page.evaluate(
          (styleProperty) => {
            return ["span", "first", "second"].map(
              (nodeId) =>
                (
                  document.querySelector(
                    `[data-agent-native-node-id="${nodeId}"]`,
                  ) as HTMLElement
                ).style[styleProperty],
            );
          },
          property as "gridRow" | "gridColumn",
        );

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 8 });
        await page.locator("[data-agent-native-grid-track-guide]").waitFor();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await page.waitForTimeout(40);

        const restored = await page.evaluate(
          (styleProperty) =>
            ["span", "first", "second"].map(
              (nodeId) =>
                (
                  document.querySelector(
                    `[data-agent-native-node-id="${nodeId}"]`,
                  ) as HTMLElement
                ).style[styleProperty],
            ),
          property as "gridRow" | "gridColumn",
        );
        expect(restored).toEqual(original);
        expect(
          await page.locator("[data-agent-native-grid-track-guide]").count(),
        ).toBe(0);
        expect(
          await page.evaluate(() => (window as any).__gridTrackBatches),
        ).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});
