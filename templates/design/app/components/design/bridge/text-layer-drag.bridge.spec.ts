import { chromium, type Page } from "@playwright/test";
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

const RUNS_FIXTURE = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
  <main data-agent-native-node-id="stack"
        style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px;width:800px">
    <div data-agent-native-node-id="wrapper"
         style="display:flex;flex-direction:column;width:100%;max-width:500px">
      <h1 data-agent-native-node-id="title" style="margin:0;font-size:40px;text-align:center"><strong data-agent-native-node-id="title-run">Agents into outcomes</strong></h1>
    </div>
    <h2 data-agent-native-node-id="rich" style="margin:0;font-size:32px">Ship <b data-agent-native-node-id="accent" style="color:#6366f1">faster</b> today</h2>
    <p data-agent-native-node-id="below" style="margin:0">Below</p>
  </main>
</body></html>`;

const TEXT_STACK_FIXTURE = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
  <main data-agent-native-node-id="hero"
        style="display:flex;flex-direction:column;align-items:center;gap:24px;padding:48px">
    <div data-agent-native-node-id="variant"
         style="display:flex;flex-direction:column;align-items:center;gap:16px;width:100%">
      <h1 data-agent-native-node-id="variant-title" style="margin:0;font-size:40px;max-width:400px;text-align:center">Launch faster</h1>
      <p data-agent-native-node-id="variant-copy" style="margin:0">Everything in one place.</p>
      <p data-agent-native-node-id="variant-cta" style="margin:0">Start free</p>
    </div>
    <div data-agent-native-node-id="other" style="width:300px;height:80px;background:#ddd"></div>
  </main>
</body></html>`;

async function openFixture(page: Page, html: string) {
  await page.setContent(html);
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
  await page.evaluate(() => {
    (window as any).__selectedIds = [];
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "element-select") {
        (window as any).__selectedIds.push(event.data.payload?.sourceId);
      }
    });
  });
}

const lastSelectedId = (page: Page) =>
  page.evaluate(() => (window as any).__selectedIds.at(-1) ?? null);

const boxOf = async (page: Page, nodeId: string) => {
  const box = await page
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`no box for ${nodeId}`);
  return box;
};

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

const parentId = (page: Page, nodeId: string) =>
  page.evaluate(
    (id) =>
      document
        .querySelector(`[data-agent-native-node-id="${id}"]`)
        ?.parentElement?.getAttribute("data-agent-native-node-id") ?? null,
    nodeId,
  );

async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(await browser.newPage({ viewport: { width: 900, height: 600 } }));
  } finally {
    await browser.close();
  }
}

describe("dragging an inline text run on the canvas", () => {
  async function clickThenDragRight(page: Page, nodeId: string, dx: number) {
    const box = await boxOf(page, nodeId);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(400);
    const selectedBeforeDrag = await lastSelectedId(page);
    await drag(page, center, { x: center.x + dx, y: center.y });
    return selectedBeforeDrag;
  }

  it("moves the heading a whole-text run fills, and keeps the run inside it", async () => {
    await withPage(async (page) => {
      await openFixture(page, RUNS_FIXTURE);

      const selectedBeforeDrag = await clickThenDragRight(
        page,
        "title-run",
        300,
      );

      expect(selectedBeforeDrag).toBe("title-run");
      expect(await parentId(page, "title-run")).toBe("title");
      expect(await parentId(page, "title")).toBe("stack");
      expect(await lastSelectedId(page)).toBe("title");
    });
  });

  it("keeps a partial run inside its heading when the drag leaves the heading", async () => {
    await withPage(async (page) => {
      await openFixture(page, RUNS_FIXTURE);

      const selectedBeforeDrag = await clickThenDragRight(page, "accent", 300);

      expect(selectedBeforeDrag).toBe("accent");
      expect(await parentId(page, "accent")).toBe("rich");
      expect(
        await page
          .locator('[data-agent-native-node-id="rich"]')
          .evaluate((el) => el.textContent),
      ).toBe("Ship faster today");
      expect(await lastSelectedId(page)).toBe("rich");
    });
  });
});

describe("dragging inside a stack of text blocks", () => {
  it("reorders inside the stack while the pointer stays over it", async () => {
    await withPage(async (page) => {
      await openFixture(page, TEXT_STACK_FIXTURE);
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="variant-title"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      const title = await boxOf(page, "variant-title");
      const copy = await boxOf(page, "variant-copy");

      await drag(
        page,
        { x: title.x + title.width / 2, y: title.y + 8 },
        { x: title.x + title.width + 60, y: copy.y + copy.height },
      );

      const order = await page.evaluate(() =>
        [
          ...document.querySelector('[data-agent-native-node-id="variant"]')!
            .children,
        ].map((el) => el.getAttribute("data-agent-native-node-id")),
      );
      expect(order).toEqual(["variant-copy", "variant-title", "variant-cta"]);
    });
  });
});
