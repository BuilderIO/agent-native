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
          <section data-agent-native-node-id="middle" data-agent-native-primitive="frame" style="position:relative;flex:0 0 260px;width:260px;height:260px">
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
