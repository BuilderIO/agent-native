import { chromium, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { CANVAS_CONTEXT_RECORDER_SCRIPT } from "../../../../shared/visual-layers";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("behind-fixture"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// A decorative WebGL canvas styled the usual way (pointer-events: none) under a
// hero wrapper that owns every pointer hit.
const FIXTURE = `<!doctype html><html><head>${CANVAS_CONTEXT_RECORDER_SCRIPT}</head><body style="margin:0">
  <section data-agent-native-node-id="hero-section" style="position:relative;width:600px;height:400px;overflow:hidden">
    <canvas data-agent-native-node-id="hero-canvas" width="600" height="400" style="position:absolute;inset:0;width:600px;height:400px;pointer-events:none"></canvas>
    <div data-agent-native-node-id="hero" style="position:relative;width:600px;height:400px;display:flex;align-items:center;justify-content:center">
      <h1 data-agent-native-node-id="hero-title" style="margin:0;font:32px sans-serif">Ship faster</h1>
    </div>
  </section>
  <script>
    var gl = document.querySelector("canvas").getContext("webgl");
    gl.clearColor(0.2, 0.4, 0.9, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  </script>
</body></html>`;

type Message = Record<string, any>;

let browser: Awaited<ReturnType<typeof chromium.launch>>;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

async function openFixture(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(FIXTURE);
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
  await page.evaluate(() => {
    (window as any).__messages = [];
    window.addEventListener("message", (event: MessageEvent) => {
      (window as any).__messages.push(event.data);
    });
  });
  return page;
}

async function waitForMessage(page: Page, predicate: string): Promise<Message> {
  await page.waitForFunction(
    `((window).__messages ?? []).some((message) => ${predicate})`,
  );
  return page.evaluate(
    `((window).__messages ?? []).filter((message) => ${predicate}).pop()`,
  ) as Promise<Message>;
}

describe("visual layers behind a pick", () => {
  it("hit testing alone never reaches the pointer-events:none canvas", async () => {
    const page = await openFixture();
    try {
      const hits = await page.evaluate(() =>
        document
          .elementsFromPoint(100, 100)
          .map((el) => el.getAttribute("data-agent-native-node-id")),
      );
      expect(hits).not.toContain("hero-canvas");
    } finally {
      await page.close();
    }
  });

  it("lists the WebGL canvas in the right-click layer stack, below the wrapper", async () => {
    const page = await openFixture();
    try {
      await page.mouse.click(100, 100, { button: "right" });
      const menu = await waitForMessage(
        page,
        'message.type === "element-contextmenu"',
      );
      const ids = menu.layerCandidates.map(
        (candidate: Message) => candidate.info?.sourceId,
      );
      expect(ids).toContain("hero-canvas");
      expect(ids.indexOf("hero-canvas")).toBeGreaterThan(ids.indexOf("hero"));
      expect(ids.indexOf("hero-canvas")).toBeLessThan(
        ids.indexOf("hero-section"),
      );
      const canvas = menu.layerCandidates.find(
        (candidate: Message) => candidate.info?.sourceId === "hero-canvas",
      );
      expect(canvas.kind).toBe("webgl");
    } finally {
      await page.close();
    }
  });

  it("puts the canvas behind a clicked wrapper into its selection's effect candidates", async () => {
    const page = await openFixture();
    try {
      await page.mouse.click(100, 100);
      const selected = await waitForMessage(
        page,
        'message.type === "element-select" && message.payload?.sourceId === "hero"',
      );
      expect(selected.payload.effectCandidates[0]).toMatchObject({
        sourceId: "hero-canvas",
        tagName: "canvas",
        kind: "webgl",
        relation: "behind",
        coverage: 1,
        webgl: true,
        animated: true,
      });
    } finally {
      await page.close();
    }
  });
});

describe("stacking and targets", () => {
  async function openMarkup(markup: string): Promise<Page> {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(
      `<!doctype html><html><head>${CANVAS_CONTEXT_RECORDER_SCRIPT}</head><body style="margin:0">${markup}</body></html>`,
    );
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        (window as any).__messages.push(event.data);
      });
    });
    return page;
  }

  it("right-click targets the content under a pointer-events:none scrim, and lists the scrim as an alternate", async () => {
    const page = await openMarkup(`
      <section data-agent-native-node-id="hero" style="position:relative;width:600px;height:400px">
        <h1 data-agent-native-node-id="title" style="margin:0;font:32px sans-serif">Ship faster</h1>
        <div data-agent-native-node-id="scrim" style="position:absolute;inset:0;z-index:5;pointer-events:none;background:rgba(0,0,0,.3)"></div>
      </section>`);
    try {
      await page.mouse.click(20, 20, { button: "right" });
      const menu = await waitForMessage(
        page,
        'message.type === "element-contextmenu"',
      );
      expect(menu.payload.sourceId).not.toBe("scrim");
      const ids = menu.layerCandidates.map(
        (candidate: Message) => candidate.info?.sourceId,
      );
      expect(ids).toContain("scrim");
      expect(ids.indexOf("scrim")).toBeLessThan(ids.indexOf("title"));
    } finally {
      await page.close();
    }
  });

  it("orders a layer by its outermost stacking context, not its own z-index", async () => {
    const page = await openMarkup(`
      <div style="position:relative;width:300px;height:300px">
        <div data-agent-native-node-id="trap" style="transform:translateZ(0);position:absolute;inset:0">
          <canvas data-agent-native-node-id="deep" width="300" height="300" style="position:absolute;inset:0;z-index:10;pointer-events:none"></canvas>
        </div>
        <div data-agent-native-node-id="sibling" style="position:absolute;inset:0;z-index:1;pointer-events:none;background:rgba(255,0,0,.4)"></div>
      </div>`);
    try {
      await page.mouse.click(20, 20, { button: "right" });
      const menu = await waitForMessage(
        page,
        'message.type === "element-contextmenu"',
      );
      const ids = menu.layerCandidates.map(
        (candidate: Message) => candidate.info?.sourceId,
      );
      expect(ids.indexOf("sibling")).toBeLessThan(ids.indexOf("deep"));
    } finally {
      await page.close();
    }
  });

  it("says so when the layer scan stops before the end of a very large page", async () => {
    const page = await openMarkup(`
      <div data-agent-native-node-id="hero" style="position:relative;width:300px;height:300px"></div>
      ${"<i></i>".repeat(6100)}
      <canvas data-agent-native-node-id="late" width="300" height="300" style="position:absolute;left:0;top:0;pointer-events:none"></canvas>`);
    try {
      await page.mouse.click(20, 20);
      const selected = await waitForMessage(
        page,
        'message.type === "element-select" && message.payload?.sourceId === "hero"',
      );
      expect(selected.payload.effectCandidatesTruncated).toBe(true);
    } finally {
      await page.close();
    }
  });

  it("keeps a native hit as the right-click target when a merged layer reached the same wrapper first", async () => {
    const page = await openMarkup(`
      <div data-agent-native-node-id="group" style="position:relative;width:300px;height:300px">
        <canvas data-agent-native-node-id="fx" width="300" height="300" style="position:absolute;inset:0;z-index:5;pointer-events:none"></canvas>
        <h1 data-agent-native-node-id="title" style="margin:0;font:32px sans-serif">Ship faster</h1>
      </div>`);
    try {
      await page.mouse.click(20, 20, { button: "right" });
      const menu = await waitForMessage(
        page,
        'message.type === "element-contextmenu"',
      );
      expect(menu.payload).not.toBeNull();
      expect(["title", "group"]).toContain(menu.payload.sourceId);
    } finally {
      await page.close();
    }
  });
});
