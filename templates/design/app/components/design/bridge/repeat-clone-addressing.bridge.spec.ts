import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydrated(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("repeat-clones"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const ROW = '<li data-agent-native-node-id="an-row">';

/** Alpine leaves the template in place and inserts each clone as a sibling. */
const PAGE = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0}
  ul{list-style:none;padding:0;margin:0;width:260px}
  li{height:40px;border:1px solid #ccc;box-sizing:border-box}
</style></head><body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos" data-agent-native-node-id="an-tpl">${ROW}</li></template>
    ${ROW}row one</li>
    ${ROW}row two</li>
    ${ROW}row three</li>
    ${ROW}row four</li>
    <li data-agent-native-node-id="an-static">add a task</li>
  </ul>
</body></html>`;

async function withPage<T>(
  run: (page: import("@playwright/test").Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 480, height: 480 },
    });
    await page.setContent(PAGE);
    await page.addScriptTag({ content: hydrated() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      const seen: unknown[] = [];
      (window as never as { __picks: unknown[] }).__picks = seen;
      window.addEventListener("message", (event) => {
        const data = event.data as { type?: string; payload?: unknown };
        if (data?.type !== "element-select") return;
        const payload = data.payload as {
          selector?: string;
          repeat?: unknown;
        };
        seen.push({ selector: payload?.selector, repeat: payload?.repeat });
      });
    });
    return await run(page);
  } finally {
    await browser.close();
  }
}

/**
 * Waits on the posted selection, not on the overlay: the overlay is already
 * displayed from the previous row, so a display check returns before this
 * click's selection exists.
 */
async function clickRow(
  page: import("@playwright/test").Page,
  position: number,
) {
  const row = page.locator(`ul > li:nth-of-type(${position})`);
  const box = (await row.boundingBox())!;
  const before = await picks(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    (count) =>
      (window as never as { __picks: unknown[] }).__picks.length > count,
    before.length,
  );
  return box;
}

interface Pick {
  selector?: string;
  repeat?: {
    sourceSelector: string;
    instanceCount: number;
    instanceIndex: number;
    xFor: string;
    itemIndex: number;
  };
}

function picks(page: import("@playwright/test").Page): Promise<Pick[]> {
  return page.evaluate(
    () => (window as never as { __picks: Pick[] }).__picks,
  ) as Promise<Pick[]>;
}

async function overlayBox(
  page: import("@playwright/test").Page,
  kind: "selection" | "highlight" = "selection",
) {
  return await page.evaluate((name) => {
    const overlay = document.querySelector<HTMLElement>(
      `[data-agent-native-edit-overlay="${name}"]`,
    )!;
    const rect = overlay.getBoundingClientRect();
    return { top: Math.round(rect.top), height: Math.round(rect.height) };
  }, kind);
}

it(
  "gives each repeated row its own selector",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      for (const clone of [1, 2, 3, 4]) await clickRow(page, clone);
      const seen = await picks(page);
      const found = seen.map((pick) => pick.selector!);

      expect(found).toHaveLength(4);
      expect(new Set(found).size).toBe(4);
      for (const selector of found) {
        expect(
          await page.evaluate(
            (value) => document.querySelectorAll(value).length,
            selector,
          ),
        ).toBe(1);
      }
    });
  },
);

it(
  "resolves a clone's selector back to that same row on a host replay",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      const row = await clickRow(page, 3);
      const [{ selector }] = await picks(page);

      await page.evaluate((value) => {
        window.postMessage({ type: "clear-selection" }, "*");
        window.postMessage({ type: "select-element", selector: value }, "*");
      }, selector!);
      await page.waitForTimeout(120);

      const expected = {
        top: Math.round(row.y),
        height: Math.round(row.height),
      };
      expect(await overlayBox(page)).toEqual(expected);

      await page.evaluate((value) => {
        window.postMessage({ type: "clear-selection" }, "*");
        window.postMessage({ type: "hover-element", selector: value }, "*");
      }, selector!);
      await page.waitForTimeout(120);

      expect(await overlayBox(page, "highlight")).toEqual(expected);
    });
  },
);

it(
  "reports the template body as the write target, and how many rows it feeds",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      await clickRow(page, 3);
      await clickRow(page, 5);
      const [clone, staticRow] = await picks(page);

      expect(clone.repeat).toEqual({
        sourceSelector: '[data-agent-native-node-id="an-row"]',
        instanceCount: 4,
        instanceIndex: 3,
        xFor: "t in todos",
        itemIndex: 2,
      });
      expect(staticRow.repeat).toBeUndefined();
    });
  },
);

function instanceOutlines(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-agent-native-edit-overlay="repeat-instance"]',
      ),
    ]
      .filter((overlay) => window.getComputedStyle(overlay).display !== "none")
      .map((overlay) => Math.round(overlay.getBoundingClientRect().top)),
  );
}

it(
  "outlines the repeat's other rows so the linked set is visible",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      const row = await clickRow(page, 2);
      const outlines = await instanceOutlines(page);

      // Four clones: the three that were not clicked get an outline.
      expect(outlines).toHaveLength(3);
      expect(outlines).not.toContain(Math.round(row.y));
    });
  },
);

it("leaves an ordinary row unoutlined", { timeout: 60_000 }, async () => {
  await withPage(async (page) => {
    await clickRow(page, 5);
    expect(await instanceOutlines(page)).toEqual([]);
  });
});

it(
  "previews a style on every row the save will reach, not just the clicked one",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      await clickRow(page, 2);
      const [{ selector }] = await picks(page);

      await page.evaluate((value) => {
        window.postMessage(
          {
            type: "style-change",
            selector: value,
            property: "backgroundColor",
            value: "rgb(1, 2, 3)",
          },
          "*",
        );
      }, selector!);
      await page.waitForTimeout(120);

      const painted = await page.evaluate(() =>
        [...document.querySelectorAll("ul > li")].map(
          (row) => (row as HTMLElement).style.backgroundColor,
        ),
      );

      // Four clones take the preview; the static sibling is not part of it.
      expect(painted.slice(0, 4)).toEqual([
        "rgb(1, 2, 3)",
        "rgb(1, 2, 3)",
        "rgb(1, 2, 3)",
        "rgb(1, 2, 3)",
      ]);
      expect(painted[4]).toBe("");
    });
  },
);

it(
  "drops the linked-row outlines when the selection is cleared",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      await clickRow(page, 2);
      expect(await instanceOutlines(page)).toHaveLength(3);

      await page.evaluate(() => {
        window.postMessage({ type: "clear-selection" }, "*");
      });
      await page.waitForTimeout(120);

      expect(await instanceOutlines(page)).toEqual([]);
    });
  },
);
