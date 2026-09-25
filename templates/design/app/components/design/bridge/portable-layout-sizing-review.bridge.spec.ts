import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("sizing-fixture"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

async function captureStart(html: string, selector: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(html);
    await page.addScriptTag({ content: hydratedBridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__dragStarts = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (
          event.data?.type === "agent-native:cross-screen-drag" &&
          event.data.phase === "start"
        ) {
          (window as any).__dragStarts.push(event.data);
        }
      });
    });
    await page.evaluate((value) => {
      window.postMessage(
        {
          type: "select-element",
          selector: value,
          selectorCandidates: [value],
        },
        "*",
      );
    }, selector);
    await page.waitForTimeout(30);
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`Missing sizing fixture ${selector}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForFunction(
      () => (window as any).__dragStarts.length > 0,
      undefined,
      { timeout: 3000 },
    );
    const start = await page.evaluate(() => (window as any).__dragStarts[0]);
    await page.mouse.up();
    return start as {
      styleSnapshot?: { nodes?: Array<{ styles?: Record<string, string> }> };
      sourceComputedSize?: { width?: number; height?: number };
    };
  } finally {
    await browser.close();
  }
}

const rootStyles = (start: Awaited<ReturnType<typeof captureStart>>) =>
  start.styleSnapshot?.nodes?.[0]?.styles ?? {};

describe("portable auto-layout dimensions for cross-screen drops", () => {
  it("recognizes a stylesheet-authored physical auto margin", async () => {
    const start = await captureStart(
      `<!doctype html><html><head><style>
        .physical { margin-top:auto; }
      </style></head><body style="margin:0">
        <main style="display:flex;flex-direction:row;align-items:stretch;width:300px;height:200px">
          <div class="physical" data-agent-native-node-id="physical" style="width:40px;height:auto">Physical auto margin</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="physical"]',
    );
    expect(rootStyles(start).height).toBe("auto");
    expect(start.sourceComputedSize?.height).toBeUndefined();
  });

  it("recognizes a stylesheet-authored logical auto margin", async () => {
    const logicalStart = await captureStart(
      `<!doctype html><html><head><style>
        .logical { margin-block-end:auto; }
      </style></head><body style="margin:0">
        <main style="display:flex;flex-direction:row;align-items:stretch;width:300px;height:200px">
          <div class="logical" data-agent-native-node-id="logical" style="width:40px;height:auto">Logical auto margin</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="logical"]',
    );
    expect(logicalStart.sourceComputedSize?.height).toBeUndefined();
  });

  it("does not freeze a Grid dimension disabled by a stylesheet logical auto margin", async () => {
    const start = await captureStart(
      `<!doctype html><html><head><style>
        .logical-grid-margin { margin-inline-start:auto; }
      </style></head><body style="margin:0">
        <main style="display:grid;justify-items:stretch;align-items:stretch;width:300px;height:200px;grid-template-columns:300px;grid-template-rows:200px">
          <div class="logical-grid-margin" data-agent-native-node-id="grid-margin" style="width:auto;height:auto">Intrinsic Grid item</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="grid-margin"]',
    );
    expect(start.sourceComputedSize?.width).toBeUndefined();
  });

  it("keeps a Grid dimension unresolved when Typed OM fails to read it", async () => {
    const start = await captureStart(
      `<!doctype html><html><head><style>
        .unreadable { width:auto; height:auto; }
      </style><script>
        const readStyleMap = Element.prototype.computedStyleMap;
        Element.prototype.computedStyleMap = function () {
          if (this.matches("[data-agent-native-node-id=unreadable]")) {
            throw new Error("fixture Typed OM read failure");
          }
          return readStyleMap.call(this);
        };
      </script></head><body style="margin:0">
        <main style="display:grid;justify-items:stretch;align-items:stretch;width:300px;height:200px;grid-template-columns:300px;grid-template-rows:200px">
          <div class="unreadable" data-agent-native-node-id="unreadable">Unreadable Grid item</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="unreadable"]',
    );
    expect(rootStyles(start)).not.toHaveProperty("width");
    expect(rootStyles(start)).not.toHaveProperty("height");
    expect(start.sourceComputedSize).toBeUndefined();
  });

  it("preserves stylesheet-fixed Grid dimensions instead of treating them as stretch", async () => {
    const start = await captureStart(
      `<!doctype html><html><head><style>
        .fixed-grid-item { width:120px; height:70px; }
      </style></head><body style="margin:0">
        <main style="display:grid;justify-items:stretch;align-items:stretch;width:300px;height:200px;grid-template-columns:300px;grid-template-rows:200px">
          <div class="fixed-grid-item" data-agent-native-node-id="fixed-grid">Fixed dimensions</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="fixed-grid"]',
    );
    expect(rootStyles(start)).toMatchObject({ width: "120px", height: "70px" });
    expect(start.sourceComputedSize).toBeUndefined();
  });

  it("preserves fixed Flex dimensions when shrink is available but does not occur", async () => {
    const fixed = await captureStart(
      `<!doctype html><html><head><style>
        .fixed { width:120px; height:20px; }
      </style></head><body style="margin:0">
        <main style="display:flex;align-items:flex-start;width:500px;height:100px">
          <div class="fixed" data-agent-native-node-id="fixed">Fixed, ample space</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="fixed"]',
    );
    expect(rootStyles(fixed)).toMatchObject({ width: "120px", height: "20px" });
    expect(fixed.sourceComputedSize).toBeUndefined();
  });

  it("does not freeze intrinsic Flex size when shrink is available but does not occur", async () => {
    const intrinsic = await captureStart(
      `<!doctype html><html><body style="margin:0">
        <main style="display:flex;align-items:flex-start;width:500px;height:100px">
          <div data-agent-native-node-id="intrinsic" style="flex:0 1 auto;align-self:flex-start;white-space:nowrap">Intrinsic, ample space</div>
        </main>
      </body></html>`,
      '[data-agent-native-node-id="intrinsic"]',
    );
    expect(rootStyles(intrinsic)).not.toHaveProperty("width");
    expect(intrinsic.sourceComputedSize).toBeUndefined();
  });

  it.each([
    {
      direction: "row",
      width: 100,
      height: 300,
      expected: { width: 100 },
    },
    {
      direction: "column",
      width: 300,
      height: 100,
      expected: { height: 100 },
    },
  ])(
    "resolves physical cross-axis size for vertical writing-mode $direction",
    async ({ direction, width, height, expected }) => {
      const start = await captureStart(
        `<!doctype html><html><body style="margin:0">
          <main style="display:flex;writing-mode:vertical-rl;flex-direction:${direction};width:${width}px;height:${height}px">
            <div data-agent-native-node-id="vertical" style="flex:0 0 auto;width:auto;height:auto;line-height:20px">Vertical item</div>
          </main>
        </body></html>`,
        '[data-agent-native-node-id="vertical"]',
      );
      expect(rootStyles(start)).toMatchObject({
        width: "auto",
        height: "auto",
      });
      expect(start.sourceComputedSize).toEqual(expected);
    },
  );
});
