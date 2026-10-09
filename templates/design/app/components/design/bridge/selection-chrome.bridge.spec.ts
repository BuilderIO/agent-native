import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("selection-chrome"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div id="auto-layout" style="display:flex;width:600px;height:400px;padding:20px;gap:20px">
    <div id="frame" data-agent-native-node-id="frame" data-an-primitive="frame" style="display:flex;width:300px;height:300px;background:#fff">
      <div id="child" data-agent-native-node-id="child" data-an-primitive="rectangle" style="width:80px;height:80px;background:#d4d4d8"></div>
    </div>
  </div>
</body></html>`;

async function select(page: import("@playwright/test").Page, selector: string) {
  await page.evaluate((value) => {
    window.postMessage(
      { type: "select-element", selector: value, selectorCandidates: [value] },
      "*",
    );
  }, selector);
  await page.waitForTimeout(50);
}

describe("editor chrome selection overlays", () => {
  it("publishes viewport-relative Position for a fixed node after document scroll", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:3000px;height:1600px">
        <div id="fixed" data-agent-native-node-id="fixed" style="position:fixed;left:35px;top:24px;width:80px;height:40px">Fixed</div>
      </body></html>`);
      await page.evaluate(() => {
        (
          window as Window & {
            __positionSelections?: { payload: Record<string, unknown> }[];
          }
        ).__positionSelections = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            (
              window as Window & {
                __positionSelections?: { payload: Record<string, unknown> }[];
              }
            ).__positionSelections?.push(event.data);
          }
        });
        window.scrollTo(50, 70);
      });
      await page.waitForFunction(
        () => window.scrollX === 50 && window.scrollY === 70,
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#fixed");
      await page.waitForFunction(
        () =>
          (
            window as Window & {
              __positionSelections?: unknown[];
            }
          ).__positionSelections?.length,
      );

      const selection = await page.evaluate(() => {
        const selections = (
          window as Window & {
            __positionSelections?: {
              payload: {
                boundingRect?: { x: number; y: number };
                positionReferenceRect?: { x: number; y: number };
                positionContainingBlockOrigin?: { x: number; y: number };
              };
            }[];
          }
        ).__positionSelections;
        const message = selections?.[selections.length - 1];
        return message?.payload;
      });

      expect(selection).toMatchObject({
        boundingRect: { x: 85, y: 94 },
        positionReferenceRect: { x: 50, y: 70 },
        positionContainingBlockOrigin: { x: 50, y: 70 },
      });
    } finally {
      await browser.close();
    }
  });

  it("keeps fixed descendants on the document reference when getBoxQuads is available", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:3000px;height:1600px">
        <div id="containing-block" style="transform:translate(10px,20px);width:300px;height:200px">
          <div id="fixed" data-agent-native-node-id="fixed" style="position:fixed;left:35px;top:24px;width:80px;height:40px">Fixed</div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const containingBlock = document.querySelector("#containing-block")!;
        Object.defineProperty(containingBlock, "getBoxQuads", {
          configurable: true,
          value: () => [{ p1: { x: 110, y: 120 } }],
        });
        (
          window as Window & {
            __positionSelections?: { payload: Record<string, unknown> }[];
          }
        ).__positionSelections = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            (
              window as Window & {
                __positionSelections?: { payload: Record<string, unknown> }[];
              }
            ).__positionSelections?.push(event.data);
          }
        });
        window.scrollTo(50, 70);
      });
      await page.waitForFunction(
        () => window.scrollX === 50 && window.scrollY === 70,
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#fixed");
      await page.waitForFunction(
        () =>
          (
            window as Window & {
              __positionSelections?: unknown[];
            }
          ).__positionSelections?.length,
      );

      const selection = await page.evaluate(() => {
        const selections = (
          window as Window & {
            __positionSelections?: {
              payload: {
                positionReferenceRect?: { x: number; y: number };
                positionContainingBlockOrigin?: { x: number; y: number };
              };
            }[];
          }
        ).__positionSelections;
        return selections?.[selections.length - 1]?.payload;
      });

      expect(selection).toMatchObject({
        positionReferenceRect: { x: 0, y: 0 },
        positionContainingBlockOrigin: { x: 160, y: 190 },
      });
    } finally {
      await browser.close();
    }
  });

  it("does not double-outline a selected frame, but keeps the parent cue for child layers", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await select(page, "#frame");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="parent-auto-layout"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("none");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="selection"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("block");
      expect(
        await page
          .locator('[data-agent-native-edit-handle="nw"]')
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return {
              width: rect.width,
              height: rect.height,
              borderRadius: style.borderRadius,
            };
          }),
      ).toEqual({ width: 7, height: 7, borderRadius: "2px" });

      await select(page, "#child");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="parent-auto-layout"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("block");
    } finally {
      await browser.close();
    }
  });

  it("keeps an overview-scale resize alive after the pointer leaves the iframe", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(
        '<div id="viewport" style="width:200px;height:140px;overflow:hidden">' +
          '<iframe id="preview" style="width:1280px;height:900px;border:0;transform:scale(0.15625);transform-origin:0 0"></iframe>' +
          "</div>",
      );
      const iframe = page.locator("#preview");
      const iframeHandle = await iframe.elementHandle();
      if (!iframeHandle) throw new Error("preview iframe did not mount");
      await iframe.evaluate((element) =>
        element.setAttribute(
          "srcdoc",
          '<!doctype html><html><body style="margin:0">' +
            '<div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:200px;height:120px;background:#d4d4d8"></div>' +
            "</body></html>",
        ),
      );
      await page.waitForTimeout(50);
      const frame = await iframeHandle.contentFrame();
      if (!frame) throw new Error("preview iframe document was replaced");
      await frame.locator("#child").waitFor();
      await frame.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      const child = frame.locator("#child");
      const childBox = (await child.boundingBox())!;
      await page.mouse.click(
        childBox.x + childBox.width / 2,
        childBox.y + childBox.height / 2,
      );
      await page.waitForTimeout(200);

      const handle = frame.locator('[data-agent-native-edit-handle="se"]');
      const handleBox = (await handle.boundingBox())!;
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 220, handleBox.y + 100, {
        steps: 12,
      });
      await page.mouse.up();

      const resized = await frame.locator("#child").evaluate((element) => ({
        width: (element as HTMLElement).style.width,
        height: (element as HTMLElement).style.height,
      }));
      expect(Number.parseFloat(resized.width)).toBeGreaterThan(200);
      expect(Number.parseFloat(resized.height)).toBeGreaterThan(120);
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements after sibling insertion and class changes", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #hover-parent > .layout-sibling { height:20px; }
        #hover-parent > .layout-sibling.expanded { height:40px; }
      </style></head><body style="margin:0">
        <div id="selected-parent" style="position:relative;width:1000px;height:800px">
          <div id="selected" data-agent-native-node-id="selected" style="position:absolute;left:200px;top:200px;width:200px;height:120px;background:#d4d4d8"></div>
        </div>
        <div id="hover-parent" style="position:absolute;left:519px;top:400px;width:200px;display:flex;flex-direction:column">
          <div id="hovered" data-agent-native-node-id="hovered" style="width:200px;height:120px;background:#ccc"></div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        type ObserverEvent = {
          observerId: number;
          event: "observe-hover-parent" | "disconnect-hover-parent";
        };
        const events: ObserverEvent[] = [];
        let nextObserverId = 1;
        const observerIds = new WeakMap<MutationObserver, number>();
        const observingHoverParent = new WeakSet<MutationObserver>();
        const getObserverId = (observer: MutationObserver) => {
          let observerId = observerIds.get(observer);
          if (!observerId) {
            observerId = nextObserverId++;
            observerIds.set(observer, observerId);
          }
          return observerId;
        };
        const originalObserve = MutationObserver.prototype.observe;
        MutationObserver.prototype.observe = function (target, options) {
          if (target instanceof Element && target.id === "hover-parent") {
            observingHoverParent.add(this);
            events.push({
              observerId: getObserverId(this),
              event: "observe-hover-parent",
            });
          }
          return originalObserve.call(this, target, options);
        };
        const originalDisconnect = MutationObserver.prototype.disconnect;
        MutationObserver.prototype.disconnect = function () {
          if (observingHoverParent.has(this)) {
            events.push({
              observerId: getObserverId(this),
              event: "disconnect-hover-parent",
            });
            observingHoverParent.delete(this);
          }
          return originalDisconnect.call(this);
        };
        (
          window as Window & {
            __altMeasurementObserverEvents?: ObserverEvent[];
          }
        ).__altMeasurementObserverEvents = events;
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(1_200);

      await page.evaluate(() => {
        const parent = document.querySelector("#hover-parent")!;
        const sibling = document.createElement("div");
        sibling.className = "layout-sibling";
        parent.insertBefore(sibling, parent.firstElementChild);
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(1_200);
      await page.evaluate(() => {
        document
          .querySelector("#hover-parent > .layout-sibling")!
          .classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,120";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["119", "120"]);
      await page.keyboard.up("Alt");
      const observerDetached = await page.evaluate(() => {
        const events =
          (
            window as Window & {
              __altMeasurementObserverEvents?: {
                observerId: number;
                event: "observe-hover-parent" | "disconnect-hover-parent";
              }[];
            }
          ).__altMeasurementObserverEvents ?? [];
        const lastObserveIndex = events
          .map((event) => event.event)
          .lastIndexOf("observe-hover-parent");
        const lastObserverId = events[lastObserveIndex]?.observerId;
        return (
          lastObserveIndex >= 0 &&
          events.some(
            (event, index) =>
              index > lastObserveIndex &&
              event.observerId === lastObserverId &&
              event.event === "disconnect-hover-parent",
          )
        );
      });
      expect(observerDetached).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements when a nested sibling changes in a shared parent", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #shared-parent { position:relative; box-sizing:border-box; width:1000px; height:800px; padding-top:20px; display:flex; flex-direction:column; align-items:flex-start; }
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #layout-sibling { display:flow-root; }
        #layout-content { height:380px; }
        #layout-content.expanded { height:400px; }
        #hovered { width:200px; height:120px; margin-left:519px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="shared-parent">
          <div id="selected" data-agent-native-node-id="selected"></div>
          <div id="layout-sibling"><div id="layout-content"></div></div>
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(1_200);

      await page.locator("#layout-content").evaluate((element) => {
        element.classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["100", "119"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements when the hovered target is nested in the selected element", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #layout-sibling { display:flow-root; }
        #layout-content { height:200px; }
        #layout-content.expanded { height:220px; }
        #hovered { width:200px; height:120px; margin-left:319px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="selected" data-agent-native-node-id="selected">
          <div id="layout-sibling"><div id="layout-content"></div></div>
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(1_200);

      await page.locator("#layout-content").evaluate((element) => {
        element.classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["100", "119"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });
});
