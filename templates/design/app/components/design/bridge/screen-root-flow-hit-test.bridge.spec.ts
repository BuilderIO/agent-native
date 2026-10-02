import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

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

describe("grid hit-test placement", () => {
  it("returns the empty grid cell separately from the parent anchor rect", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:10px;box-sizing:border-box;border:4px solid;padding:20px 30px;display:grid;width:420px;height:300px;grid-template-columns:[first] 80px [middle] 80px [last] 80px [end];grid-template-rows:[top] 60px [middle] 60px [bottom];column-gap:20px;row-gap:12px;justify-content:space-between;align-content:center">
          <div data-agent-native-node-id="first" style="grid-column:1;grid-row:1"></div>
          <div data-agent-native-node-id="second" style="grid-column:2;grid-row:1"></div>
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
            correlationId: "grid-empty-cell",
            x: 366,
            y: 196,
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
        anchorNodeId: "grid",
        placement: "inside",
        dropMode: "flow-insert",
        gridPlacement: { column: 3, columnEnd: 4, row: 2, rowEnd: 3 },
        anchorRect: { left: 20, top: 10, width: 420, height: 300 },
        guideRect: { left: 326, top: 166, width: 80, height: 60 },
      });
      expect(
        await page
          .locator("[data-agent-native-hit-test-preview]")
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
          }),
      ).toEqual({ left: 326, top: 166, width: 80, height: 60 });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("maps RTL logical and physical alignment to the correct empty column", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:20px;box-sizing:border-box;width:150px;height:50px;display:grid;grid-template-columns:50px 50px;grid-template-rows:50px">
          <div data-agent-native-node-id="occupied" style="grid-column:1;grid-row:1"></div>
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
      });

      const cases = [
        { direction: "ltr", alignment: "start", x: 95 },
        { direction: "ltr", alignment: "end", x: 145 },
        { direction: "ltr", alignment: "left", x: 95 },
        { direction: "ltr", alignment: "right", x: 145 },
        { direction: "rtl", alignment: "start", x: 95 },
        { direction: "rtl", alignment: "end", x: 45 },
        { direction: "rtl", alignment: "left", x: 45 },
        { direction: "rtl", alignment: "right", x: 95 },
      ];
      for (const [index, testCase] of cases.entries()) {
        await page.evaluate(
          (value) => {
            const grid = document.querySelector<HTMLElement>("#grid")!;
            grid.style.direction = value.direction;
            grid.style.justifyContent = value.alignment;
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: `rtl-${value.index}`,
                x: value.x,
                y: 45,
              },
              "*",
            );
          },
          { ...testCase, index },
        );
        await page.waitForFunction(
          (expectedLength) =>
            (window as any).__hitTestResults.length === expectedLength,
          index + 1,
        );
        const packet = await page.evaluate(
          (resultIndex) => (window as any).__hitTestResults[resultIndex],
          index,
        );
        expect(
          packet.gridPlacement,
          `${testCase.direction} ${testCase.alignment}`,
        ).toEqual({ column: 2, columnEnd: 3, row: 1, rowEnd: 2 });
      }
    } finally {
      await browser.close();
    }
  });

  it("uses a spanning source item's full grid footprint for placement and preview", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 360, height: 220 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:320px;height:180px;display:grid;grid-template-columns:repeat(4,80px);grid-template-rows:repeat(3,60px)">
          <div data-agent-native-node-id="occupied" style="grid-column:1;grid-row:1"></div>
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
            correlationId: "grid-span",
            x: 120,
            y: 30,
            preview: true,
            sourceGridSpan: { columns: 2, rows: 2 },
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
        gridPlacement: { column: 2, columnEnd: 4, row: 1, rowEnd: 3 },
        guideRect: { left: 80, top: 0, width: 160, height: 120 },
      });
      expect(
        await page
          .locator("[data-agent-native-hit-test-preview]")
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
          }),
      ).toEqual({ left: 80, top: 0, width: 160, height: 120 });
    } finally {
      await browser.close();
    }
  });

  it("falls back to generic insertion when a grid ancestor is transformed", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="transformed-parent" style="position:absolute;left:20px;top:10px;transform:scale(2)">
          <div id="grid" data-agent-native-node-id="grid" style="box-sizing:border-box;width:210px;height:120px;display:grid;grid-template-columns:100px 100px;grid-template-rows:50px 50px">
            <div data-agent-native-node-id="occupied" style="grid-column:1;grid-row:1"></div>
          </div>
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
            correlationId: "transformed-grid",
            x: 220,
            y: 60,
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
      expect(packet.gridPlacement).toBeUndefined();
      expect(packet.guideRect).toBeUndefined();
    } finally {
      await browser.close();
    }
  });
});
