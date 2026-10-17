import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

type BridgeMessage = {
  type?: string;
  payload?: { sourceId?: string } | Array<{ sourceId?: string }>;
  intent?: {
    additive?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
};

function hydratedBridge(
  boardSurface = false,
  textEditingEnabled = false,
  readOnly = false,
): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", String(readOnly))
    .replace("__TEXT_EDITING_ENABLED__", String(textEditingEnabled))
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", String(boardSurface))
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <h1 data-agent-native-node-id="title" style="position:absolute;left:40px;top:24px;width:220px;height:42px;margin:0">Previous title</h1>
  <section data-agent-native-node-id="artwork" style="position:absolute;left:40px;top:104px;width:300px;height:180px;background:#334155">
    <p data-agent-native-node-id="note" style="position:absolute;left:20px;top:24px;width:240px;height:40px;margin:0">Nested note</p>
  </section>
</body></html>`;

const NESTED_SELECTION_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="wrapper" style="position:absolute;left:40px;top:40px;width:320px;height:260px;background:#111827">
    <div data-agent-native-node-id="card" style="position:absolute;left:20px;top:20px;width:280px;height:220px;background:#1f2937">
      <div data-agent-native-node-id="kid" style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3b82f6"></div>
    </div>
  </div>
</body></html>`;

const DRILLED_SELECTION_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="outer" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:320px;height:260px;background:#111827">
    <div data-agent-native-node-id="middle" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:280px;height:220px;background:#1f2937">
      <div data-agent-native-node-id="inner" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:180px;height:140px;background:#374151">
        <div data-agent-native-node-id="leaf" style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3b82f6"></div>
      </div>
    </div>
  </div>
</body></html>`;

const OVERLAPPING_SELECTION_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="first" style="position:absolute;left:40px;top:40px;width:240px;height:200px;background:#111827"></div>
  <div data-agent-native-node-id="middle" style="position:absolute;left:40px;top:40px;width:240px;height:200px;background:#1f2937"></div>
  <div data-agent-native-node-id="last" style="position:absolute;left:40px;top:40px;width:240px;height:200px;background:#3b82f6"></div>
</body></html>`;

function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

async function selectionMessages(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => ((window as any).__bridgeMessages ?? []) as BridgeMessage[],
  );
}

async function passiveOverlayCount(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      document.querySelectorAll(
        "[data-agent-native-edit-overlay='multi-selection']:not([data-agent-native-multi-selection-bounds])",
      ).length,
  );
}

async function messageCount(
  page: import("@playwright/test").Page,
  type: string,
) {
  const messages = await selectionMessages(page);
  return messages.filter((message) => message.type === type).length;
}

async function lastSelectedSourceId(page: import("@playwright/test").Page) {
  const selection = last(
    (await selectionMessages(page)).filter(
      (message) => message.type === "element-select",
    ),
  );
  return selection?.payload && !Array.isArray(selection.payload)
    ? selection.payload.sourceId
    : undefined;
}

async function waitForMessageAfter(
  page: import("@playwright/test").Page,
  type: string,
  previousCount: number,
) {
  await page.waitForFunction(
    ({ messageType, count }) => {
      const messages = ((window as any).__bridgeMessages ??
        []) as BridgeMessage[];
      return (
        messages.filter((message) => message.type === messageType).length >
        count
      );
    },
    { messageType: type, count: previousCount },
  );
}

describe("canvas deep selection modifiers", () => {
  it("modifier-clicks the child when the selected container is not the topmost hit", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(NESTED_SELECTION_FIXTURE);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
      });
      await page.addStyleTag({
        content:
          "body{position:relative;z-index:2147483647;width:100vw;height:100vh}",
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );

      let elementSelectCount = await messageCount(page, "element-select");
      await page.mouse.click(250, 220);
      await waitForMessageAfter(page, "element-select", elementSelectCount);
      expect(await lastSelectedSourceId(page)).toBe("card");

      elementSelectCount = await messageCount(page, "element-select");
      await page.keyboard.down("Meta");
      await page.mouse.click(130, 120);
      await page.keyboard.up("Meta");
      await waitForMessageAfter(page, "element-select", elementSelectCount);

      expect(await lastSelectedSourceId(page)).toBe("kid");
    } finally {
      await browser.close();
    }
  });

  it("continues same-point modifier cycling from a nested child through its ancestors", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(DRILLED_SELECTION_FIXTURE);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
      });
      await page.addStyleTag({
        content:
          "body{position:relative;z-index:2147483647;width:100vw;height:100vh}",
      });
      await page.addScriptTag({ content: hydratedBridge(true, true) });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );
      await page.evaluate(() => {
        const selector = '[data-agent-native-node-id="outer"]';
        window.postMessage(
          { type: "select-element", selector, selectorCandidates: [selector] },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "element-select" &&
            !Array.isArray(message.payload) &&
            message.payload?.sourceId === "outer",
        ),
      );

      for (const expected of ["leaf", "inner", "middle", "outer"]) {
        const elementSelectCount = await messageCount(page, "element-select");
        await page.keyboard.down("Meta");
        await page.mouse.click(130, 120);
        await page.keyboard.up("Meta");
        await waitForMessageAfter(page, "element-select", elementSelectCount);
        expect(await lastSelectedSourceId(page)).toBe(expected);
      }
    } finally {
      await browser.close();
    }
  });

  it("cycles through overlapping siblings after the topmost selection", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(OVERLAPPING_SELECTION_FIXTURE);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );

      let elementSelectCount = await messageCount(page, "element-select");
      await page.mouse.click(100, 100);
      await waitForMessageAfter(page, "element-select", elementSelectCount);
      expect(await lastSelectedSourceId(page)).toBe("last");

      for (const expected of ["middle", "first"]) {
        elementSelectCount = await messageCount(page, "element-select");
        await page.keyboard.down("Meta");
        await page.mouse.click(100, 100);
        await page.keyboard.up("Meta");
        await waitForMessageAfter(page, "element-select", elementSelectCount);
        expect(await lastSelectedSourceId(page)).toBe(expected);
      }
    } finally {
      await browser.close();
    }
  });

  it("Cmd/Ctrl deep-select replaces; Shift+Cmd adds then toggles through an authoritative survivor packet", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        (window as any).__appClicks = 0;
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
        document.body.addEventListener("click", () => {
          (window as any).__appClicks += 1;
        });
      });
      await page.addStyleTag({
        content:
          "body{position:relative;z-index:2147483647;width:100vw;height:100vh}",
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );

      let elementSelectCount = await messageCount(page, "element-select");
      await page.mouse.click(150, 40);
      await waitForMessageAfter(page, "element-select", elementSelectCount);
      expect(await page.evaluate(() => (window as any).__appClicks)).toBe(0);
      elementSelectCount = await messageCount(page, "element-select");
      await page.keyboard.down("Meta");
      await page.mouse.click(160, 148);
      await page.keyboard.up("Meta");
      await waitForMessageAfter(page, "element-select", elementSelectCount);

      let messages = await selectionMessages(page);
      let deepClick = last(
        messages.filter((message) => message.type === "element-select"),
      );
      expect(
        deepClick?.payload && !Array.isArray(deepClick.payload)
          ? deepClick.payload.sourceId
          : undefined,
      ).toBe("note");
      expect(deepClick?.intent).toMatchObject({
        additive: false,
        metaKey: true,
        shiftKey: false,
      });
      expect(await passiveOverlayCount(page)).toBe(0);

      elementSelectCount = await messageCount(page, "element-select");
      await page.mouse.click(150, 40);
      await waitForMessageAfter(page, "element-select", elementSelectCount);
      elementSelectCount = await messageCount(page, "element-select");
      await page.keyboard.down("Shift");
      await page.keyboard.down("Meta");
      await page.mouse.click(160, 148);
      await page.keyboard.up("Meta");
      await page.keyboard.up("Shift");
      await waitForMessageAfter(page, "element-select", elementSelectCount);
      messages = await selectionMessages(page);
      const added = last(
        messages.filter((message) => message.type === "element-select"),
      );
      expect(
        added?.payload && !Array.isArray(added.payload)
          ? added.payload.sourceId
          : undefined,
      ).toBe("note");
      expect(added?.intent).toMatchObject({
        additive: true,
        metaKey: true,
        shiftKey: true,
      });
      expect(await passiveOverlayCount(page)).toBe(1);

      const toggleCount = await messageCount(
        page,
        "agent-native:layer-marquee-selection",
      );
      await page.keyboard.down("Shift");
      await page.keyboard.down("Meta");
      await page.mouse.click(160, 148);
      await page.keyboard.up("Meta");
      await page.keyboard.up("Shift");
      await waitForMessageAfter(
        page,
        "agent-native:layer-marquee-selection",
        toggleCount,
      );
      messages = await selectionMessages(page);
      const toggle = last(
        messages.filter(
          (message) => message.type === "agent-native:layer-marquee-selection",
        ),
      );
      const survivors = Array.isArray(toggle?.payload)
        ? toggle.payload.map((item) => item.sourceId)
        : [];
      expect(survivors).toEqual(["title"]);
      expect(toggle?.intent).toMatchObject({
        additive: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(await passiveOverlayCount(page)).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it("does not treat a new hit target at the same point as a repeated click", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
             style="position:absolute;left:40px;top:40px;width:160px;height:120px;background:#1f2937"></div>
      </body></html>`);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );

      let elementSelectCount = await messageCount(page, "element-select");
      await page.mouse.click(100, 80);
      await waitForMessageAfter(page, "element-select", elementSelectCount);
      expect(await lastSelectedSourceId(page)).toBe("card");
      elementSelectCount = await messageCount(page, "element-select");

      await page.evaluate(() => {
        const child = document.createElement("div");
        child.setAttribute("data-agent-native-node-id", "kid");
        child.setAttribute("data-agent-native-layer-name", "Kid");
        child.style.cssText = "position:absolute;inset:0;background:#3b82f6";
        document
          .querySelector('[data-agent-native-node-id="card"]')!
          .append(child);
      });
      await page.mouse.click(100, 80);
      await waitForMessageAfter(page, "element-select", elementSelectCount);

      expect(await lastSelectedSourceId(page)).toBe("card");
    } finally {
      await browser.close();
    }
  });

  it.each(["Meta", "Control"] as const)(
    "%s-click cycles from a selected child to its containing layer",
    async (modifier) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(FIXTURE);
        await page.evaluate(() => {
          (window as any).__bridgeMessages = [];
          window.addEventListener("message", (event: MessageEvent) => {
            if (event.source === window)
              (window as any).__bridgeMessages.push(event.data);
          });
        });
        await page.addScriptTag({ content: hydratedBridge() });
        await page.waitForFunction(() =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: BridgeMessage) =>
              message.type === "agent-native:editor-chrome-ready",
          ),
        );

        let elementSelectCount = await messageCount(page, "element-select");
        await page.mouse.click(150, 148);
        await waitForMessageAfter(page, "element-select", elementSelectCount);
        expect(await lastSelectedSourceId(page)).toBe("note");
        elementSelectCount = await messageCount(page, "element-select");

        await page.keyboard.down(modifier);
        await page.mouse.click(150, 148);
        await page.keyboard.up(modifier);
        await waitForMessageAfter(page, "element-select", elementSelectCount);

        expect(await lastSelectedSourceId(page)).toBe("artwork");
      } finally {
        await browser.close();
      }
    },
  );

  it("keeps a repeated mouse click on the selected layer while drilling", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(DRILLED_SELECTION_FIXTURE);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
      });
      await page.addStyleTag({
        content:
          "body{position:relative;z-index:2147483647;width:100vw;height:100vh}",
      });
      await page.addScriptTag({ content: hydratedBridge(true, true) });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );

      await page.evaluate(() => {
        const selector = '[data-agent-native-node-id="outer"]';
        window.postMessage(
          { type: "select-element", selector, selectorCandidates: [selector] },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "element-select" &&
            !Array.isArray(message.payload) &&
            message.payload?.sourceId === "outer",
        ),
      );

      await page
        .locator('[data-agent-native-node-id="leaf"]')
        .dispatchEvent("dblclick", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
          detail: 2,
        });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "element-select" &&
            !Array.isArray(message.payload) &&
            message.payload?.sourceId === "middle",
        ),
      );
      await page.evaluate(() => {
        window.postMessage(
          { type: "set-text-editing-enabled", enabled: false },
          "*",
        );
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.mouse.dblclick(100, 100);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "element-select" &&
            !Array.isArray(message.payload) &&
            message.payload?.sourceId === "inner",
        ),
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(await lastSelectedSourceId(page)).toBe("inner");
    } finally {
      await browser.close();
    }
  });

  it("does not let a read-only double-click descend selection", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(NESTED_SELECTION_FIXTURE);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source === window)
            (window as any).__bridgeMessages.push(event.data);
        });
      });
      await page.addScriptTag({ content: hydratedBridge(false, false, true) });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "agent-native:editor-chrome-ready",
        ),
      );
      await page.evaluate(() => {
        const selector = '[data-agent-native-node-id="wrapper"]';
        window.postMessage(
          { type: "select-element", selector, selectorCandidates: [selector] },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: BridgeMessage) =>
            message.type === "element-select" &&
            !Array.isArray(message.payload) &&
            message.payload?.sourceId === "wrapper",
        ),
      );
      const selectCount = await messageCount(page, "element-select");

      await page
        .locator('[data-agent-native-node-id="kid"]')
        .dispatchEvent("dblclick", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
          detail: 2,
        });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );

      expect(await messageCount(page, "element-select")).toBe(selectCount);
      expect(await lastSelectedSourceId(page)).toBe("wrapper");
    } finally {
      await browser.close();
    }
  });
});
