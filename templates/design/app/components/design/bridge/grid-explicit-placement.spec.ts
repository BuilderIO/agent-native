import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

import {
  runRecordPendingLiveStructureEdit,
  type RecordPendingLiveStructureEditArgs,
} from "../../../pages/design-editor/commands/record-pending-live-structure-edit";
import {
  formatPendingVisualStylePrompt,
  mergePendingLiveNonStyleEdits,
  type PendingLiveStructureEdit,
} from "../../../pages/design-editor/pending-edits";
import type { ElementInfo } from "../types";

const bridgeSource = buildSync({
  entryPoints: [
    fileURLToPath(new URL("./editor-chrome.bridge.ts", import.meta.url)),
  ],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0]!.text;

const bridge = () =>
  bridgeSource
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("grid-explicit"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');

const fixture = `<!doctype html><style>
html,body{margin:0;width:100%;height:100%}
#grid{position:absolute;left:100px;top:80px;width:460px;height:380px;padding:12px;display:grid;grid-template-columns:repeat(4,100px);grid-template-rows:repeat(4,70px);gap:12px;background:#eef2ff;box-sizing:border-box}
#a{grid-column:1;grid-row:1;background:#94a3b8}#b{grid-column:span 2;grid-row:span 2;background:#6366f1}#c{grid-column:1 / span 2;grid-row:3;background:#f59e0b}#d{grid-column:2;grid-row:3;background:#a78bfa}
.peer{width:100%;height:100%}
</style><div id="grid" data-agent-native-node-id="grid"><div id="a" class="peer" data-agent-native-node-id="a">A</div><div id="b" class="peer" data-agent-native-node-id="b">B</div><div id="c" class="peer" data-agent-native-node-id="c">C</div><div id="d" class="peer" data-agent-native-node-id="d">D</div></div>`;

const implicitTrackFixture = `<!doctype html><style>
html,body{margin:0;width:100%;height:100%}
#grid{position:absolute;left:100px;top:80px;width:460px;height:380px;padding:12px;display:grid;grid-template-columns:repeat(2,100px);grid-template-rows:repeat(4,70px);gap:12px;background:#eef2ff;box-sizing:border-box}
#a{grid-column:1;grid-row:1;background:#94a3b8}#b{grid-column:span 2;grid-row:span 2;background:#6366f1}#c{grid-column:3 / 5;grid-row:3;background:#f59e0b}#d{grid-column:4;grid-row:3;background:#a78bfa}
.peer{width:100%;height:100%}
</style><div id="grid" data-agent-native-node-id="grid"><div id="a" class="peer" data-agent-native-node-id="a">A</div><div id="b" class="peer" data-agent-native-node-id="b">B</div><div id="c" class="peer" data-agent-native-node-id="c">C</div><div id="d" class="peer" data-agent-native-node-id="d">D</div></div>`;

const groupedGridFixture = `<!doctype html><style>
html,body{margin:0;width:100%;height:100%}
#grid{position:absolute;left:100px;top:80px;width:520px;height:380px;padding:12px;display:grid;grid-template-columns:repeat(4,100px);grid-template-rows:repeat(4,70px);gap:12px;background:#eef2ff;box-sizing:border-box}
#a{grid-column:1;grid-row:1;background:#94a3b8}#b{grid-column:1 / span 2;grid-row:1;background:#6366f1}#c{grid-column:3 / span 2;grid-row:1;background:#22c55e}#d{grid-column:4;grid-row:3;background:#f59e0b}#e{grid-column:2;grid-row:3;background:#a78bfa}
.peer{width:100%;height:100%}
</style><div id="grid" data-agent-native-node-id="grid"><div id="a" class="peer" data-agent-native-node-id="a">A</div><div id="b" class="peer" data-agent-native-node-id="b">B</div><div id="c" class="peer" data-agent-native-node-id="c">C</div><div id="d" class="peer" data-agent-native-node-id="d">D</div><div id="e" class="peer" data-agent-native-node-id="e">E</div></div>`;

const implicitGroupedGridFixture = `<!doctype html><style>
html,body{margin:0;width:100%;height:100%}
#grid{position:absolute;left:100px;top:80px;width:520px;height:380px;padding:12px;display:grid;grid-template-columns:repeat(2,100px);grid-template-rows:repeat(4,70px);gap:12px;background:#eef2ff;box-sizing:border-box}
#b{grid-column:3 / span 2;grid-row:1;background:#6366f1}#c{grid-column:5 / span 2;grid-row:1;background:#22c55e}#d{grid-column:3 / span 2;grid-row:3;background:#f59e0b}#e{grid-column:5;grid-row:3;background:#a78bfa}
.peer{width:100%;height:100%}
</style><div id="grid" data-agent-native-node-id="grid"><div id="b" class="peer" data-agent-native-node-id="b">B</div><div id="c" class="peer" data-agent-native-node-id="c">C</div><div id="d" class="peer" data-agent-native-node-id="d">D</div><div id="e" class="peer" data-agent-native-node-id="e">E</div></div>`;

function groupedSourceFixture(
  bStyle: string,
  cStyle: string,
  targetStyle = "grid-template-columns:repeat(4,80px);grid-template-rows:repeat(4,60px)",
  targetChildren = '<div id="occupied" data-agent-native-node-id="occupied" style="grid-column:3 / 5;grid-row:2;background:#f90">O</div>',
  sourceTrailingChild = "",
) {
  return `<!doctype html><style>
html,body{margin:0;width:100%;height:100%}
#source{position:absolute;left:20px;top:30px;width:350px;height:180px;padding:10px;display:grid;grid-template-columns:[content-start] repeat(4,70px) [content-end];grid-template-rows:repeat(2,60px);gap:10px;background:#eee}
#target{position:absolute;left:430px;top:30px;width:390px;height:350px;padding:10px;display:grid;gap:10px;background:#ddd;${targetStyle}}
.item{width:100%;height:100%}
</style><div id="source" data-agent-native-node-id="source"><div id="b" class="item" data-agent-native-node-id="b" style="${bStyle}">B</div><div id="c" class="item" data-agent-native-node-id="c" style="${cStyle}">C</div>${sourceTrailingChild}</div><div id="target" data-agent-native-node-id="target">${targetChildren}</div>`;
}

async function dragSelectedGroup(
  page: Page,
  destination: { x: number; y: number },
) {
  const source = await box(page, "#b");
  await select(page, "#b");
  await page.evaluate(() => {
    window.postMessage(
      { type: "select-elements", selectorGroups: [["#c"]] },
      "*",
    );
  });
  await expect
    .poll(() =>
      page
        .locator('[data-agent-native-edit-overlay="multi-selection"]')
        .count(),
    )
    .toBeGreaterThan(0);
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(source.x + 8, source.y + 8, { steps: 3 });
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
}

async function gridDeclarations(page: Page) {
  return page.locator("#b,#c").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = (node as HTMLElement).style;
      return [
        "grid-column-start",
        "grid-column-end",
        "grid-row-start",
        "grid-row-end",
      ].map((property) => ({
        property,
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      }));
    }),
  );
}

async function select(page: Page, selector: string) {
  await page.evaluate((value) => {
    window.postMessage({ type: "select-element", selector: value }, "*");
  }, selector);
  await page.waitForTimeout(40);
}

async function box(page: Page, selector: string) {
  const value = await page.locator(selector).boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

function pendingEditFromBridgeMessage(message: {
  selector: string;
  sourceId?: string;
  anchorSelector: string;
  anchorSourceId?: string;
  requestId: string;
  transactionId?: string;
  placement: "before" | "after" | "inside";
  dropMode?: "flow-insert" | "absolute-container";
  gridPlacement?: PendingLiveStructureEdit["gridPlacement"];
  gridDisplacements?: PendingLiveStructureEdit["gridDisplacements"];
  payload?: ElementInfo;
  anchorPayload?: ElementInfo;
}): PendingLiveStructureEdit {
  const pendingLiveNonStyleEditsRef = {
    current: [] as PendingLiveStructureEdit[],
  };
  const state: RecordPendingLiveStructureEditArgs = {
    canEditDesign: true,
    cancelPendingStructureVerification: () => {},
    files: [],
    localhostConnectionRootPathByIdRef: { current: new Map() },
    overviewScreens: [],
    pendingLiveNonStyleEditsRef,
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingVisualStyleRedoStackRef: { current: [] },
    runtimeLayerSnapshotsById: {},
    setPendingLiveNonStyleEdits: () => {},
  };
  runRecordPendingLiveStructureEdit(
    state,
    "grid-redo-screen",
    message.selector,
    message.anchorSelector,
    message.placement,
    message.payload,
    {
      sourceId: message.sourceId,
      anchorSourceId: message.anchorSourceId,
      anchorElementInfo: message.anchorPayload,
      requestId: message.requestId,
      transactionId: message.transactionId,
      dropMode: message.dropMode,
      gridPlacement: message.gridPlacement,
      gridDisplacements: message.gridDisplacements,
    },
  );
  expect(pendingLiveNonStyleEditsRef.current).toHaveLength(1);
  return pendingLiveNonStyleEditsRef.current[0]!;
}

describe("explicit grid placement repro", () => {
  it("moves an explicitly placed child to the held grid cell", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 700, height: 500 },
    });
    await page.setContent(fixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as Window & { __gridDrop?: unknown }).__gridDrop = null;
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-structure-change") {
          (window as Window & { __gridDrop?: unknown }).__gridDrop = event.data;
        }
      });
    });

    const source = await box(page, "#b");
    const target = await box(page, "#c");
    await select(page, "#b");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 8, source.y + 8, { steps: 3 });
    await page.mouse.move(target.x + 10, target.y + target.height / 2, {
      steps: 12,
    });
    await page.waitForTimeout(250);

    const held = await page.locator("#b").evaluate((node) => {
      const style = getComputedStyle(node);
      const guide = document.querySelector<HTMLElement>(
        "[data-agent-native-insertion-guide]",
      );
      return {
        gridColumn: style.gridColumn,
        gridRow: style.gridRow,
        rect: (() => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y };
        })(),
        guide: guide
          ? {
              display: getComputedStyle(guide).display,
              border: getComputedStyle(guide).border,
            }
          : null,
      };
    });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const after = await page.locator("#b").evaluate((node) => {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return {
        gridColumn: style.gridColumn,
        gridRow: style.gridRow,
        x: r.x,
        y: r.y,
      };
    });
    const displacedAfter = await page.locator("#c").evaluate((node) => {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return {
        gridColumn: style.gridColumn,
        gridRow: style.gridRow,
        x: r.x,
        y: r.y,
      };
    });
    const displacedSecondAfter = await page.locator("#d").evaluate((node) => {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return {
        gridColumn: style.gridColumn,
        gridRow: style.gridRow,
        x: r.x,
        y: r.y,
      };
    });
    const drop = await page.evaluate(
      () =>
        (
          window as Window & {
            __gridDrop?: {
              gridPlacement?: unknown;
              gridDisplacements?: Array<{ sourceId?: string }>;
              requestId?: string;
            };
          }
        ).__gridDrop,
    );
    console.log(
      JSON.stringify({
        held,
        after,
        displacedAfter,
        drop: drop?.gridPlacement,
        displacements: drop?.gridDisplacements,
      }),
    );
    expect(held.guide?.display).toBe("block");
    expect(after.gridColumn).toBe("1 / 3");
    expect(after.gridRow).toBe("3 / 5");
    expect(after.x).not.toBe(held.rect.x);
    expect(after.y).not.toBe(held.rect.y);
    expect(drop?.gridPlacement).toEqual({
      column: 1,
      columnEnd: 3,
      row: 3,
      rowEnd: 5,
    });
    expect(displacedAfter.gridColumn).toBe("2 / 4");
    expect(displacedAfter.gridRow).toBe("1 / 2");
    expect(displacedSecondAfter.gridColumn).toBe("2 / 3");
    expect(displacedSecondAfter.gridRow).toBe("2 / 3");
    expect(drop?.gridDisplacements?.map((entry) => entry.sourceId)).toEqual([
      "c",
      "d",
    ]);
    const persistedHtml = await page
      .locator("html")
      .evaluate((node) => node.outerHTML);
    await page.evaluate((requestId) => {
      window.postMessage(
        { type: "visual-structure-ack", requestId, applied: false },
        "*",
      );
    }, drop?.requestId);
    await page.waitForTimeout(200);
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("span 2");
    expect(
      await page
        .locator("#c")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("1 / span 2");

    await page.setContent(`<!doctype html>${persistedHtml}`);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("1 / 3");
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridRow),
    ).toBe("3 / 5");
    expect(
      await page
        .locator("#c")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("2 / 4");
    expect(
      await page
        .locator("#c")
        .evaluate((node) => getComputedStyle(node).gridRow),
    ).toBe("1 / 2");
    expect(
      await page
        .locator("#d")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("2 / 3");
    await browser.close();
  });

  it("maps authored implicit tracks without colliding fallback occupants", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(implicitTrackFixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as Window & { __gridDrop?: unknown }).__gridDrop = null;
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-structure-change") {
          (window as Window & { __gridDrop?: unknown }).__gridDrop = event.data;
        }
      });
    });
    const source = await box(page, "#b");
    const target = await box(page, "#c");
    await select(page, "#b");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 8, source.y + 8, { steps: 3 });
    await page.mouse.move(target.x + 10, target.y + target.height / 2, {
      steps: 12,
    });
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(80);
    const placement = await page.locator("#b").evaluate((node) => {
      const style = getComputedStyle(node);
      return { column: style.gridColumn, row: style.gridRow };
    });
    const drop = await page.evaluate(
      () =>
        (
          window as Window & {
            __gridDrop?: { gridDisplacements?: Array<{ sourceId?: string }> };
          }
        ).__gridDrop,
    );
    expect(placement).toEqual({ column: "3 / 5", row: "3 / 5" });
    expect(drop?.gridDisplacements?.map((entry) => entry.sourceId)).toEqual([
      "c",
      "d",
    ]);
    const rects = await page.locator("#b,#c,#d").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: node.id,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }),
    );
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(
          rects[i]!.right <= rects[j]!.left ||
            rects[j]!.right <= rects[i]!.left ||
            rects[i]!.bottom <= rects[j]!.top ||
            rects[j]!.bottom <= rects[i]!.top,
        ).toBe(true);
      }
    }
    await browser.close();
  });

  it("plans grouped span members without overlap and restores all styles on rejected ack", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(groupedGridFixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      window.postMessage(
        { type: "set-grid-group-batching-enabled", enabled: true },
        "*",
      );
      (window as Window & { __gridDrops?: unknown[] }).__gridDrops = [];
      (window as Window & { __gridBatchCount?: number }).__gridBatchCount = 0;
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-grid-group-change") {
          const state = window as Window & { __gridBatchCount?: number };
          state.__gridBatchCount = (state.__gridBatchCount ?? 0) + 1;
          (window as Window & { __gridDrops?: unknown[] }).__gridDrops?.push(
            ...event.data.moves,
          );
        }
      });
    });

    const first = await box(page, "#c");
    const destination = await box(page, "#d");
    const original = await page.evaluate(() =>
      ["#b", "#c", "#d", "#e"].map((selector) => {
        const node = document.querySelector(selector)!;
        const style = getComputedStyle(node);
        return { selector, column: style.gridColumn, row: style.gridRow };
      }),
    );
    await select(page, "#b");
    await page.evaluate(() => {
      window.postMessage(
        { type: "select-elements", selectorGroups: [["#c"]] },
        "*",
      );
    });
    await expect
      .poll(async () =>
        page
          .locator('[data-agent-native-edit-overlay="multi-selection"]')
          .count(),
      )
      .toBeGreaterThan(0);
    await page.mouse.move(
      first.x + first.width / 2,
      first.y + first.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(first.x + 8, first.y + 8, { steps: 3 });
    await page.mouse.move(
      destination.x + 10,
      destination.y + destination.height / 2,
      { steps: 12 },
    );
    const heldRects = await page.evaluate(() =>
      ["#b", "#c", "#d", "#e"].map((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return {
          selector,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }),
    );
    expect(heldRects).toHaveLength(4);
    expect(
      heldRects.some((left, index) =>
        heldRects
          .slice(index + 1)
          .some(
            (right) =>
              left.left < right.right &&
              left.right > right.left &&
              left.top < right.bottom &&
              left.bottom > right.top,
          ),
      ),
    ).toBe(false);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              (window as Window & { __gridDrops?: unknown[] }).__gridDrops
                ?.length ?? 0,
          ),
      )
      .toBe(2);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __gridBatchCount?: number }).__gridBatchCount,
      ),
    ).toBe(1);
    const drops = await page.evaluate(
      () => (window as Window & { __gridDrops?: unknown[] }).__gridDrops ?? [],
    );
    const after = await page.evaluate(() =>
      ["#b", "#c", "#d", "#e"].map((selector) => {
        const node = document.querySelector<HTMLElement>(selector)!;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          selector,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          column: style.gridColumn,
          row: style.gridRow,
        };
      }),
    );
    expect(after[0]?.column).toBe("1 / 3");
    expect(after[1]?.column).toBe("3 / 5");
    expect(after[0]?.row).toBe("4 / 5");
    expect(after[1]?.row).toBe("4 / 5");
    expect(
      after.some((left, index) =>
        after
          .slice(index + 1)
          .some(
            (right) =>
              left.left < right.right &&
              left.right > right.left &&
              left.top < right.bottom &&
              left.bottom > right.top,
          ),
      ),
    ).toBe(false);
    const persistedHtml = await page
      .locator("html")
      .evaluate((node) => node.outerHTML);
    const requests = await page.evaluate(
      () =>
        (window as Window & { __gridDrops?: Array<{ requestId?: string }> })
          .__gridDrops ?? [],
    );
    for (const request of requests) {
      await page.evaluate((requestId) => {
        window.postMessage(
          { type: "visual-structure-ack", requestId, applied: false },
          "*",
        );
      }, request.requestId);
    }
    await expect
      .poll(async () =>
        page.locator("#b").evaluate((node) => getComputedStyle(node).gridRow),
      )
      .toBe("1");
    const restored = await page.evaluate(() =>
      ["#b", "#c", "#d", "#e"].map((selector) => {
        const node = document.querySelector(selector)!;
        const style = getComputedStyle(node);
        return { selector, column: style.gridColumn, row: style.gridRow };
      }),
    );
    expect(restored).toEqual(original);
    await page.setContent(`<!doctype html>${persistedHtml}`);
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("1 / 3");
    expect(
      await page
        .locator("#c")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("3 / 5");
  });

  it("retains individual group messages when inline batching is disabled", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(groupedGridFixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as Window & { __groupMessages?: unknown[] }).__groupMessages = [];
      window.addEventListener("message", (event) => {
        if (
          event.data?.type === "visual-structure-change" ||
          event.data?.type === "visual-grid-group-change"
        )
          (
            window as Window & { __groupMessages?: unknown[] }
          ).__groupMessages?.push(event.data);
      });
    });
    const source = await box(page, "#b");
    const target = await box(page, "#d");
    await select(page, "#b");
    await page.evaluate(() =>
      window.postMessage(
        { type: "select-elements", selectorGroups: [["#c"]] },
        "*",
      ),
    );
    await expect
      .poll(() =>
        page
          .locator('[data-agent-native-edit-overlay="multi-selection"]')
          .count(),
      )
      .toBeGreaterThan(0);
    const beforeGridHtml = await page
      .locator("#grid")
      .evaluate((node) => node.innerHTML);
    const beforePositions = await page.evaluate(() =>
      ["#b", "#c"].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { column: style.gridColumn, row: style.gridRow };
      }),
    );
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 8, source.y + 8, { steps: 3 });
    await page.mouse.move(target.x + 10, target.y + target.height / 2, {
      steps: 12,
    });
    const heldPositions = await page.evaluate(() =>
      ["#b", "#c"].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { column: style.gridColumn, row: style.gridRow };
      }),
    );
    expect(heldPositions).not.toEqual(beforePositions);
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __groupMessages?: unknown[] }).__groupMessages
              ?.length ?? 0,
        ),
      )
      .toBe(2);
    const types = await page.evaluate(() =>
      (
        window as Window & { __groupMessages?: Array<{ type: string }> }
      ).__groupMessages?.map((message) => message.type),
    );
    expect(types).toEqual([
      "visual-structure-change",
      "visual-structure-change",
    ]);
    const transactions =
      (await page.evaluate(() =>
        (
          window as Window & {
            __groupMessages?: Array<{ transactionId?: string }>;
          }
        ).__groupMessages?.map((message) => message.transactionId),
      )) ?? [];
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatch(/^group-/);
    expect(transactions.every((id) => id === transactions[0])).toBe(true);
    const placements = await page.evaluate(() =>
      (
        window as Window & {
          __groupMessages?: Array<{ gridPlacement?: unknown }>;
        }
      ).__groupMessages?.map((message) => message.gridPlacement),
    );
    expect(placements?.every(Boolean)).toBe(true);
    const requestIds = await page.evaluate(() =>
      (
        window as Window & {
          __groupMessages?: Array<{ requestId: string }>;
        }
      ).__groupMessages?.map((message) => message.requestId),
    );
    for (const requestId of [...(requestIds ?? [])].reverse()) {
      await page.evaluate((id) => {
        window.postMessage(
          { type: "visual-structure-ack", requestId: id, applied: false },
          "*",
        );
      }, requestId);
    }
    await expect
      .poll(() =>
        page
          .locator("#grid")
          .evaluate((node) => node.innerHTML.replace(/ style=""/g, "")),
      )
      .toBe(beforeGridHtml);
    await page.setContent(groupedGridFixture);
    expect(await page.locator("#grid").evaluate((node) => node.innerHTML)).toBe(
      beforeGridHtml,
    );
    await browser.close();
  });

  it("preflights every grouped redo member before moving any member", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(groupedGridFixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as Window & { __replayMessages?: unknown[] }).__replayMessages =
        [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-structure-change") {
          (
            window as Window & { __replayMessages?: unknown[] }
          ).__replayMessages?.push(event.data);
        }
      });
    });
    const beforeGridHtml = await page
      .locator("#grid")
      .evaluate((node) => node.innerHTML);
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "runtime-structure-move",
          subjectSelector: "#b",
          subjectSourceId: "b",
          anchorSelector: "#grid",
          anchorSourceId: "grid",
          placement: "inside",
          transactionId: "group-redo",
          moves: [
            {
              subjectSelector: "#b",
              subjectSourceId: "b",
              anchorSelector: "#grid",
              anchorSourceId: "grid",
              placement: "inside",
              transactionId: "group-redo",
              gridPlacement: {
                column: 3,
                columnEnd: 5,
                row: 3,
                rowEnd: 4,
              },
            },
            {
              subjectSelector: "#missing",
              subjectSourceId: "missing",
              anchorSelector: "#grid",
              anchorSourceId: "grid",
              placement: "inside",
              transactionId: "group-redo",
            },
          ],
        },
        "*",
      );
    });
    await page.waitForTimeout(80);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __replayMessages?: unknown[] }).__replayMessages
            ?.length ?? 0,
      ),
    ).toBe(0);
    expect(await page.locator("#grid").evaluate((node) => node.innerHTML)).toBe(
      beforeGridHtml,
    );
    await browser.close();
  });

  it("records grid metadata from successful grouped redo bridge events", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(groupedGridFixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as Window & { __redoMessages?: unknown[] }).__redoMessages = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-structure-change") {
          (
            window as Window & { __redoMessages?: unknown[] }
          ).__redoMessages?.push(event.data);
        }
      });
    });
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "runtime-structure-move",
          subjectSelector: "#b",
          subjectSourceId: "b",
          anchorSelector: "#grid",
          anchorSourceId: "grid",
          placement: "inside",
          transactionId: "group-redo",
          moves: [
            {
              subjectSelector: "#b",
              subjectSourceId: "b",
              anchorSelector: "#grid",
              anchorSourceId: "grid",
              placement: "inside",
              transactionId: "group-redo",
              gridPlacement: {
                column: 3,
                columnEnd: 5,
                row: 3,
                rowEnd: 4,
              },
            },
            {
              subjectSelector: "#c",
              subjectSourceId: "c",
              anchorSelector: "#grid",
              anchorSourceId: "grid",
              placement: "inside",
              transactionId: "group-redo",
              gridPlacement: {
                column: 1,
                columnEnd: 3,
                row: 3,
                rowEnd: 4,
              },
            },
          ],
        },
        "*",
      );
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __redoMessages?: unknown[] }).__redoMessages
              ?.length ?? 0,
        ),
      )
      .toBe(2);
    const messages = await page.evaluate(
      () =>
        (
          window as Window & {
            __redoMessages?: Array<{
              selector: string;
              sourceId?: string;
              anchorSelector: string;
              anchorSourceId?: string;
              requestId: string;
              transactionId?: string;
              placement: "before" | "after" | "inside";
              dropMode?: "flow-insert" | "absolute-container";
              gridPlacement?: PendingLiveStructureEdit["gridPlacement"];
              gridDisplacements?: PendingLiveStructureEdit["gridDisplacements"];
              payload?: ElementInfo;
              anchorPayload?: ElementInfo;
            }>;
          }
        ).__redoMessages ?? [],
    );
    const pending = mergePendingLiveNonStyleEdits(
      messages.map(pendingEditFromBridgeMessage),
    );
    expect(pending).toHaveLength(1);
    const groupedEdits =
      pending[0]?.kind === "structure" ? pending[0].groupedEdits : undefined;
    expect(groupedEdits?.map((edit) => edit.selector)).toEqual([
      '[data-agent-native-node-id="b"]',
      '[data-agent-native-node-id="c"]',
    ]);
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      edits: [],
      liveEdits: pending,
    });
    expect(prompt).toContain('"transactionId": "group-redo"');
    expect(prompt).toContain('"column": 3');
    expect(prompt).toContain('"column": 1');
    expect(prompt).toContain('"sourceId": "d"');
    await browser.close();
  });

  it("keeps grouped drops in authored implicit tracks", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(implicitGroupedGridFixture);
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      window.postMessage(
        { type: "set-grid-group-batching-enabled", enabled: true },
        "*",
      );
      (window as Window & { __gridDrops?: unknown[] }).__gridDrops = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-grid-group-change") {
          (window as Window & { __gridDrops?: unknown[] }).__gridDrops?.push(
            ...event.data.moves,
          );
        }
      });
    });
    const source = await box(page, "#b");
    const target = await box(page, "#d");
    await select(page, "#b");
    await page.evaluate(() =>
      window.postMessage(
        { type: "select-elements", selectorGroups: [["#c"]] },
        "*",
      ),
    );
    await expect
      .poll(async () =>
        page
          .locator('[data-agent-native-edit-overlay="multi-selection"]')
          .count(),
      )
      .toBeGreaterThan(0);
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 8, source.y + 8, { steps: 3 });
    await page.mouse.move(target.x + 10, target.y + target.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              (window as Window & { __gridDrops?: unknown[] }).__gridDrops
                ?.length ?? 0,
          ),
      )
      .toBe(2);
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("3 / 5");
    await browser.close();
  });

  it("chains occupied-cell anchors for grouped source order", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(
      groupedSourceFixture(
        "grid-column:1 / 3;grid-row:1",
        "grid-column:1 / 3;grid-row:2",
      ),
    );
    await page.addScriptTag({ content: bridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      window.postMessage(
        { type: "set-grid-group-batching-enabled", enabled: true },
        "*",
      );
      (
        window as Window & {
          __gridDrops?: Array<{
            anchorSourceId: string;
            placement: string;
            persistenceAnchorSourceId: string;
            persistencePlacement: string;
          }>;
        }
      ).__gridDrops = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-grid-group-change")
          (window as Window & { __gridDrops?: unknown[] }).__gridDrops =
            event.data.moves;
      });
    });
    const target = await box(page, "#target");
    await dragSelectedGroup(page, { x: target.x + 230, y: target.y + 110 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __gridDrops?: unknown[] }).__gridDrops
              ?.length ?? 0,
        ),
      )
      .toBe(2);
    expect(
      await page.evaluate(() =>
        (
          window as Window & {
            __gridDrops?: Array<{
              anchorSourceId: string;
              placement: string;
              persistenceAnchorSourceId: string;
              persistencePlacement: string;
            }>;
          }
        ).__gridDrops?.map((move) => [move.anchorSourceId, move.placement]),
      ),
    ).toEqual([
      ["target", "inside"],
      ["target", "inside"],
    ]);
    expect(
      await page.evaluate(() =>
        (
          window as Window & {
            __gridDrops?: Array<{
              persistenceAnchorSourceId: string;
              persistencePlacement: string;
            }>;
          }
        ).__gridDrops?.map((move) => [
          move.persistenceAnchorSourceId,
          move.persistencePlacement,
        ]),
      ),
    ).toEqual([
      ["occupied", "before"],
      ["b", "after"],
    ]);
    await browser.close();
  });

  it("restores important grid longhands on rejection and accepts their replacement", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(
      groupedSourceFixture(
        "grid-column-start:1!important;grid-column-end:3!important;grid-row-start:1!important;grid-row-end:2!important",
        "grid-column-start:1;grid-column-end:3;grid-row-start:2;grid-row-end:3",
      ),
    );
    await page.addScriptTag({ content: bridge() });
    await page.evaluate(() => {
      window.postMessage(
        { type: "set-grid-group-batching-enabled", enabled: true },
        "*",
      );
      (window as Window & { __batch?: Array<{ requestId: string }> }).__batch =
        [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-grid-group-change")
          (
            window as Window & { __batch?: Array<{ requestId: string }> }
          ).__batch = event.data.moves;
      });
    });
    const before = await gridDeclarations(page);
    const target = await box(page, "#target");
    await dragSelectedGroup(page, { x: target.x + 230, y: target.y + 110 });
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("3 / 5");
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __batch?: unknown[] }).__batch?.length ?? 0,
        ),
      )
      .toBe(2);
    const requestIds = await page.evaluate(() =>
      (
        window as Window & { __batch?: Array<{ requestId: string }> }
      ).__batch!.map((move) => move.requestId),
    );
    for (const requestId of requestIds)
      await page.evaluate(
        (id) =>
          window.postMessage(
            { type: "visual-structure-ack", requestId: id, applied: false },
            "*",
          ),
        requestId,
      );
    await expect.poll(() => gridDeclarations(page)).toEqual(before);
    await dragSelectedGroup(page, { x: target.x + 230, y: target.y + 110 });
    await page.mouse.up();
    const acceptedIds = await page.evaluate(() =>
      (
        window as Window & { __batch?: Array<{ requestId: string }> }
      ).__batch!.map((move) => move.requestId),
    );
    expect(acceptedIds).toHaveLength(2);
    for (const requestId of acceptedIds)
      await page.evaluate(
        (id) =>
          window.postMessage(
            { type: "visual-structure-ack", requestId: id, applied: true },
            "*",
          ),
        requestId,
      );
    await expect
      .poll(() =>
        page
          .locator("#b")
          .evaluate((node) => getComputedStyle(node).gridColumn),
      )
      .toBe("3 / 5");
    expect(
      await page.locator("#b").evaluate((node) => node.parentElement?.id),
    ).toBe("target");
    await browser.close();
  });

  it("preserves auto-started, negative, and named authored spans", async () => {
    for (const columns of [
      ["auto / span 2", "auto / span 2", "1 / 3", "3 / 5"],
      ["1 / -1", "1 / -1", "1 / 5", "1 / 5"],
      [
        "content-start / content-end",
        "content-start / content-end",
        "1 / 5",
        "1 / 5",
      ],
    ]) {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 900, height: 600 },
      });
      await page.setContent(
        groupedSourceFixture(
          `grid-column:${columns[0]};grid-row:1`,
          `grid-column:${columns[1]};grid-row:2`,
        ),
      );
      await page.addScriptTag({ content: bridge() });
      const target = await box(page, "#target");
      await dragSelectedGroup(page, { x: target.x + 50, y: target.y + 110 });
      await page.mouse.up();
      expect(
        await page
          .locator("#b")
          .evaluate((node) => getComputedStyle(node).gridColumn),
      ).toBe(columns[2]);
      expect(
        await page
          .locator("#c")
          .evaluate((node) => getComputedStyle(node).gridColumn),
      ).toBe(columns[3]);
      await browser.close();
    }
  });

  it("resolves negative lines from the explicit grid when implicit tracks follow", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(
      groupedSourceFixture(
        "grid-column:1 / -1;grid-row:1",
        "grid-column:1 / -1;grid-row:2",
        undefined,
        undefined,
        '<div id="implicit" data-agent-native-node-id="implicit" style="grid-column:5;grid-row:1">I</div>',
      ).replace(
        "grid-template-columns:[content-start] repeat(4,70px) [content-end]",
        "grid-template-columns:repeat(2,70px)",
      ),
    );
    await page.addScriptTag({ content: bridge() });
    expect(
      await page
        .locator("#source")
        .evaluate(
          (node) =>
            getComputedStyle(node).gridTemplateColumns.split(" ").length,
        ),
    ).toBeGreaterThan(2);
    const target = await box(page, "#target");
    await dragSelectedGroup(page, { x: target.x + 50, y: target.y + 110 });
    for (const id of ["b", "c"])
      expect(
        await page
          .locator(`#${id}`)
          .evaluate((node) => getComputedStyle(node).gridColumn),
      ).toBe("1 / 3");
    await page.mouse.up();
    await browser.close();
  });

  it("uses real implicit track bounds when an occupant self-sizes", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(
      groupedSourceFixture(
        "grid-column:1 / 3;grid-row:1",
        "grid-column:1 / 3;grid-row:2",
        "grid-template-columns:repeat(2,80px);grid-auto-columns:70px;grid-template-rows:repeat(4,60px)",
        '<div id="occupant" data-agent-native-node-id="occupant" style="grid-column:3 / 5;grid-row:2;justify-self:start;width:70px;background:#f90">O</div>',
      ),
    );
    await page.addScriptTag({ content: bridge() });
    const occupant = await box(page, "#occupant");
    await dragSelectedGroup(page, { x: occupant.x + 55, y: occupant.y + 30 });
    expect(
      await page
        .locator("#b")
        .evaluate((node) => getComputedStyle(node).gridColumn),
    ).toBe("3 / 5");
    await page.mouse.up();
    await browser.close();
  });

  it("never displaces another selected member during a grouped drop", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });
    await page.setContent(
      groupedGridFixture.replace(
        "#c{grid-column:3 / span 2;grid-row:1;",
        "#c{grid-column:3 / span 2;grid-row:2;justify-self:start;width:20px;",
      ),
    );
    await page.addScriptTag({ content: bridge() });
    await page.evaluate(() => {
      window.postMessage(
        { type: "set-grid-group-batching-enabled", enabled: true },
        "*",
      );
      (
        window as Window & {
          __batch?: Array<{ requestId: string; gridDisplacements?: unknown[] }>;
        }
      ).__batch = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "visual-grid-group-change")
          (window as Window & { __batch?: unknown[] }).__batch =
            event.data.moves;
      });
    });
    const before = await gridDeclarations(page);
    const target = await box(page, "#c");
    await dragSelectedGroup(page, {
      x: target.x + 55,
      y: target.y + target.height / 2,
    });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __batch?: unknown[] }).__batch?.length ?? 0,
        ),
      )
      .toBe(2);
    const moves = await page.evaluate(
      () =>
        (
          window as Window & {
            __batch?: Array<{
              requestId: string;
              gridDisplacements?: Array<{ sourceId: string }>;
            }>;
          }
        ).__batch!,
    );
    expect(
      moves.flatMap(
        (move) => move.gridDisplacements?.map((item) => item.sourceId) ?? [],
      ),
    ).not.toContain("c");
    for (const move of moves)
      await page.evaluate(
        (id) =>
          window.postMessage(
            { type: "visual-structure-ack", requestId: id, applied: false },
            "*",
          ),
        move.requestId,
      );
    await expect.poll(() => gridDeclarations(page)).toEqual(before);
    await browser.close();
  });
});
