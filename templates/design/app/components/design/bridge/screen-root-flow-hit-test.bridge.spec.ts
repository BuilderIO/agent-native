import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

const SCREEN_ROOT = `<!doctype html><html><body style="margin:0;display:flex;flex-direction:column;gap:20px;width:320px;height:260px">
  <section data-agent-native-node-id="first" style="width:280px;height:100px;flex:none">First</section>
  <section data-agent-native-node-id="second" style="width:280px;height:100px;flex:none">Second</section>
</body></html>`;

type HitTestPacket = {
  anchorNodeId: string;
  placement: string;
  guidePlacement: string;
  axis: string;
  dropMode: string;
  anchorRect: { left: number; top: number; width: number; height: number };
};

async function expectGuideAtSide(
  page: Page,
  packet: HitTestPacket,
  side: "before" | "after",
) {
  expect(packet.guidePlacement).toBe(side);
  const guideRect = await page
    .locator("[data-agent-native-hit-test-preview]")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });

  if (packet.axis === "x") {
    expect(guideRect.left).toBe(
      side === "before"
        ? packet.anchorRect.left
        : packet.anchorRect.left + packet.anchorRect.width,
    );
    expect(guideRect.width).toBe(2);
  } else {
    expect(guideRect.top).toBe(
      side === "before"
        ? packet.anchorRect.top
        : packet.anchorRect.top + packet.anchorRect.height,
    );
    expect(guideRect.height).toBe(2);
  }
}

const REVERSE_FLOW_CASES = [
  {
    name: "row-reverse in LTR",
    flexDirection: "row-reverse",
    direction: "ltr",
    axis: "x",
    gapPoint: { x: 230, y: 50 },
    childPoint: { x: 260, y: 50 },
    placement: "after",
    guidePlacement: "before",
  },
  {
    name: "column-reverse",
    flexDirection: "column-reverse",
    direction: "ltr",
    axis: "y",
    gapPoint: { x: 150, y: 170 },
    childPoint: { x: 150, y: 200 },
    placement: "after",
    guidePlacement: "before",
  },
  {
    name: "row in RTL",
    flexDirection: "row",
    direction: "rtl",
    axis: "x",
    gapPoint: { x: 230, y: 50 },
    childPoint: { x: 260, y: 50 },
    placement: "after",
    guidePlacement: "before",
  },
  {
    name: "row-reverse in RTL",
    flexDirection: "row-reverse",
    direction: "rtl",
    axis: "x",
    gapPoint: { x: 90, y: 50 },
    childPoint: { x: 60, y: 50 },
    placement: "after",
    guidePlacement: "after",
  },
  {
    name: "row in LTR",
    flexDirection: "row",
    direction: "ltr",
    axis: "x",
    gapPoint: { x: 90, y: 50 },
    childPoint: { x: 60, y: 50 },
    placement: "after",
    guidePlacement: "after",
  },
  {
    name: "row in vertical-rl writing mode",
    flexDirection: "row",
    direction: "ltr",
    writingMode: "vertical-rl",
    axis: "y",
    gapPoint: { x: 150, y: 90 },
    childPoint: { x: 150, y: 60 },
    placement: "after",
    guidePlacement: "after",
  },
  {
    name: "row in vertical-lr writing mode",
    flexDirection: "row",
    direction: "ltr",
    writingMode: "vertical-lr",
    axis: "y",
    gapPoint: { x: 150, y: 90 },
    childPoint: { x: 150, y: 60 },
    placement: "after",
    guidePlacement: "after",
  },
  {
    name: "column in vertical-rl writing mode",
    flexDirection: "column",
    direction: "ltr",
    writingMode: "vertical-rl",
    axis: "x",
    gapPoint: { x: 230, y: 50 },
    childPoint: { x: 260, y: 50 },
    placement: "after",
    guidePlacement: "before",
  },
  {
    name: "column in vertical-lr writing mode",
    flexDirection: "column",
    direction: "ltr",
    writingMode: "vertical-lr",
    axis: "x",
    gapPoint: { x: 90, y: 50 },
    childPoint: { x: 60, y: 50 },
    placement: "after",
    guidePlacement: "after",
  },
] as const;

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

  it("falls back from a non-empty horizontal auto-layout frame that is too short", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px">
        <section data-agent-native-node-id="outer" data-an-primitive="frame" style="position:relative;width:420px;height:320px">
          <section data-agent-native-node-id="auto" style="box-sizing:border-box;width:236px;height:64px;padding:12px;display:flex;flex-direction:row;flex-wrap:nowrap;gap:12px">
            <div data-agent-native-node-id="first" style="flex:0 0 100px;width:100px;height:40px"></div>
            <div data-agent-native-node-id="second" style="flex:0 0 100px;width:100px;height:40px"></div>
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
        const first = document.querySelector(
          '[data-agent-native-node-id="first"]',
        )!;
        const rect = first.getBoundingClientRect();
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "cross-axis-auto-frame-fallback",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            sourceElementSize: { width: 100, height: 80 },
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
        correlationId: "cross-axis-auto-frame-fallback",
        anchorNodeId: "outer",
        placement: "inside",
        dropMode: "absolute-container",
      });
    } finally {
      await browser.close();
    }
  });

  it("uses the vertical main-axis size for row drops in vertical writing modes", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:640px;height:480px;position:relative">
        <section data-agent-native-node-id="outer" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:300px;height:300px">
          <section data-agent-native-node-id="vertical-row" data-an-primitive="frame" style="position:relative;width:80px;height:180px;display:flex;flex-direction:row;writing-mode:vertical-rl">
            <section data-agent-native-node-id="middle" data-an-primitive="frame" style="flex:none;width:60px;height:80px;display:flex;flex-direction:column">
              <section data-agent-native-node-id="anchor" style="flex:none;width:40px;height:40px">Anchor</section>
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
        const anchor = document.querySelector(
          '[data-agent-native-node-id="anchor"]',
        )!;
        const rect = anchor.getBoundingClientRect();
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "vertical-row-size-guard",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            preview: true,
            sourceElementSize: { width: 100, height: 120 },
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
        correlationId: "vertical-row-size-guard",
        anchorNodeId: "middle",
        axis: "y",
        dropMode: "flow-insert",
      });
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

  it("uses two-dimensional direct fit and main-axis ancestor fallback sizing", async () => {
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
        anchorNodeId: "column",
        placement: "before",
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

  it.each(REVERSE_FLOW_CASES)(
    "keeps logical placement and physical guide side correct for $name",
    async (flow) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 320, height: 260 },
        });
        const writingMode =
          "writingMode" in flow ? flow.writingMode : "horizontal-tb";
        const isRow = flow.axis === "x";
        const childWidth = isRow ? 80 : 280;
        const childHeight = isRow ? 100 : 80;
        await page.setContent(`<!doctype html><html><body style="margin:0;display:flex;flex-direction:${flow.flexDirection};direction:${flow.direction};writing-mode:${writingMode};gap:20px;width:320px;height:260px">
          <section data-agent-native-node-id="first" style="flex:none;width:${childWidth}px;height:${childHeight}px">First</section>
          <section data-agent-native-node-id="second" style="flex:none;width:${childWidth}px;height:${childHeight}px">Second</section>
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

        const hitTest = async (
          correlationId: string,
          point: { x: number; y: number },
        ) => {
          await page.evaluate(
            ({ correlationId, x, y }) => {
              window.postMessage(
                {
                  type: "agent-native:hit-test",
                  correlationId,
                  x,
                  y,
                  preview: true,
                },
                "*",
              );
            },
            { correlationId, ...point },
          );
          await page.waitForFunction(
            (id) =>
              (window as any).__hitTestResults.some(
                (result: any) => result.correlationId === id,
              ),
            correlationId,
          );
          return (await page.evaluate(
            (id) =>
              (window as any).__hitTestResults.find(
                (result: any) => result.correlationId === id,
              ),
            correlationId,
          )) as HitTestPacket;
        };

        const gapPacket = await hitTest("reverse-flow-gap", flow.gapPoint);
        expect(gapPacket).toMatchObject({
          anchorNodeId: "first",
          placement: flow.placement,
          guidePlacement: flow.guidePlacement,
          axis: flow.axis,
          dropMode: "flow-insert",
        });
        await expectGuideAtSide(page, gapPacket, flow.guidePlacement);

        const childPacket = await hitTest(
          "reverse-flow-child",
          flow.childPoint,
        );
        expect(childPacket).toMatchObject({
          anchorNodeId: "first",
          placement: flow.placement,
          guidePlacement: flow.guidePlacement,
          axis: flow.axis,
          dropMode: "flow-insert",
        });
        await expectGuideAtSide(page, childPacket, flow.guidePlacement);
      } finally {
        await browser.close();
      }
    },
  );
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

  it("declines precise targeting when either grid scroll offset is nonzero", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 240 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:20px;box-sizing:border-box;width:100px;height:100px;display:grid;grid-template-columns:100px 100px 100px;grid-template-rows:100px 100px 100px;overflow:auto">
          <div id="x-probe" style="position:absolute;grid-column:2 / 3;grid-row:1 / 2;inset:0;pointer-events:none"></div>
          <div id="y-probe" style="position:absolute;grid-column:1 / 2;grid-row:2 / 3;inset:0;pointer-events:none"></div>
          <div data-agent-native-node-id="overflow" style="grid-column:3;grid-row:3;width:100px;height:100px"></div>
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
        {
          correlationId: "scrolled-grid-x",
          direction: "ltr",
          scrollLeft: 40,
          scrollTop: 0,
          probe: "#x-probe",
          x: 90,
          y: 30,
        },
        {
          correlationId: "scrolled-grid-y",
          direction: "ltr",
          scrollLeft: 0,
          scrollTop: 40,
          probe: "#y-probe",
          x: 30,
          y: 90,
        },
        {
          correlationId: "scrolled-grid-rtl-x",
          direction: "rtl",
          scrollLeft: -40,
          scrollTop: 0,
          probe: "#x-probe",
          x: 30,
          y: 30,
        },
      ];
      for (const [index, testCase] of cases.entries()) {
        const geometry = await page.evaluate((value) => {
          const grid = document.querySelector<HTMLElement>("#grid")!;
          grid.style.direction = value.direction;
          grid.scrollLeft = value.scrollLeft;
          grid.scrollTop = value.scrollTop;
          const rect = document
            .querySelector<HTMLElement>(value.probe)!
            .getBoundingClientRect();
          window.postMessage(
            {
              type: "agent-native:hit-test",
              correlationId: value.correlationId,
              x: value.x,
              y: value.y,
            },
            "*",
          );
          return {
            scrollLeft: grid.scrollLeft,
            scrollTop: grid.scrollTop,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        }, testCase);
        expect(geometry.scrollLeft).toBe(testCase.scrollLeft);
        expect(geometry.scrollTop).toBe(testCase.scrollTop);
        expect(testCase.x).toBeGreaterThanOrEqual(geometry.left);
        expect(testCase.x).toBeLessThan(geometry.right);
        expect(testCase.y).toBeGreaterThanOrEqual(geometry.top);
        expect(testCase.y).toBeLessThan(geometry.bottom);

        await page.waitForFunction(
          (expectedLength) =>
            (window as any).__hitTestResults.length === expectedLength,
          index + 1,
        );
        const packet = await page.evaluate(
          (resultIndex) => (window as any).__hitTestResults[resultIndex],
          index,
        );
        expect(packet.gridPlacement, testCase.correlationId).toBeUndefined();
        expect(packet.guideRect, testCase.correlationId).toBeUndefined();
      }
    } finally {
      await browser.close();
    }
  });

  it("declines precise targeting when reserved scrollbar space changes client dimensions", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 240 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:40px;top:20px;box-sizing:border-box;width:200px;height:100px;border:4px solid;padding:10px;display:grid;grid-template-columns:80px 80px;grid-template-rows:50px 50px 50px;justify-content:center;align-content:center;overflow:auto">
          <div data-agent-native-node-id="overflow" style="grid-column:2;grid-row:3;width:80px;height:50px"></div>
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
        const grid = document.querySelector<HTMLElement>("#grid")!;
        Object.defineProperty(grid, "clientWidth", {
          configurable: true,
          value: grid.clientWidth - 15,
        });
        Object.defineProperty(grid, "clientHeight", {
          configurable: true,
          value: grid.clientHeight - 15,
        });
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "reserved-scrollbar-space",
            x: 150,
            y: 40,
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

  it("maps overflowing center and end alignment to the rendered grid tracks", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 240 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:40px;top:40px;box-sizing:border-box;width:150px;height:150px;display:grid;grid-template-columns:100px 100px;grid-template-rows:100px 100px;justify-content:center;align-content:center">
          <div id="track-probe" style="position:absolute;grid-column:2 / 3;grid-row:2 / 3;inset:0;pointer-events:none"></div>
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
        {
          justifyContent: "center",
          alignContent: "center",
          x: 120,
          y: 120,
          column: 2,
          row: 2,
          left: 115,
          top: 115,
        },
        {
          justifyContent: "end",
          alignContent: "center",
          x: 100,
          y: 120,
          column: 2,
          row: 2,
          left: 90,
          top: 115,
        },
        {
          justifyContent: "center",
          alignContent: "end",
          x: 120,
          y: 100,
          column: 2,
          row: 2,
          left: 115,
          top: 90,
        },
        {
          justifyContent: "end",
          alignContent: "end",
          x: 100,
          y: 100,
          column: 2,
          row: 2,
          left: 90,
          top: 90,
        },
        {
          justifyContent: "safe center",
          alignContent: "safe center",
          x: 120,
          y: 120,
          column: 1,
          row: 1,
          left: 40,
          top: 40,
        },
      ];
      for (const [index, testCase] of cases.entries()) {
        const actualTrack = await page.evaluate(
          (value) => {
            const grid = document.querySelector<HTMLElement>("#grid")!;
            grid.style.justifyContent = value.justifyContent;
            grid.style.alignContent = value.alignContent;
            const probe = document.querySelector<HTMLElement>("#track-probe")!;
            probe.style.gridColumn = `${value.column} / ${value.column + 1}`;
            probe.style.gridRow = `${value.row} / ${value.row + 1}`;
            const rect = probe.getBoundingClientRect();
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: `overflow-grid-${value.index}`,
                x: value.x,
                y: value.y,
              },
              "*",
            );
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
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
        expect(actualTrack).toEqual({
          left: testCase.left,
          top: testCase.top,
          width: 100,
          height: 100,
        });
        expect(
          packet.gridPlacement,
          `${testCase.justifyContent} / ${testCase.alignContent}`,
        ).toEqual({
          column: testCase.column,
          columnEnd: testCase.column + 1,
          row: testCase.row,
          rowEnd: testCase.row + 1,
        });
        expect(packet.guideRect).toEqual(actualTrack);
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

  it("keeps RTL multi-column span guides positive and on the selected tracks", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 360, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:320px;height:60px;display:grid;direction:rtl;grid-template-columns:repeat(4,80px);grid-template-rows:60px"></div>
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
            correlationId: "rtl-grid-span",
            x: 200,
            y: 30,
            preview: true,
            sourceGridSpan: { columns: 2, rows: 1 },
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
        gridPlacement: { column: 2, columnEnd: 4, row: 1, rowEnd: 2 },
        guideRect: { left: 80, top: 0, width: 160, height: 60 },
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
      ).toEqual({ left: 80, top: 0, width: 160, height: 60 });
    } finally {
      await browser.close();
    }
  });

  it("treats locked grid items as occupied when the pointer is beside them", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="locked" data-agent-native-locked="true" style="grid-column:1;grid-row:1;width:20px;justify-self:start"></div>
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
            correlationId: "locked-grid-cell",
            x: 50,
            y: 30,
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

  it("declines precise targeting for in-flow generated grid items", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #grid::before { content: ""; grid-column: 2; grid-row: 1; width: 80px; height: 80px; }
      </style></head><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="occupied" style="grid-column:1;grid-row:1;width:80px;height:80px"></div>
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
            correlationId: "generated-grid-item",
            x: 120,
            y: 30,
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

  it("treats an underfilled spanning item's full grid area as occupied", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 360, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:320px;height:60px;display:grid;grid-template-columns:repeat(4,80px);grid-template-rows:60px">
          <div data-agent-native-node-id="underfilled" style="grid-column:2 / 4;grid-row:1;width:50px;justify-self:start"></div>
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
            correlationId: "underfilled-grid-area",
            x: 190,
            y: 30,
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

  it("declines precise grid targeting when direct text creates an anonymous item", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">Occupied text</div>
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
            correlationId: "anonymous-grid-item",
            x: 40,
            y: 30,
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

  it("declines precise grid targeting when a child uses display contents", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div style="display:contents"><span data-agent-native-node-id="flattened" style="grid-column:1;grid-row:1;width:20px;height:20px;justify-self:start;align-self:start">Occupied</span></div>
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
            correlationId: "flattened-grid-item",
            x: 40,
            y: 30,
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

  it("does not offer an empty-cell target in whitespace of an underfilled auto-placed item", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:20px;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="auto-underfilled" style="width:20px;height:20px;justify-self:start;align-self:start"></div>
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
            correlationId: "auto-underfilled-whitespace",
            x: 70,
            y: 70,
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
      expect(packet.anchorNodeId).toBe("auto-underfilled");
    } finally {
      await browser.close();
    }
  });

  it("declines an auto-placed cell when a transformed child's painted bounds hide its grid area", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:20px;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="occupied" style="grid-column:1;grid-row:1;width:80px;height:80px"></div>
          <div data-agent-native-node-id="auto-displaced" style="width:20px;height:20px;justify-self:start;align-self:start;transform:translateX(-100px)"></div>
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
      const fixture = await page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>("#grid")!;
        const child = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="auto-displaced"]',
        )!;
        const rect = child.getBoundingClientRect();
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "transformed-auto-placement",
            x: 120,
            y: 30,
          },
          "*",
        );
        return {
          columns: getComputedStyle(grid).gridTemplateColumns,
          start: getComputedStyle(child).gridColumnStart,
          end: getComputedStyle(child).gridColumnEnd,
          paintedLeft: rect.left,
          paintedRight: rect.right,
        };
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults?.length === 1,
      );
      const packet = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );

      expect(fixture.columns).toBe("80px 80px");
      expect(fixture.start).toBe("auto");
      expect(fixture.end).toBe("auto");
      expect(fixture.paintedRight).toBeLessThanOrEqual(20);
      expect(packet.gridPlacement).toBeUndefined();
      expect(packet.guideRect).toBeUndefined();
    } finally {
      await browser.close();
    }
  });

  it("keeps targeting empty cells when sibling placements are explicit", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:20px;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="occupied" style="grid-column:1;grid-row:1;width:80px;height:80px"></div>
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
            correlationId: "explicit-placement-control",
            x: 120,
            y: 30,
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

      expect(packet.gridPlacement).toEqual({
        column: 2,
        columnEnd: 3,
        row: 1,
        rowEnd: 2,
      });
      expect(packet.guideRect).toEqual({
        left: 100,
        top: 20,
        width: 80,
        height: 80,
      });
    } finally {
      await browser.close();
    }
  });

  it("declines precise targeting for underfilled auto-placed spans", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="auto-span" style="grid-column:auto / span 2;grid-row:auto;width:20px;height:20px;justify-self:start;align-self:start"></div>
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
            correlationId: "auto-underfilled-span",
            x: 120,
            y: 30,
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

  it("declines precise targeting for zero-sized auto-placed grid items", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 240, height: 120 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:0;top:0;box-sizing:border-box;width:160px;height:80px;display:grid;grid-template-columns:80px 80px;grid-template-rows:80px">
          <div data-agent-native-node-id="zero-size-auto" style="width:0;height:0;justify-self:start;align-self:start"></div>
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
            correlationId: "zero-size-auto-grid-item",
            x: 40,
            y: 30,
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

  it("does not treat percentage column gaps as pixel values", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 500 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="grid" data-agent-native-node-id="grid" style="position:absolute;left:20px;top:0;box-sizing:border-box;width:250px;height:400px;display:grid;grid-template-columns:repeat(3,50px);grid-template-rows:repeat(3,50px);column-gap:20%;row-gap:20%"></div>
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
            correlationId: "percentage-column-gap",
            x: 195,
            y: 25,
          },
          "*",
        );
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "percentage-row-gap",
            x: 45,
            y: 185,
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
      expect(packets).toHaveLength(2);
      for (const packet of packets) {
        expect(packet.gridPlacement).toBeUndefined();
        expect(packet.guideRect).toBeUndefined();
      }
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
