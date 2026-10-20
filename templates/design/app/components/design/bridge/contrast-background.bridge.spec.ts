import { chromium, type Page } from "@playwright/test";
import {
  readPaintLayers,
  resolveTextBackground,
} from "@shared/text-background";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

const SCREEN_ID = "contrast-test";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(SCREEN_ID))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const TEXT = '[data-agent-native-node-id="text"]';

function html(body: string, bodyStyle = "background: rgb(255, 255, 255)") {
  return `<!doctype html><html><head></head><body data-agent-native-node-id="an-body" style="${bodyStyle}">${body}</body></html>`;
}

async function mount(page: Page, content: string) {
  await page.setContent(content);
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
}

/** Posts the request to the page itself, as the editor does to an iframe. */
async function measure(
  page: Page,
  request: { screenId?: string; selector: string },
  waitMs = 300,
): Promise<{ answered: boolean; payload: unknown; screenId?: string }> {
  return page.evaluate(
    ({ request, waitMs }) =>
      new Promise((resolve) => {
        const correlationId = "probe-1";
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", listener);
          resolve({ answered: false, payload: null });
        }, waitMs);
        const listener = (event: MessageEvent) => {
          if (
            event.data?.type !== "agent-native:contrast-background-measured" ||
            event.data.correlationId !== correlationId
          ) {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener("message", listener);
          resolve({
            answered: true,
            payload: event.data.payload,
            screenId: event.data.screenId,
          });
        };
        window.addEventListener("message", listener);
        window.postMessage(
          {
            type: "agent-native:measure-contrast-background",
            correlationId,
            ...request,
          },
          "*",
        );
      }),
    { request, waitMs },
  );
}

describe("the canvas bridge reports the paint behind a text layer", () => {
  it("lists the element and each ancestor, nearest first, with computed paint", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await mount(
        page,
        html(
          `<section style="background: rgb(17, 24, 39)"><p data-agent-native-node-id="text" style="color: white">Hello</p></section>`,
        ),
      );
      const reply = await measure(page, {
        screenId: SCREEN_ID,
        selector: TEXT,
      });
      expect(reply.answered).toBe(true);
      expect(reply.screenId).toBe(SCREEN_ID);
      const layers = readPaintLayers(reply.payload);
      expect(layers).not.toBeNull();
      expect(layers!.map((layer) => layer.backgroundColor).slice(0, 3)).toEqual(
        ["rgba(0, 0, 0, 0)", "rgb(17, 24, 39)", "rgb(255, 255, 255)"],
      );
      expect(layers!.length).toBeGreaterThanOrEqual(4);
      expect(resolveTextBackground(layers!)).toEqual({
        kind: "ready",
        color: { r: 17, g: 24, b: 39 },
      });
    } finally {
      await browser.close();
    }
  });

  it("reports a gradient behind the text so the editor can say there is no flat color", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await mount(
        page,
        html(
          `<section style="background-image: linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))"><p data-agent-native-node-id="text">Hello</p></section>`,
        ),
      );
      const reply = await measure(page, {
        screenId: SCREEN_ID,
        selector: TEXT,
      });
      expect(resolveTextBackground(readPaintLayers(reply.payload)!)).toEqual({
        kind: "unavailable",
        reason: "image",
      });
    } finally {
      await browser.close();
    }
  });

  it("reports no opaque background for a page that paints none", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await mount(
        page,
        html(`<p data-agent-native-node-id="text">Hello</p>`, ""),
      );
      const reply = await measure(page, {
        screenId: SCREEN_ID,
        selector: TEXT,
      });
      expect(resolveTextBackground(readPaintLayers(reply.payload)!)).toEqual({
        kind: "unavailable",
        reason: "no-opaque-background",
      });
    } finally {
      await browser.close();
    }
  });

  it("answers with no layers when the element is gone", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await mount(page, html(`<p>Hello</p>`));
      const reply = await measure(page, {
        screenId: SCREEN_ID,
        selector: '[data-agent-native-node-id="missing"]',
      });
      expect(reply.answered).toBe(true);
      expect(reply.payload).toBeNull();
      expect(readPaintLayers(reply.payload)).toBeNull();
    } finally {
      await browser.close();
    }
  });

  it("stays silent for another screen's request", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await mount(page, html(`<p data-agent-native-node-id="text">Hello</p>`));
      const reply = await measure(page, {
        screenId: "some-other-screen",
        selector: TEXT,
      });
      expect(reply.answered).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
