import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("endpoint-runtime"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const INITIAL_HTML = `<!doctype html><html><body><svg data-agent-native-node-id="line.1" data-an-primitive="line" viewBox="0 0 100 40"><line x1="0" y1="0" x2="100" y2="40" stroke="black" stroke-width="3" /></svg></body></html>`;
const PERSISTED_HTML = `<!doctype html><html><body><svg data-agent-native-node-id="line.1" data-an-primitive="line" viewBox="0 0 100 40" style="--an-vector-start-point:triangle;--an-vector-end-point:circle"><line x1="0" y1="0" x2="100" y2="40" stroke="black" stroke-width="3" /></svg></body></html>`;

async function sendStyleChange(
  page: import("@playwright/test").Page,
  property: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ({ property, value }) => {
      window.postMessage(
        {
          type: "style-change",
          selector: '[data-agent-native-node-id="line.1"]',
          selectorCandidates: [],
          nodeId: "line.1",
          property,
          value,
        },
        "*",
      );
    },
    { property, value },
  );
}

async function replaceDocumentContent(
  page: import("@playwright/test").Page,
  content: string,
): Promise<void> {
  await page.evaluate((nextContent) => {
    window.postMessage(
      {
        type: "replace-document-content",
        content: nextContent,
        selectedSelector: "",
        selectorCandidates: [],
        forceFullDocument: true,
      },
      "*",
    );
  }, content);
}

async function readHydratedMarkers(
  page: import("@playwright/test").Page,
): Promise<{
  startReference: string | null;
  endReference: string | null;
  startStyle: string;
  endStyle: string;
  startOrient: string | null;
  startRefX: string | null;
}> {
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-agent-native-node-id="line.1"] line')
        ?.getAttribute("marker-start") ===
      "url(#line-1.006c0069006e0065002e0031-vector-marker-start)",
  );
  return page.evaluate(() => {
    const svg = document.querySelector<SVGElement>(
      '[data-agent-native-node-id="line.1"]',
    );
    const line = svg?.querySelector("line");
    const startMarker = svg?.querySelector(
      '[data-an-vector-endpoint-marker="start"]',
    );
    return {
      startReference: line?.getAttribute("marker-start") ?? null,
      endReference: line?.getAttribute("marker-end") ?? null,
      startStyle: svg?.style.getPropertyValue("--an-vector-start-point") ?? "",
      endStyle: svg?.style.getPropertyValue("--an-vector-end-point") ?? "",
      startOrient: startMarker?.getAttribute("orient") ?? null,
      startRefX: startMarker?.getAttribute("refX") ?? null,
    };
  });
}

describe("live vector endpoint style changes", () => {
  it("hydrates persisted endpoint styles on startup and after a document reload", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(PERSISTED_HTML);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      expect(await readHydratedMarkers(page)).toEqual({
        startReference:
          "url(#line-1.006c0069006e0065002e0031-vector-marker-start)",
        endReference: "url(#line-1.006c0069006e0065002e0031-vector-marker-end)",
        startStyle: "triangle",
        endStyle: "circle",
        startOrient: "auto-start-reverse",
        startRefX: "8",
      });

      await replaceDocumentContent(page, PERSISTED_HTML);
      expect(await readHydratedMarkers(page)).toEqual({
        startReference:
          "url(#line-1.006c0069006e0065002e0031-vector-marker-start)",
        endReference: "url(#line-1.006c0069006e0065002e0031-vector-marker-end)",
        startStyle: "triangle",
        endStyle: "circle",
        startOrient: "auto-start-reverse",
        startRefX: "8",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("updates marker DOM for start and end edits and removes only the cleared side", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(INITIAL_HTML);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await sendStyleChange(page, "--an-vector-start-point", "triangle");
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-agent-native-node-id="line.1"] line')
            ?.getAttribute("marker-start") ===
          "url(#line-1.006c0069006e0065002e0031-vector-marker-start)",
      );
      await sendStyleChange(page, "--an-vector-end-point", "circle");
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-agent-native-node-id="line.1"] line')
            ?.getAttribute("marker-end") ===
          "url(#line-1.006c0069006e0065002e0031-vector-marker-end)",
      );

      const rendered = await page.evaluate(() => {
        const svg = document.querySelector<SVGElement>(
          '[data-agent-native-node-id="line.1"]',
        );
        const line = svg?.querySelector("line");
        return {
          startStyle: svg?.style.getPropertyValue("--an-vector-start-point"),
          endStyle: svg?.style.getPropertyValue("--an-vector-end-point"),
          startOrient: svg
            ?.querySelector('[data-an-vector-endpoint-marker="start"]')
            ?.getAttribute("orient"),
          startRefX: svg
            ?.querySelector('[data-an-vector-endpoint-marker="start"]')
            ?.getAttribute("refX"),
          endRefX: svg
            ?.querySelector('[data-an-vector-endpoint-marker="end"]')
            ?.getAttribute("refX"),
          endShape: svg
            ?.querySelector('[data-an-vector-endpoint-marker="end"] > circle')
            ?.tagName.toLowerCase(),
          startReference: line?.getAttribute("marker-start"),
          endReference: line?.getAttribute("marker-end"),
        };
      });
      expect(rendered).toEqual({
        startStyle: "triangle",
        endStyle: "circle",
        startOrient: "auto-start-reverse",
        startRefX: "8",
        endRefX: "8",
        endShape: "circle",
        startReference:
          "url(#line-1.006c0069006e0065002e0031-vector-marker-start)",
        endReference: "url(#line-1.006c0069006e0065002e0031-vector-marker-end)",
      });

      await sendStyleChange(page, "--an-vector-start-point", "none");
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-agent-native-node-id="line.1"] line')
            ?.hasAttribute("marker-start"),
      );
      expect(
        await page.evaluate(() => ({
          startMarker: document.querySelector(
            '[data-agent-native-node-id="line.1"] [data-an-vector-endpoint-marker="start"]',
          ),
          endReference: document
            .querySelector('[data-agent-native-node-id="line.1"] line')
            ?.getAttribute("marker-end"),
          startStyle: document
            .querySelector<SVGElement>('[data-agent-native-node-id="line.1"]')
            ?.style.getPropertyValue("--an-vector-start-point"),
        })),
      ).toEqual({
        startMarker: null,
        endReference: "url(#line-1.006c0069006e0065002e0031-vector-marker-end)",
        startStyle: "none",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
