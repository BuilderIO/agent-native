import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

const SCREEN_ROOT = `<!doctype html><html><body style="margin:0;display:flex;flex-direction:column;gap:20px;width:320px;height:260px">
  <section data-agent-native-node-id="first" style="width:280px;height:100px;flex:none">First</section>
  <section data-agent-native-node-id="second" style="width:280px;height:100px;flex:none">Second</section>
</body></html>`;

describe("Screen-root auto-layout hit testing", () => {
  it("returns a real root child insertion anchor from the gap between children", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(SCREEN_ROOT);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "screen-root-gap",
            x: 80,
            y: 115,
            preview: true,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "screen-root-gap",
        anchorNodeId: "second",
        placement: "before",
        axis: "y",
        dropMode: "flow-insert",
      });
      expect(
        await page
          .locator("[data-agent-native-hit-test-preview]")
          .evaluate((element) => ({
            display: getComputedStyle(element).display,
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          })),
      ).toMatchObject({ display: "block", width: 280, height: 2 });

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "screen-root-outside",
            x: 500,
            y: 115,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 2,
      );
      const outsidePacket = await page.evaluate(
        () => (window as any).__hitTestResults[1],
      );
      expect(outsidePacket).toMatchObject({
        correlationId: "screen-root-outside",
        anchorNodeId: "",
        placement: "inside",
        axis: "y",
        dropMode: "flow-insert",
      });
      expect(outsidePacket.anchorRect).toBeUndefined();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("falls back through undersized plain frames to the nearest fitting auto-layout ancestor", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="outer" style="position:absolute;left:40px;top:40px;width:420px;height:320px;display:flex;flex-direction:column">
          <section data-agent-native-node-id="middle" data-an-primitive="frame" style="position:relative;flex:0 0 180px;width:180px;height:180px">
            <section data-agent-native-node-id="nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px">
              <div data-agent-native-node-id="anchor" style="position:absolute;left:12px;top:12px;width:60px;height:32px"></div>
            </section>
          </section>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        const nested = document.querySelector(
          '[data-agent-native-node-id="nested"]',
        )!;
        const rect = nested.getBoundingClientRect();
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "oversized-nested-plain-frame",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            preview: true,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "oversized-nested-plain-frame",
        anchorNodeId: "middle",
        placement: "before",
        axis: "y",
        dropMode: "flow-insert",
      });
      expect(
        await page.evaluate(() => {
          const sourceSize = { width: 220, height: 96 };
          const middle = document.querySelector(
            '[data-agent-native-node-id="middle"]',
          )!;
          const outer = middle.parentElement!;
          const middleRect = middle.getBoundingClientRect();
          const outerRect = outer.getBoundingClientRect();
          return {
            selectedSlotParent: outer.getAttribute("data-agent-native-node-id"),
            middleFits:
              middleRect.width >= sourceSize.width &&
              middleRect.height >= sourceSize.height,
            outerFits:
              outerRect.width >= sourceSize.width &&
              outerRect.height >= sourceSize.height,
          };
        }),
      ).toEqual({
        selectedSlotParent: "outer",
        middleFits: false,
        outerFits: true,
      });
      expect(
        await page
          .locator("[data-agent-native-hit-test-preview]")
          .evaluate((element) => ({
            display: getComputedStyle(element).display,
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          })),
      ).toMatchObject({ display: "block", width: 180, height: 2 });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("uses a fitting legacy-marked plain frame as an absolute container, not a flow slot", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="outer" style="position:absolute;left:40px;top:40px;width:420px;height:320px;display:flex;flex-direction:column">
          <section data-agent-native-node-id="middle" data-agent-native-primitive="rectangle" style="position:absolute;left:0;top:0;width:260px;height:260px">
            <section data-agent-native-node-id="nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px">
              <div data-agent-native-node-id="anchor" style="position:absolute;left:12px;top:12px;width:60px;height:32px"></div>
            </section>
          </section>
        </section>
        </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        const nested = document.querySelector(
          '[data-agent-native-node-id="nested"]',
        )!;
        const rect = nested.getBoundingClientRect();
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "legacy-frame-absolute-fallback",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            preview: true,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      expect(
        await page.evaluate(() => (window as any).__hitTestResults[0]),
      ).toMatchObject({
        correlationId: "legacy-frame-absolute-fallback",
        anchorNodeId: "middle",
        placement: "inside",
        axis: "y",
        dropMode: "absolute-container",
      });
    } finally {
      await browser.close();
    }
  });

  it("keeps flow slots and measures ancestor content space during size fallback", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 900 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:900px;position:relative">
        <section data-agent-native-node-id="row" style="position:absolute;left:40px;top:40px;box-sizing:border-box;width:420px;height:70px;padding:20px;display:flex;flex-direction:row;gap:12px">
          <section data-agent-native-node-id="nested-row" style="flex:none;width:120px;height:40px;display:flex;flex-direction:row">
            <div data-agent-native-node-id="marker" style="flex:none;width:110px;height:36px">Marker</div>
          </section>
          <div data-agent-native-node-id="peer" style="flex:none;width:100px;height:36px">Peer</div>
        </section>
        <section data-agent-native-node-id="padded-rect" data-agent-native-primitive="rectangle" style="position:absolute;left:40px;top:200px;box-sizing:border-box;width:250px;height:180px;padding:20px">
          <section data-agent-native-node-id="padded-inner" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></section>
        </section>
        <section data-agent-native-node-id="reverse-row" style="position:absolute;left:40px;top:400px;width:420px;height:120px;display:flex;flex-direction:row-reverse">
          <section data-agent-native-node-id="reverse-row-nested" data-an-primitive="frame" style="flex:none;width:120px;height:80px;display:flex;flex-direction:column">
            <div data-agent-native-node-id="reverse-row-anchor" style="flex:none;width:80px;height:32px"></div>
          </section>
        </section>
        <section data-agent-native-node-id="column" style="position:absolute;left:40px;top:540px;width:180px;height:160px;display:flex;flex-direction:column">
          <section data-agent-native-node-id="column-nested" data-an-primitive="frame" style="flex:none;width:120px;height:80px;display:flex;flex-direction:column">
            <div data-agent-native-node-id="column-anchor" style="flex:none;width:80px;height:32px"></div>
          </section>
        </section>
        <section data-agent-native-node-id="reverse-column" style="position:absolute;left:40px;top:720px;width:280px;height:160px;display:flex;flex-direction:column-reverse">
          <section data-agent-native-node-id="reverse-column-nested" data-an-primitive="frame" style="flex:none;width:120px;height:80px;display:flex;flex-direction:column">
            <div data-agent-native-node-id="reverse-column-anchor" style="flex:none;width:80px;height:32px"></div>
          </section>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "flow-slot-fallback",
            x: 155,
            y: 80,
            sourceElementSize: { width: 220, height: 80 },
          },
          "*",
        );
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "content-box-fallback",
            x: 80,
            y: 240,
            sourceElementSize: { width: 220, height: 90 },
          },
          "*",
        );
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "reverse-row-fallback",
            x: 450,
            y: 440,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "column-main-axis-fallback",
            x: 100,
            y: 580,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "reverse-column-fallback",
            x: 100,
            y: 810,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 5,
      );

      const packets = await page.evaluate(
        () => (window as any).__hitTestResults,
      );
      expect(packets[0]).toMatchObject({
        correlationId: "flow-slot-fallback",
        anchorNodeId: "nested-row",
        placement: "after",
        axis: "x",
        dropMode: "flow-insert",
      });
      expect(packets[1]).toMatchObject({
        correlationId: "content-box-fallback",
        anchorNodeId: "",
        placement: "inside",
        dropMode: "flow-insert",
      });
      expect(packets[1].anchorRect).toBeUndefined();
      expect(packets[2]).toMatchObject({
        correlationId: "reverse-row-fallback",
        anchorNodeId: "reverse-row-nested",
        placement: "before",
        axis: "x",
        dropMode: "flow-insert",
      });
      expect(packets[3]).toMatchObject({
        correlationId: "column-main-axis-fallback",
        anchorNodeId: "column-nested",
        axis: "y",
        dropMode: "flow-insert",
      });
      expect(packets[4]).toMatchObject({
        correlationId: "reverse-column-fallback",
        anchorNodeId: "reverse-column-nested",
        placement: "after",
        axis: "y",
        dropMode: "flow-insert",
      });
    } finally {
      await browser.close();
    }
  });

  it("uses reverse-flex visual order for direct child insertion", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 640 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:640px;position:relative">
        <section style="position:absolute;left:40px;top:40px;width:420px;height:100px;display:flex;flex-direction:row-reverse">
          <div data-agent-native-node-id="row-reverse-first" style="flex:none;width:100px;height:80px"></div>
          <div data-agent-native-node-id="row-reverse-second" style="flex:none;width:100px;height:80px"></div>
        </section>
        <section style="position:absolute;left:40px;top:200px;width:120px;height:300px;display:flex;flex-direction:column-reverse">
          <div data-agent-native-node-id="column-reverse-first" style="flex:none;width:100px;height:80px"></div>
          <div data-agent-native-node-id="column-reverse-second" style="flex:none;width:100px;height:80px"></div>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "direct-row-reverse",
            x: 365,
            y: 60,
            sourceElementSize: { width: 20, height: 20 },
          },
          "*",
        );
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "direct-column-reverse",
            x: 60,
            y: 425,
            sourceElementSize: { width: 20, height: 20 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 2,
      );
      const packets = await page.evaluate(
        () => (window as any).__hitTestResults,
      );
      expect(packets[0]).toMatchObject({
        correlationId: "direct-row-reverse",
        anchorNodeId: "row-reverse-first",
        placement: "after",
        axis: "x",
      });
      expect(packets[1]).toMatchObject({
        correlationId: "direct-column-reverse",
        anchorNodeId: "column-reverse-first",
        placement: "after",
        axis: "y",
      });
    } finally {
      await browser.close();
    }
  });

  it("does not promote an oversized drop beyond a too-small board root", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="screen-root" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:160px;height:120px;display:flex;flex-direction:row">
          <section data-agent-native-node-id="nested-root" data-an-primitive="frame" style="flex:none;width:100px;height:80px;display:flex;flex-direction:column">
            <div data-agent-native-node-id="root-anchor" style="flex:none;width:60px;height:32px"></div>
          </section>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "undersized-board-root",
            x: 80,
            y: 80,
            preview: true,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );
      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "undersized-board-root",
        anchorNodeId: "",
      });
      expect(packet.anchorNodeId).not.toBe("screen-root");
    } finally {
      await browser.close();
    }
  });

  it("uses a fitting board-root flow slot when the direct auto-layout receiver is too small", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="root-flow" style="position:absolute;left:40px;top:40px;width:140px;height:80px;display:flex;flex-direction:row">
          <div data-agent-native-node-id="root-child" style="flex:none;width:80px;height:40px"></div>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "root-flow-sibling-fallback",
            x: 100,
            y: 60,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      expect(
        await page.evaluate(() => (window as any).__hitTestResults[0]),
      ).toMatchObject({
        correlationId: "root-flow-sibling-fallback",
        anchorNodeId: "root-flow",
        placement: "before",
        axis: "y",
        dropMode: "flow-insert",
      });
    } finally {
      await browser.close();
    }
  });

  it("does not apply reverse-flex ordering to a direct child in an RTL grid", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="rtl-grid" style="position:absolute;left:40px;top:40px;width:320px;height:180px;display:grid;grid-template-columns:repeat(2,140px);grid-template-rows:repeat(2,70px);gap:20px;direction:rtl">
          <div data-agent-native-node-id="rtl-grid-first" style="width:80px;height:40px"></div>
          <div data-agent-native-node-id="rtl-grid-second" style="width:80px;height:40px"></div>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        const child = document.querySelector(
          '[data-agent-native-node-id="rtl-grid-first"]',
        )!;
        const rect = child.getBoundingClientRect();
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "rtl-grid-direct-child",
            x: rect.left + 8,
            y: rect.top + rect.height / 2,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      expect(
        await page.evaluate(() => (window as any).__hitTestResults[0]),
      ).toMatchObject({
        correlationId: "rtl-grid-direct-child",
        anchorNodeId: "rtl-grid-first",
        placement: "before",
        axis: "x",
        dropMode: "flow-insert",
      });
    } finally {
      await browser.close();
    }
  });

  it("uses grid cell targeting for an oversized drop at an empty trailing cell", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="grid-root" style="position:absolute;left:40px;top:40px;width:320px;height:180px;display:grid;grid-template-columns:repeat(2,140px);grid-template-rows:repeat(2,70px);gap:20px">
          <section data-agent-native-node-id="nested-flow" style="position:absolute;left:10px;top:10px;display:flex;flex-direction:column;width:100px;height:72px">
            <div data-agent-native-node-id="nested-child" style="flex:none;width:80px;height:32px"></div>
          </section>
          <div data-agent-native-node-id="grid-sibling" style="width:80px;height:40px"></div>
        </section>
      </body></html>`);
      const editorBridge = editorChromeBridgeScript
        .replace("__READ_ONLY__", "false")
        .replace("__TEXT_EDITING_ENABLED__", "true")
        .replace("__EDITOR_CHROME_SCALE_X__", "1")
        .replace("__EDITOR_CHROME_SCALE_Y__", "1")
        .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("grid-screen"))
        .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
        .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
        .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
        .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
        .replace("__LIVE_REFLOW_ENABLED__", "false")
        .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
        .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
      await page.addScriptTag({ content: editorBridge });
      await page.addScriptTag({ content: hitTestBridgeScript });
      const gridTarget = await page.evaluate(() => {
        const grid = document.querySelector(
          '[data-agent-native-node-id="grid-root"]',
        )!;
        const target = (
          window as any
        ).__agentNativeDesignNearestChildInsertionTarget(grid, 240, 165);
        return (
          target && {
            placement: target.placement,
            guideMode: target.guideMode,
            gridCell: target.gridCell,
            guideRect: target.guideRect,
          }
        );
      });
      expect(gridTarget).toMatchObject({
        placement: "inside",
        guideMode: "grid-cell",
        gridCell: { column: 1, row: 1 },
        guideRect: { left: 200, top: 130, width: 140, height: 70 },
      });
      await page.evaluate(() => {
        const nestedChild = document.querySelector(
          '[data-agent-native-node-id="nested-child"]',
        )!;
        document.elementsFromPoint = () => [nestedChild];
        document.elementFromPoint = () => nestedChild;
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "empty-trailing-grid-cell-fallback",
            x: 240,
            y: 165,
            sourceElementSize: { width: 180, height: 80 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "empty-trailing-grid-cell-fallback",
        anchorNodeId: "grid-root",
        placement: "inside",
        dropMode: "flow-insert",
      });
    } finally {
      await browser.close();
    }
  });

  it("skips a fitting static section when no valid ancestor container fits", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px">
        <section data-agent-native-node-id="static" style="width:480px;height:320px;background:#334155">
          <div data-agent-native-node-id="nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px;background:#64748b">
            <div data-agent-native-node-id="anchor" style="position:absolute;left:12px;top:12px;width:40px;height:32px"></div>
          </div>
        </section>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        const nested = document.querySelector(
          '[data-agent-native-node-id="nested"]',
        )!;
        const rect = nested.getBoundingClientRect();
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "oversized-under-static-section",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            preview: true,
            sourceElementSize: { width: 220, height: 96 },
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "oversized-under-static-section",
        anchorNodeId: "",
        placement: "inside",
        dropMode: "flow-insert",
      });
      expect(packet.anchorRect).toBeUndefined();
      expect(
        await page.evaluate(() => {
          const sourceSize = { width: 220, height: 96 };
          const nested = document.querySelector(
            '[data-agent-native-node-id="nested"]',
          )!;
          const section = document.querySelector(
            '[data-agent-native-node-id="static"]',
          )!;
          const nestedRect = nested.getBoundingClientRect();
          const sectionRect = section.getBoundingClientRect();
          return {
            sectionPosition: getComputedStyle(section).position,
            nestedFits:
              nestedRect.width >= sourceSize.width &&
              nestedRect.height >= sourceSize.height,
            sectionFits:
              sectionRect.width >= sourceSize.width &&
              sectionRect.height >= sourceSize.height,
          };
        }),
      ).toEqual({
        sectionPosition: "static",
        nestedFits: false,
        sectionFits: true,
      });
    } finally {
      await browser.close();
    }
  });

  it("never uses a transient drag copy as its own insertion anchor", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <div data-agent-native-node-id="source" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:220px;height:160px"></div>
        <div data-agent-native-clone-root="true" data-agent-native-transient-drag-clone="true" data-agent-native-node-id="copy-root" data-an-primitive="frame" style="position:absolute;left:480px;top:300px;width:120px;height:80px;display:flex;flex-direction:column">
          <div data-agent-native-node-id="copy-child" style="height:40px">Copy</div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "transient-copy",
            x: 520,
            y: 320,
            preview: false,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "transient-copy",
        anchorNodeId: "",
        placement: "inside",
        dropMode: "flow-insert",
      });
      expect(packet.pendingNodeId).toBeUndefined();
    } finally {
      await browser.close();
    }
  });

  it("keeps persisted duplicate descendants available as hit-test anchors", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <div data-agent-native-node-id="persisted-copy" data-agent-native-clone-root="true" data-an-primitive="frame" style="position:absolute;left:480px;top:300px;width:120px;height:80px;display:flex;flex-direction:column">
          <div data-agent-native-node-id="persisted-copy-child" style="position:absolute;left:0;top:0;width:40px;height:20px">Copy</div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(event.data);
          }
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "persisted-copy",
            x: 580,
            y: 370,
            preview: false,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );

      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(packet).toMatchObject({
        correlationId: "persisted-copy",
        anchorNodeId: "persisted-copy-child",
        placement: "after",
        dropMode: "flow-insert",
      });
    } finally {
      await browser.close();
    }
  });
});
