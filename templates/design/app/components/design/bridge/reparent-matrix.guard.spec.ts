import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureCodeLayerNodeIdsInHtml,
  moveNodeBetweenDocuments,
} from "../../../../shared/code-layer";
import {
  buildRuntimeReactStructureMoveHandoff,
  resolveRuntimeStructureMoveExecutionMode,
} from "../../../pages/design-editor/react-semantic-handoff";

const editorChromeBridgeSource = buildSync({
  entryPoints: [
    fileURLToPath(new URL("./editor-chrome.bridge.ts", import.meta.url)),
  ],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0]?.text;

function hydratedBridge(): string {
  if (!editorChromeBridgeSource) {
    throw new Error("Failed to compile editor chrome bridge for matrix test");
  }
  return editorChromeBridgeSource
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("matrix-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

async function installBridge(page: Page): Promise<void> {
  await page.addScriptTag({ content: hydratedBridge() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
  await page.evaluate(() => {
    (window as Window & { __matrixMessages?: unknown[] }).__matrixMessages = [];
    window.addEventListener("message", (event) => {
      (
        window as Window & { __matrixMessages?: unknown[] }
      ).__matrixMessages?.push(event.data);
    });
  });
}

async function dragCenterTo(
  page: Page,
  selector: string,
  target: { x: number; y: number },
  modifier?: "Control" | "Space",
): Promise<{ left: number; top: number }> {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.click(startX, startY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(startX + 6, startY + 6, { steps: 2 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  const beforeRelease = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(40);
  return beforeRelease;
}

function sourceId(html: string, layerName: string): string {
  const match = html.match(
    new RegExp(
      `data-agent-native-layer-name=["']${layerName}["'][^>]*data-agent-native-node-id=["']([^"']+)`,
    ),
  );
  if (match?.[1]) return match[1];
  const reverse = html.match(
    new RegExp(
      `data-agent-native-node-id=["']([^"']+)["'][^>]*data-agent-native-layer-name=["']${layerName}["']`,
    ),
  );
  if (!reverse?.[1]) throw new Error(`Missing node id for ${layerName}`);
  return reverse[1];
}

describe("Chromium reparent matrix", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it(
    "moves absolute layers into freeform, row, column, wrap, and grid parents with the correct geometry and flow cleanup",
    { timeout: 30_000 },
    async () => {
      const layouts = [
        {
          name: "freeform",
          targetStyle:
            "position:absolute;left:300px;top:80px;width:300px;height:200px;border:2px solid #999",
          primitive: ' data-an-primitive="frame"',
          expectedPosition: "absolute",
          expectedDropMode: "absolute-container",
        },
        {
          name: "row",
          targetStyle:
            "position:absolute;left:300px;top:80px;width:300px;height:200px;display:flex;flex-direction:row;gap:12px;padding:12px",
          primitive: "",
          expectedPosition: "static",
          expectedDropMode: "flow-insert",
        },
        {
          name: "column",
          targetStyle:
            "position:absolute;left:300px;top:80px;width:300px;height:200px;display:flex;flex-direction:column;gap:12px;padding:12px",
          primitive: "",
          expectedPosition: "static",
          expectedDropMode: "flow-insert",
        },
        {
          name: "wrap",
          targetStyle:
            "position:absolute;left:300px;top:80px;width:300px;height:200px;display:flex;flex-direction:row;flex-wrap:wrap;gap:12px;padding:12px",
          primitive: "",
          expectedPosition: "static",
          expectedDropMode: "flow-insert",
        },
        {
          name: "grid",
          targetStyle:
            "position:absolute;left:300px;top:80px;width:300px;height:200px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:60px;gap:12px;padding:12px",
          primitive: "",
          expectedPosition: "static",
          expectedDropMode: "flow-insert",
        },
      ] as const;

      for (const layout of layouts) {
        const page = await browser.newPage({
          viewport: { width: 900, height: 700 },
        });
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html><html><head><style>
          html,body { margin:0;width:100%;height:100%; }
          body { position:relative; }
          #source { position:absolute;left:40px;top:420px;width:80px;height:44px;background:#6366f1; }
          #target { ${layout.targetStyle};box-sizing:border-box;background:#eef2ff; }
          .peer { width:70px;height:50px;background:#a5b4fc; }
        </style></head><body>
          <div id="source" data-agent-native-node-id="source">Source</div>
          <div id="target" data-agent-native-node-id="target"${layout.primitive}>
            <div id="peer-a" class="peer" data-agent-native-node-id="peer-a">A</div>
            <div id="peer-b" class="peer" data-agent-native-node-id="peer-b">B</div>
          </div>
        </body></html>`);
        await installBridge(page);

        const beforeRelease = await dragCenterTo(page, "#source", {
          x: 530,
          y: 240,
        });
        const result = await page.evaluate(() => {
          const source = document.querySelector<HTMLElement>("#source")!;
          const target = document.querySelector<HTMLElement>("#target")!;
          const sourceRect = source.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const targetStyle = getComputedStyle(target);
          const messages = (
            window as Window & { __matrixMessages?: Record<string, unknown>[] }
          ).__matrixMessages!;
          const structureMessages = messages.filter(
            (message) => message.type === "visual-structure-change",
          );
          const structure = structureMessages[structureMessages.length - 1] as
            | {
                dropMode?: string;
                forceFlowPositionOverride?: boolean;
              }
            | undefined;
          return {
            parentId: source.parentElement?.id,
            position: window.getComputedStyle(source).position,
            inlineLeft: source.style.left,
            inlineTop: source.style.top,
            rect: { left: sourceRect.left, top: sourceRect.top },
            target: {
              left: targetRect.left,
              top: targetRect.top,
              borderLeft: Number.parseFloat(targetStyle.borderLeftWidth) || 0,
              borderTop: Number.parseFloat(targetStyle.borderTopWidth) || 0,
            },
            order: Array.from(target.children).map((child) => child.id),
            dropMode: structure?.dropMode,
            forceFlowPositionOverride: structure?.forceFlowPositionOverride,
          };
        });

        expect(result.parentId, layout.name).toBe("target");
        expect(result.dropMode, layout.name).toBe(layout.expectedDropMode);
        if (layout.expectedPosition === "absolute") {
          expect(result.position, layout.name).toBe("absolute");
          // Reparenting into a new containing block must not add a one-frame
          // jump: the last dragged geometry is the post-drop geometry. Smart
          // guides may legitimately snap that geometry by up to 6px before
          // release, so compare the two rendered states directly.
          expect(result.rect.left, layout.name).toBeCloseTo(
            beforeRelease.left,
            5,
          );
          expect(result.rect.top, layout.name).toBeCloseTo(
            beforeRelease.top,
            5,
          );
          expect(Number.parseFloat(result.inlineLeft), layout.name).toBeCloseTo(
            result.rect.left - result.target.left - result.target.borderLeft,
            0,
          );
          expect(Number.parseFloat(result.inlineTop), layout.name).toBeCloseTo(
            result.rect.top - result.target.top - result.target.borderTop,
            0,
          );
        } else {
          expect(result.position, layout.name).not.toBe("absolute");
          expect(result.forceFlowPositionOverride, layout.name).toBe(true);
          expect(result.inlineLeft, layout.name).toBe("");
          expect(result.inlineTop, layout.name).toBe("");
          expect(result.order, layout.name).toContain("source");
        }
        expect(pageErrors, layout.name).toEqual([]);
        await page.close();
      }
    },
  );

  it(
    "moves flow children to the freeform screen root and back into auto layout without losing the grab offset",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        html,body { margin:0;width:100%;height:100%; }
        body { position:relative; }
        .flow { position:absolute;top:50px;width:220px;height:180px;padding:12px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box; }
        #from { left:40px;background:#f4f4f5; }
        #to { left:360px;background:#eef2ff; }
        #item { width:100px;height:44px;background:#6366f1; }
      </style></head><body>
        <div id="from" class="flow" data-agent-native-node-id="from"><div id="item" data-agent-native-node-id="item">Item</div></div>
        <div id="to" class="flow" data-agent-native-node-id="to"></div>
      </body></html>`);
      await installBridge(page);

      await dragCenterTo(page, "#item", { x: 760, y: 560 });
      const root = await page.locator("#item").evaluate((element) => {
        const item = element as HTMLElement;
        const rect = item.getBoundingClientRect();
        return {
          parent: item.parentElement?.tagName,
          position: getComputedStyle(item).position,
          left: rect.left,
          top: rect.top,
        };
      });
      expect(root).toMatchObject({ parent: "BODY", position: "absolute" });
      expect(root.left).toBeCloseTo(710, 0);
      expect(root.top).toBeCloseTo(538, 0);

      await dragCenterTo(page, "#item", { x: 470, y: 120 });
      const flowed = await page.locator("#item").evaluate((element) => {
        const item = element as HTMLElement;
        return {
          parent: item.parentElement?.id,
          position: getComputedStyle(item).position,
          left: item.style.left,
          top: item.style.top,
        };
      });
      expect(flowed.parent).toBe("to");
      expect(flowed.position).not.toBe("absolute");
      expect(flowed.left).toBe("");
      expect(flowed.top).toBe("");
      await page.close();
    },
  );

  it(
    "strips flex-item-only styling (flex-grow/shrink/basis, align-self, order) when a flow child is dragged out to the freeform screen root",
    { timeout: 30_000 },
    async () => {
      // Regression: prepareFlowMembersForAbsoluteDrop converted a flow child
      // to position:absolute at the drag release point but left its
      // flex-item-only inline styling (flex-grow/shrink/basis, align-self,
      // order — meaningless outside a flex/grid parent) in place. Live DOM
      // repro: drag a flex child carrying those properties onto the freeform
      // screen root and confirm they're gone from the live element once it
      // becomes absolute, while unrelated styling (background) survives.
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        html,body { margin:0;width:100%;height:100%; }
        body { position:relative; }
        .flow { position:absolute;top:50px;width:220px;height:180px;padding:12px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box; }
        #from { left:40px;background:#f4f4f5; }
        #item { width:100px;height:44px; }
      </style></head><body>
        <div id="from" class="flow" data-agent-native-node-id="from"><div id="item" data-agent-native-node-id="item" style="background:#6366f1;flex-grow:2;flex-shrink:3;flex-basis:40px;align-self:center;order:1">Item</div></div>
      </body></html>`);
      await installBridge(page);

      await dragCenterTo(page, "#item", { x: 760, y: 560 });
      const result = await page.locator("#item").evaluate((element) => {
        const item = element as HTMLElement;
        return {
          parent: item.parentElement?.tagName,
          position: getComputedStyle(item).position,
          flex: item.style.flex,
          flexGrow: item.style.flexGrow,
          flexShrink: item.style.flexShrink,
          flexBasis: item.style.flexBasis,
          alignSelf: item.style.alignSelf,
          order: item.style.order,
          background: item.style.background,
          cssText: item.style.cssText,
        };
      });
      expect(result.parent).toBe("BODY");
      expect(result.position).toBe("absolute");
      expect(result.flex).toBe("");
      expect(result.flexGrow).toBe("");
      expect(result.flexShrink).toBe("");
      expect(result.flexBasis).toBe("");
      expect(result.alignSelf).toBe("");
      expect(result.order).toBe("");
      // Non-flex-item inline styling on the same element must survive the strip.
      expect(result.background, result.cssText).toContain("rgb(99, 102, 241)");
      await page.close();
    },
  );

  it(
    "honors Control Ignore Auto Layout and Space retain-parent for absolute drags",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        html,body { margin:0;width:100%;height:100%; }
        body { position:relative; }
        #origin { position:absolute;left:30px;top:330px;width:240px;height:220px;background:#fafafa; }
        #control,#space { position:absolute;left:20px;width:90px;height:44px; }
        #control { top:20px;background:#22c55e; }
        #space { top:90px;background:#6366f1; }
        #target { position:absolute;left:380px;top:80px;width:300px;height:220px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#eef2ff; }
        #peer { width:100px;height:50px;background:#a5b4fc; }
      </style></head><body>
        <div id="origin" data-agent-native-node-id="origin">
          <div id="control" data-agent-native-node-id="control">Control</div>
          <div id="space" data-agent-native-node-id="space">Space</div>
        </div>
        <div id="target" data-agent-native-node-id="target"><div id="peer" data-agent-native-node-id="peer">Peer</div></div>
      </body></html>`);
      await installBridge(page);

      const controlBeforeRelease = await dragCenterTo(
        page,
        "#control",
        { x: 560, y: 220 },
        "Control",
      );
      const ignored = await page.locator("#control").evaluate((element) => {
        const item = element as HTMLElement;
        const rect = item.getBoundingClientRect();
        return {
          parent: item.parentElement?.id,
          position: getComputedStyle(item).position,
          left: rect.left,
          top: rect.top,
        };
      });
      expect(ignored.parent).toBe("target");
      expect(ignored.position).toBe("absolute");
      expect(ignored.left).toBeCloseTo(controlBeforeRelease.left, 5);
      expect(ignored.top).toBeCloseTo(controlBeforeRelease.top, 5);

      const spaceBeforeRelease = await dragCenterTo(
        page,
        "#space",
        { x: 560, y: 250 },
        "Space",
      );
      const retained = await page.locator("#space").evaluate((element) => {
        const item = element as HTMLElement;
        const rect = item.getBoundingClientRect();
        return {
          parent: item.parentElement?.id,
          position: getComputedStyle(item).position,
          left: rect.left,
          top: rect.top,
        };
      });
      expect(retained.parent).toBe("origin");
      expect(retained.position).toBe("absolute");
      expect(retained.left).toBeCloseTo(spaceBeforeRelease.left, 5);
      expect(retained.top).toBeCloseTo(spaceBeforeRelease.top, 5);

      const messages = await page.evaluate(
        () =>
          (window as Window & { __matrixMessages?: Record<string, unknown>[] })
            .__matrixMessages!,
      );
      const structures = messages.filter(
        (message) => message.type === "visual-structure-change",
      ) as Array<{ sourceId?: string; dropMode?: string }>;
      expect(structures).toHaveLength(1);
      expect(structures[0]).toMatchObject({
        sourceId: "control",
        dropMode: "absolute-container",
      });
      expect(
        messages.some(
          (message) =>
            message.type === "visual-style-change" &&
            (
              message as { sourceId?: string; selector?: string }
            ).selector?.includes("space"),
        ),
      ).toBe(true);
      await page.close();
    },
  );

  it(
    "inserts into the pointer's grid row instead of the same column in an earlier row",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        html,body { margin:0;width:100%;height:100%; }
        body { position:relative; }
        #source { position:absolute;left:40px;top:430px;width:80px;height:44px;background:#6366f1; }
        #grid { position:absolute;left:300px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:72px;gap:12px;background:#eef2ff;box-sizing:border-box; }
        .peer { min-width:0;background:#a5b4fc; }
      </style></head><body>
        <div id="source" data-agent-native-node-id="source">Source</div>
        <div id="grid" data-agent-native-node-id="grid">
          <div id="a" class="peer" data-agent-native-node-id="a">A</div>
          <div id="b" class="peer" data-agent-native-node-id="b">B</div>
          <div id="c" class="peer" data-agent-native-node-id="c">C</div>
          <div id="d" class="peer" data-agent-native-node-id="d">D</div>
        </div>
      </body></html>`);
      await installBridge(page);

      // Grid row 2, left-side padding immediately before C. An X-only nearest
      // child resolver ties A and C and incorrectly chooses A from row 1.
      await dragCenterTo(page, "#source", { x: 306, y: 185 });
      const result = await page.locator("#grid").evaluate((grid) => ({
        order: Array.from(grid.children).map((child) => child.id),
        sourcePosition: getComputedStyle(document.querySelector("#source")!)
          .position,
      }));
      expect(result.order).toEqual(["a", "b", "source", "c", "d"]);
      expect(result.sourcePosition).not.toBe("absolute");
      await page.close();
    },
  );

  it(
    "resolves before, between, and after sibling slots from real gap/padding pointer positions",
    { timeout: 30_000 },
    async () => {
      const cases = [
        { name: "before", x: 306, order: ["source", "a", "b"] },
        { name: "between", x: 388, order: ["a", "source", "b"] },
        { name: "after", x: 500, order: ["a", "b", "source"] },
      ];
      for (const testCase of cases) {
        const page = await browser.newPage({
          viewport: { width: 900, height: 700 },
        });
        await page.setContent(`<!doctype html><html><head><style>
          html,body { margin:0;width:100%;height:100%; }
          body { position:relative; }
          #source { position:absolute;left:40px;top:430px;width:70px;height:50px;background:#6366f1; }
          #row { position:absolute;left:300px;top:80px;width:300px;height:160px;padding:12px;display:flex;align-items:flex-start;gap:12px;background:#eef2ff;box-sizing:border-box; }
          .peer { flex:0 0 70px;height:50px;background:#a5b4fc; }
        </style></head><body>
          <div id="source" data-agent-native-node-id="source">Source</div>
          <div id="row" data-agent-native-node-id="row">
            <div id="a" class="peer" data-agent-native-node-id="a">A</div>
            <div id="b" class="peer" data-agent-native-node-id="b">B</div>
          </div>
        </body></html>`);
        await installBridge(page);
        await dragCenterTo(page, "#source", { x: testCase.x, y: 150 });
        const order = await page
          .locator("#row")
          .evaluate((row) => Array.from(row.children).map((child) => child.id));
        expect(order, testCase.name).toEqual(testCase.order);
        await page.close();
      }
    },
  );

  it(
    "Control-drag atomically toggles a flow child to Ignore auto layout and restores the exact flow snapshot",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        html,body { margin:0;width:100%;height:100%; }
        body { position:relative; }
        #frame { position:absolute;left:120px;top:80px;width:520px;height:240px;padding:20px;display:flex;align-items:flex-start;gap:16px;background:#eef2ff;box-sizing:border-box; }
        #item { flex:0 0 auto;width:100px;height:44px;background:#6366f1; }
        #peer { flex:0 0 auto;width:100px;height:44px;background:#a5b4fc; }
      </style></head><body>
        <div id="frame" data-agent-native-node-id="frame">
          <div id="item" data-agent-native-node-id="item">Item</div>
          <div id="peer" data-agent-native-node-id="peer">Peer</div>
        </div>
      </body></html>`);
      await installBridge(page);
      const before = await page.locator("#item").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          order: Array.from(element.parentElement!.children).map(
            (child) => child.id,
          ),
        };
      });

      await dragCenterTo(page, "#item", { x: 540, y: 250 }, "Control");
      const ignored = await page.locator("#item").evaluate((element) => {
        const item = element as HTMLElement;
        const rect = item.getBoundingClientRect();
        const messages = (
          window as Window & { __matrixMessages?: Record<string, unknown>[] }
        ).__matrixMessages!;
        const structures = messages.filter(
          (message) => message.type === "visual-structure-change",
        );
        return {
          parent: item.parentElement?.id,
          position: getComputedStyle(item).position,
          left: item.style.left,
          top: item.style.top,
          width: rect.width,
          height: rect.height,
          structures,
        };
      });
      expect(ignored.parent).toBe("frame");
      expect(ignored.position).toBe("absolute");
      expect(ignored.left).toMatch(/px$/);
      expect(ignored.top).toMatch(/px$/);
      expect(ignored.width).toBeCloseTo(before.width, 5);
      expect(ignored.height).toBeCloseTo(before.height, 5);
      expect(ignored.structures).toHaveLength(1);
      expect(ignored.structures[0]).toMatchObject({
        sourceId: "item",
        anchorSourceId: "frame",
        placement: "inside",
        dropMode: "absolute-container",
      });

      // A rejected host persistence round-trip uses the same pre-gesture
      // snapshot kept for Cmd+Z history: parent/order and position styles must
      // return atomically, never leaving a half-flow/half-absolute member.
      await page.evaluate((requestId) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window,
            data: {
              type: "visual-structure-ack",
              requestId,
              applied: false,
            },
          }),
        );
      }, ignored.structures[0]!.requestId);
      await expect
        .poll(() =>
          page.locator("#item").evaluate((element) => {
            const item = element as HTMLElement;
            return {
              parent: item.parentElement?.id,
              position: getComputedStyle(item).position,
              left: item.style.left,
              top: item.style.top,
              order: Array.from(item.parentElement!.children).map(
                (child) => child.id,
              ),
            };
          }),
        )
        .toEqual({
          parent: "frame",
          position: "static",
          left: "",
          top: "",
          order: before.order,
        });
      await page.close();
    },
  );

  it(
    "keeps visual geometry continuous when nesting into a rotated and scaled freeform frame",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 760 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        html,body { margin:0;width:100%;height:100%; }
        body { position:relative; }
        #source { position:absolute;left:40px;top:500px;width:80px;height:44px;background:#6366f1; }
        #target { position:absolute;left:340px;top:100px;width:320px;height:240px;border:4px solid #818cf8;background:#eef2ff;transform-origin:0 0;transform:rotate(11deg) scale(1.12); }
      </style></head><body>
        <div id="source" data-agent-native-node-id="source">Source</div>
        <div id="target" data-agent-native-node-id="target" data-an-primitive="frame"></div>
      </body></html>`);
      await installBridge(page);
      const targetBox = await page.locator("#target").boundingBox();
      expect(targetBox).not.toBeNull();
      const beforeRelease = await dragCenterTo(page, "#source", {
        x: targetBox!.x + targetBox!.width * 0.62,
        y: targetBox!.y + targetBox!.height * 0.58,
      });
      const after = await page.locator("#source").evaluate((element) => {
        const item = element as HTMLElement;
        const rect = item.getBoundingClientRect();
        return {
          parent: item.parentElement?.id,
          position: getComputedStyle(item).position,
          left: rect.left,
          top: rect.top,
        };
      });
      expect(after.parent).toBe("target");
      expect(after.position).toBe("absolute");
      expect(after.left).toBeCloseTo(beforeRelease.left, 1);
      expect(after.top).toBeCloseTo(beforeRelease.top, 1);
      await page.close();
    },
  );
});

describe("cross-screen source and runtime matrix", () => {
  it("preserves absolute semantics for freeform destinations and strips them for flex/grid destinations with exact undo/redo snapshots", () => {
    const source = ensureCodeLayerNodeIdsInHtml(
      `<body><div data-agent-native-layer-name="Movable" class="absolute md:!fixed left-20 top-10 rounded" style="position:absolute;left:80px;top:40px">Move</div></body>`,
    ).content;
    const freeform = ensureCodeLayerNodeIdsInHtml(
      `<body><section data-agent-native-layer-name="Freeform" data-an-primitive="frame" style="position:absolute;left:20px;top:20px"></section></body>`,
    ).content;
    const flowTargets = [
      `<body><section data-agent-native-layer-name="Target" style="display:flex;flex-direction:row;gap:8px"><span data-agent-native-layer-name="Peer">Peer</span></section></body>`,
      `<body><section data-agent-native-layer-name="Target" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"><span data-agent-native-layer-name="Peer">Peer</span></section></body>`,
    ];
    const movableId = sourceId(source, "Movable");

    const freeformMove = moveNodeBetweenDocuments(source, freeform, {
      nodeId: movableId,
      anchorNodeId: sourceId(freeform, "Freeform"),
      placement: "inside",
    });
    expect(freeformMove.status).toBe("applied");
    expect(freeformMove.destHtml).toContain("position:absolute");
    expect(freeformMove.destHtml).toContain("left:80px");

    for (const targetMarkup of flowTargets) {
      const destination = ensureCodeLayerNodeIdsInHtml(targetMarkup).content;
      const moved = moveNodeBetweenDocuments(source, destination, {
        nodeId: movableId,
        anchorNodeId: sourceId(destination, "Peer"),
        placement: "before",
      });
      expect(moved.status).toBe("applied");
      expect(moved.sourceHtml).not.toContain("Move</div>");
      expect(moved.destHtml).not.toContain("position:absolute");
      expect(moved.destHtml).not.toMatch(/(?:^|\s)absolute(?:\s|$)/);
      expect(moved.destHtml).not.toContain("md:!fixed");

      // The editor's source history is a one-snapshot mutation: undo returns
      // both documents exactly, redo returns the exact moved pair.
      const history = [
        { source, destination },
        { source: moved.sourceHtml, destination: moved.destHtml },
      ];
      expect(history[history.length - 2]).toEqual({ source, destination });
      expect(history[history.length - 1]).toEqual({
        source: moved.sourceHtml,
        destination: moved.destHtml,
      });
    }
  });

  it("uses the same-screen bridge only for safe runtime/runtime moves and semantic handoff for cross-screen or mixed ownership", () => {
    expect(
      resolveRuntimeStructureMoveExecutionMode({
        subjectRuntimeOnly: true,
        targetRuntimeOnly: true,
        sourceScreenId: "screen-a",
        targetScreenId: "screen-a",
      }),
    ).toBe("screen-bridge");
    for (const ownership of [
      { subjectRuntimeOnly: true, targetRuntimeOnly: true },
      { subjectRuntimeOnly: true, targetRuntimeOnly: false },
      { subjectRuntimeOnly: false, targetRuntimeOnly: true },
    ]) {
      expect(
        resolveRuntimeStructureMoveExecutionMode({
          ...ownership,
          sourceScreenId: "screen-a",
          targetScreenId: "screen-b",
        }),
      ).toBe("semantic-handoff");
    }

    const anchor = (relPath: string, component: string) => ({
      relPath,
      sourceFile: relPath,
      line: 12,
      column: 5,
      component,
      runtimeMultiplicity: 1,
      scope: "single-instance" as const,
    });
    const built = buildRuntimeReactStructureMoveHandoff({
      subjectAnchor: anchor("app/components/Card.tsx", "Card"),
      targetAnchor: anchor("app/components/Grid.tsx", "Grid"),
      placement: "inside",
      sourceScreenId: "screen-a",
      targetScreenId: "screen-b",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.handoff.runtimeRelationship).toMatchObject({
      kind: "inside",
      sourceScreenId: "screen-a",
      targetScreenId: "screen-b",
    });
    expect(built.handoff.executionContract).toMatchObject({
      requiresHumanWriteConsent: true,
      requiresExpectedVersionHash: true,
      allowsGenericAstStructureTransform: false,
      preservePreviewUntilHmrConfirmation: true,
    });
  });
});
