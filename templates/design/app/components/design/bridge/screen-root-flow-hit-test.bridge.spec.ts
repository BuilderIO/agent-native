import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

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
        const isRow = flow.axis === "x";
        const childWidth = isRow ? 80 : 280;
        const childHeight = isRow ? 100 : 80;
        await page.setContent(`<!doctype html><html><body style="margin:0;display:flex;flex-direction:${flow.flexDirection};direction:${flow.direction};gap:20px;width:320px;height:260px">
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
