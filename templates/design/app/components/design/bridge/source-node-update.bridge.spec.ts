import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("source-node-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, () => JSON.stringify(""));
}

const card = (id: string, attrs: string, label: string) =>
  `<article data-agent-native-node-id="${id}"${attrs}><h3>${label}</h3></article>`;

const documentHtml = (body: string) =>
  `<!doctype html><html><head><style>.card{padding:4px}</style></head><body data-agent-native-node-id="an-body"><main data-agent-native-node-id="an-main">${body}</main></body></html>`;

const provenance = { versionHash: "7:abc", uniqueNodeIds: ["a", "b"] };

async function post(page: Page, message: Record<string, unknown>) {
  await page.evaluate((data) => window.postMessage(data, "*"), message);
  await page.waitForTimeout(50);
}

async function withBridgedPage(
  body: string,
  run: (page: Page, rejections: () => Promise<number>) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent(documentHtml(body));
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.evaluate(() => {
      const store = window as Window & { __rejections?: number };
      store.__rejections = 0;
      window.addEventListener("message", (event) => {
        if (event.data?.type === "replace-source-node-rejected") {
          store.__rejections! += 1;
        }
      });
      document
        .querySelectorAll("[data-agent-native-node-id]")
        .forEach((element) => {
          (element as HTMLElement & { __identity?: string }).__identity =
            element.getAttribute("data-agent-native-node-id") ?? "";
        });
    });
    await run(page, () =>
      page.evaluate(
        () => (window as Window & { __rejections?: number }).__rejections ?? 0,
      ),
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}

const liveCard = (page: Page, id: string) =>
  page.evaluate((nodeId) => {
    const element = document.querySelector(
      `[data-agent-native-node-id="${nodeId}"]`,
    ) as (HTMLElement & { __identity?: string }) | null;
    return element
      ? {
          identity: element.__identity,
          style: element.getAttribute("style"),
          text: element.textContent,
        }
      : null;
  }, id);

describe("replace-source-node", () => {
  it(
    "re-syncs one subtree in place and publishes the document provenance",
    { timeout: 30_000 },
    async () => {
      const body =
        card("a", "", "Alpha") + card("b", ' style="color: red"', "Beta");
      await withBridgedPage(body, async (page, rejections) => {
        await post(page, {
          type: "replace-document-content",
          content: documentHtml(body),
          selectedSelector: "",
          selectorCandidates: [],
          forceFullDocument: true,
        });
        await post(page, {
          type: "replace-source-node",
          nodeId: "b",
          html: card("b", ' style="color: blue"', "Bravo"),
          sourceProvenance: provenance,
        });

        expect(await rejections()).toBe(0);
        expect(await liveCard(page, "b")).toEqual({
          identity: "b",
          style: expect.stringMatching(/^color: blue;?$/),
          text: "Bravo",
        });
        expect(await liveCard(page, "a")).toMatchObject({ identity: "a" });
        expect(
          await page.evaluate(
            () =>
              (window as Window & { __agentNativeSourceProvenance?: unknown })
                .__agentNativeSourceProvenance,
          ),
        ).toEqual(provenance);

        await post(page, {
          type: "replace-document-content",
          content: documentHtml(
            card("a", "", "Alpha") + card("b", "", "Bravo"),
          ),
          selectedSelector: "",
          selectorCandidates: [],
          forceFullDocument: true,
        });
        expect((await liveCard(page, "b"))?.style).toBeNull();
      });
    },
  );

  it(
    "asks for the full document when it cannot apply the subtree",
    { timeout: 30_000 },
    async () => {
      const body = card("a", "", "Alpha");
      await withBridgedPage(body, async (page, rejections) => {
        const update = {
          type: "replace-source-node",
          nodeId: "a",
          html: card("a", ' style="color: blue"', "Alpha"),
          sourceProvenance: provenance,
        };
        await post(page, update);
        expect(await rejections()).toBe(1);

        await post(page, {
          type: "replace-document-content",
          content: documentHtml(body),
          selectedSelector: "",
          selectorCandidates: [],
          forceFullDocument: true,
        });
        await post(page, { ...update, nodeId: "missing" });
        await post(page, {
          ...update,
          html: card("b", "", "Other") + "<p></p>",
        });
        expect(await rejections()).toBe(3);
        expect((await liveCard(page, "a"))?.style).toBeNull();
      });
    },
  );
});
