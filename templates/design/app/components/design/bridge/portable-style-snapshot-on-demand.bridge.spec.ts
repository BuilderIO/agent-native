import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const SCREEN = `<!doctype html><html><body style="margin:0">
  <section data-agent-native-node-id="card" style="position:absolute;left:20px;top:20px;width:200px;height:120px;background:rgb(17, 24, 39)">
    <div data-agent-native-node-id="title" style="position:absolute;left:10px;top:10px;width:100px;height:20px;color:rgb(255, 0, 0)">Title</div>
    <div data-agent-native-node-id="body" style="position:absolute;left:10px;top:40px;width:100px;height:40px;background:rgb(59, 130, 246)"></div>
  </section>
</body></html>`;

type SelectPayload = {
  sourceId?: string;
  styleSnapshotReadOnDemand?: boolean;
  portableStyleSnapshot?: { nodes: Array<{ styles: Record<string, string> }> };
};

async function openScreen(page: Page, sandbox?: string) {
  await page.setContent(
    `<iframe data-design-preview-iframe ${sandbox ? `sandbox="${sandbox}"` : ""} style="width:400px;height:300px;border:0"></iframe>`,
  );
  await page.evaluate(() => {
    (window as any).__selections = [];
    window.addEventListener("message", (event) => {
      if (event.data?.type === "element-select") {
        (window as any).__selections.push(event.data.payload);
      }
    });
  });
  await page.evaluate((source) => {
    document.querySelector<HTMLIFrameElement>("iframe")!.srcdoc = source;
  }, SCREEN);
  const frame = await (await page
    .locator("iframe")
    .elementHandle())!.contentFrame();
  if (!frame) throw new Error("screen iframe did not attach");
  await frame.waitForSelector('[data-agent-native-node-id="card"]');
  await frame.addScriptTag({ content: hydratedBridge() });
  await page.waitForTimeout(50);
}

async function selectCard(page: Page): Promise<SelectPayload> {
  await page.mouse.click(200, 120);
  await page.waitForFunction(() => (window as any).__selections.length > 0);
  return page.evaluate(() => (window as any).__selections.at(-1));
}

describe("portable style snapshots in a frame the editor can call into", () => {
  it("leaves the snapshot out of a selection and captures it on request", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await openScreen(page);

      const selected = await selectCard(page);
      expect(selected.sourceId).toBe("card");
      expect(selected.portableStyleSnapshot).toBeUndefined();
      expect(selected.styleSnapshotReadOnDemand).toBe(true);

      const reads = await page.evaluate(() => {
        const bridge = (document.querySelector("iframe")!.contentWindow as any)
          .__anEditorChromeBridgeInstance;
        return {
          captured: bridge.collectPortableStyleSnapshot(
            "live-screen",
            '[data-agent-native-node-id="card"]',
            1,
          ),
          otherScreen: bridge.collectPortableStyleSnapshot(
            "other-screen",
            '[data-agent-native-node-id="card"]',
            1,
          ),
          missing: bridge.collectPortableStyleSnapshot(
            "live-screen",
            '[data-agent-native-node-id="gone"]',
            1,
          ),
          unreadable: bridge.collectPortableStyleSnapshot(
            "live-screen",
            "[data-agent-native-node-id=]",
            1,
          ),
        };
      });
      expect(reads.captured.status).toBe("captured");
      expect(reads.captured.snapshot.rootSourceId).toBe("card");
      expect(reads.captured.snapshot.nodes).toHaveLength(3);
      expect(reads.captured.snapshot.nodes[0].styles.backgroundColor).toBe(
        "rgb(17, 24, 39)",
      );
      expect(reads.otherScreen).toBeNull();
      expect(reads.missing).toEqual({ status: "missing" });
      expect(reads.unreadable).toEqual({ status: "failed" });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("reads the subtree's painted colors as hex on request", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await openScreen(page);

      const reads = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!.contentWindow as any;
        frame.document.querySelector(
          '[data-agent-native-node-id="title"]',
        ).style.color = "oklch(0.21 0.034 264.665)";
        const bridge = frame.__anEditorChromeBridgeInstance;
        return {
          card: bridge.collectSubtreeColorStyles(
            "live-screen",
            '[data-agent-native-node-id="card"]',
            1,
          ),
          unreadable: bridge.collectSubtreeColorStyles(
            "live-screen",
            "[data-agent-native-node-id=]",
            1,
          ),
          otherScreen: bridge.collectSubtreeColorStyles(
            "other-screen",
            '[data-agent-native-node-id="card"]',
            1,
          ),
        };
      });
      expect(reads.card.status).toBe("captured");
      expect(reads.card.nodes).toEqual([
        { "background-color": "rgb(17, 24, 39)" },
        {
          color: expect.stringMatching(/^#[0-9a-f]{6}ff$/),
          "background-color": "rgba(0, 0, 0, 0)",
        },
        { "background-color": "rgb(59, 130, 246)" },
      ]);
      expect(reads.unreadable).toEqual({ status: "failed" });
      expect(reads.otherScreen).toBeNull();
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("returns the colors of the first nodes past the node cap, marked truncated", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await openScreen(page);

      const read = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!.contentWindow as any;
        const body = frame.document.querySelector(
          '[data-agent-native-node-id="body"]',
        );
        body.innerHTML = "<span></span>".repeat(5000);
        return frame.__anEditorChromeBridgeInstance.collectSubtreeColorStyles(
          "live-screen",
          '[data-agent-native-node-id="card"]',
          1,
        );
      });
      expect(read.status).toBe("truncated");
      expect(read.nodes).toHaveLength(5000);
      expect(read.nodes[0]).toEqual({ "background-color": "rgb(17, 24, 39)" });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("leaves a color-like token the canvas rejects as it was instead of reading a stale color", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await openScreen(page);

      const read = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!.contentWindow as any;
        const title = frame.document.querySelector(
          '[data-agent-native-node-id="title"]',
        );
        title.style.color = "oklch(0.21 0.034 264.665)";
        title.style.backgroundImage =
          'url("https://example.test/color(1).png")';
        return frame.__anEditorChromeBridgeInstance.collectSubtreeColorStyles(
          "live-screen",
          '[data-agent-native-node-id="title"]',
          1,
        );
      });
      expect(read.status).toBe("captured");
      expect(read.nodes[0]["background-image"]).toBe(
        'url("https://example.test/color(1).png")',
      );
      expect(read.nodes[0].color).toMatch(/^#[0-9a-f]{6}ff$/);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("reads the repeated instance a selection names, not the first with its id", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<iframe data-design-preview-iframe style="width:400px;height:300px;border:0"></iframe>',
      );
      await page.evaluate(() => {
        (window as any).__selections = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            (window as any).__selections.push(event.data.payload);
          }
        });
        document.querySelector<HTMLIFrameElement>("iframe")!.srcdoc =
          '<!doctype html><html><body style="margin:0"><ul data-agent-native-node-id="list" style="margin:0;padding:0;list-style:none">' +
          '<template x-for="item in items"><li data-agent-native-node-id="row"></li></template>' +
          '<li data-agent-native-node-id="row" style="height:40px;color:rgb(0, 0, 0)">One</li>' +
          '<li data-agent-native-node-id="row" style="height:40px;color:rgb(0, 0, 0)">Two</li>' +
          '<li data-agent-native-node-id="row" style="height:40px;color:rgb(220, 38, 38)">Three</li>' +
          "</ul></body></html>";
      });
      const frame = await (await page
        .locator("iframe")
        .elementHandle())!.contentFrame();
      if (!frame) throw new Error("screen iframe did not attach");
      await frame.waitForSelector("li:nth-of-type(3)");
      await frame.evaluate(() => {
        const template = document.querySelector("template")!;
        const rows = [...document.querySelectorAll("li")];
        (template as any)._x_lookup = new Map(
          rows.map((row, index) => [index, row]),
        );
      });
      await frame.addScriptTag({ content: hydratedBridge() });
      await page.waitForTimeout(50);

      await page.mouse.click(40, 100);
      await page.waitForFunction(() => (window as any).__selections.length > 0);
      const read = await page.evaluate(() => {
        const selected = (window as any).__selections.at(-1);
        const bridge = (document.querySelector("iframe")!.contentWindow as any)
          .__anEditorChromeBridgeInstance;
        return {
          repeat: selected.repeat,
          snapshot: bridge.collectPortableStyleSnapshot(
            "live-screen",
            selected.repeat.sourceSelector,
            selected.repeat.instanceIndex,
          ),
        };
      });

      expect(read.repeat).toMatchObject({
        sourceSelector: '[data-agent-native-node-id="row"]',
        instanceIndex: 3,
      });
      expect(read.snapshot.status).toBe("captured");
      expect(read.snapshot.snapshot.nodes[0].styles.color).toBe(
        "rgb(220, 38, 38)",
      );
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("still ships the snapshot with a selection from a frame the editor cannot call into", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await openScreen(page, "allow-scripts");

      const selected = await selectCard(page);
      expect(selected.sourceId).toBe("card");
      expect(selected.portableStyleSnapshot?.nodes).toHaveLength(3);
      expect(selected.styleSnapshotReadOnDemand).toBeUndefined();
    } finally {
      await browser.close();
    }
  }, 30_000);
});
