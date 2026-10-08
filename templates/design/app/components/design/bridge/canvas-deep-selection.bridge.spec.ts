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

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <h1 data-agent-native-node-id="title" style="position:absolute;left:40px;top:24px;width:220px;height:42px;margin:0">Previous title</h1>
  <section data-agent-native-node-id="artwork" style="position:absolute;left:40px;top:104px;width:300px;height:180px;background:#334155">
    <p data-agent-native-node-id="note" style="position:absolute;left:20px;top:24px;width:240px;height:40px;margin:0">Nested note</p>
  </section>
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
});
