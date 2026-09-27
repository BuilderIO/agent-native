import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
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
  <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
       style="position:absolute;left:40px;top:40px;width:280px;height:200px;background:#111827">
    <div data-agent-native-node-id="kid-a" data-agent-native-layer-name="Kid A"
         style="position:absolute;left:16px;top:16px;width:110px;height:80px;background:#3b82f6"></div>
  </div>
  <div data-agent-native-node-id="solo-a" data-agent-native-layer-name="Solo A"
       style="position:absolute;left:40px;top:300px;width:120px;height:80px;background:#a855f7"></div>
</body></html>`;

async function marqueeSelectedIds(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: { metaKey?: boolean } = {},
): Promise<string[]> {
  const selected: string[] = [];
  await page.exposeFunction("__pushMarquee", (ids: string[]) => {
    selected.length = 0;
    selected.push(...ids);
  });
  await page.evaluate(() => {
    window.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as {
        type?: string;
        payload?: Array<{ sourceId?: string }>;
      };
      if (data?.type === "agent-native:layer-marquee-selection") {
        (window as any).__pushMarquee(
          (data.payload ?? []).map((p) => p.sourceId ?? ""),
        );
      }
    });
  });
  await page.mouse.move(from.x, from.y);
  if (modifiers.metaKey) await page.keyboard.down("Meta");
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(30);
  await page.mouse.up();
  if (modifiers.metaKey) await page.keyboard.up("Meta");
  await page.waitForTimeout(30);
  return selected;
}

describe("marquee selects at the current container level", () => {
  it("a marquee over Card selects Card only, not Kid A", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const selected = await marqueeSelectedIds(
        page,
        { x: 20, y: 20 },
        { x: 340, y: 260 },
      );

      expect(
        selected,
        "a marquee over Card must select Card, not reach into Kid A",
      ).toEqual(["card"]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("Cmd-held marquee still reaches into nested descendants", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const selected = await marqueeSelectedIds(
        page,
        { x: 300, y: 220 },
        { x: 45, y: 45 },
        { metaKey: true },
      );

      expect(
        selected,
        "Cmd-held marquee must deep-select, including Kid A",
      ).toContain("kid-a");
    } finally {
      await browser.close();
    }
  });

  it("dedupes live hit sets and sends rendered detail for every final item", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const messages: Array<{
        payload: Array<{
          sourceId?: string;
          computedStyles?: Record<string, string>;
          portableStyleSnapshot?: unknown;
        }>;
        intent?: { final?: boolean };
      }> = [];
      await page.exposeFunction("__captureMarquee", (message: unknown) => {
        messages.push(message as (typeof messages)[number]);
      });
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:layer-marquee-selection") {
            (window as any).__captureMarquee(event.data);
          }
        });
      });

      await page.mouse.move(20, 20);
      await page.mouse.down();
      await page.mouse.move(340, 390);
      await page.mouse.move(341, 391);
      await page.mouse.move(342, 392);
      await page.mouse.up();
      await page.waitForTimeout(30);

      expect(messages).toHaveLength(2);
      expect(messages[0]?.intent?.final).toBe(false);
      expect(messages[1]?.intent?.final).toBe(true);
      const finalPayload = messages[1]!.payload;
      expect(finalPayload.map((item) => item.sourceId)).toEqual([
        "card",
        "solo-a",
      ]);
      expect(
        Object.keys(finalPayload[0]?.computedStyles ?? {}),
      ).not.toHaveLength(0);
      expect(finalPayload[0]?.portableStyleSnapshot).toBeDefined();
      expect(
        Object.keys(finalPayload[1]?.computedStyles ?? {}),
      ).not.toHaveLength(0);
      expect(finalPayload[1]?.portableStyleSnapshot).toBeDefined();
    } finally {
      await browser.close();
    }
  });
});
