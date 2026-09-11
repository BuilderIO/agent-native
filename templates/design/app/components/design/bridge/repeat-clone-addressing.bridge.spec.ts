import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydrated(textEditing = false): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", String(textEditing))
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
    <template x-for="t in todos" data-agent-native-node-id="an-tpl">${ROW}<span data-agent-native-node-id="an-label" x-text="t"></span></li></template>
    ${ROW}<span data-agent-native-node-id="an-label" x-text="t">row one</span></li>
    ${ROW}<span data-agent-native-node-id="an-label" x-text="t">row two</span></li>
    ${ROW}<span data-agent-native-node-id="an-label" x-text="t">row three</span></li>
    ${ROW}<span data-agent-native-node-id="an-label" x-text="t">row four</span></li>
    <li data-agent-native-node-id="an-static">add a task</li>
  </ul>
</body></html>`;

async function withPage<T>(
  run: (page: import("@playwright/test").Page) => Promise<T>,
  options: { textEditing?: boolean } = {},
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 480, height: 480 },
    });
    await page.setContent(PAGE);
    await page.addScriptTag({ content: hydrated(options.textEditing) });
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
    textBinding: string;
    keyExpression: string;
    itemKey: string;
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
        textBinding: "",
        keyExpression: "",
        itemKey: "",
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

it(
  "does not paint another row of the same repeat as a second selection",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      const row = await clickRow(page, 4);

      // What the host replays every poll tick: one group per selected layer,
      // whose selector matches every row of the repeat.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-elements",
            selectorGroups: [['[data-agent-native-node-id="an-row"]']],
          },
          "*",
        );
      });
      await page.waitForTimeout(120);

      const chrome = await page.evaluate(() => {
        const shown = (name: string) =>
          [
            ...document.querySelectorAll<HTMLElement>(
              `[data-agent-native-edit-overlay="${name}"]`,
            ),
          ].filter(
            (overlay) => window.getComputedStyle(overlay).display !== "none",
          );
        const selection = shown("selection")[0]!;
        return {
          passive: shown("multi-selection").length,
          selectionTop: Math.round(selection.getBoundingClientRect().top),
          selectionHeight: Math.round(selection.getBoundingClientRect().height),
        };
      });

      expect(chrome.passive).toBe(0);
      expect(chrome.selectionTop).toBe(Math.round(row.y));
      expect(chrome.selectionHeight).toBe(Math.round(row.height));
    });
  },
);

it(
  "recognises an element inside a repeated row, not just the row itself",
  { timeout: 60_000 },
  async () => {
    await withPage(async (page) => {
      // Editing text means selecting the span, whose id is a copy of the
      // template body's — so an own id proves nothing about authorship here.
      const label = page.locator("ul > li:nth-of-type(2) span");
      const box = (await label.boundingBox())!;
      const before = await picks(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        (count) =>
          (window as never as { __picks: unknown[] }).__picks.length > count,
        before.length,
      );

      const [pick] = (await picks(page)).slice(-1);
      expect(pick!.repeat?.xFor).toBe("t in todos");
      expect(pick!.repeat?.itemIndex).toBe(1);
    });
  },
);

it(
  "lets a data-bound repeated row be text-edited instead of refusing",
  { timeout: 60_000 },
  async () => {
    await withPage(
      async (page) => {
        const label = page.locator("ul > li:nth-of-type(2) span");
        const box = (await label.boundingBox())!;
        await page.mouse.dblclick(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        await page.waitForTimeout(200);

        const state = await page.evaluate(() => {
          const badge = document.querySelector<HTMLElement>(
            "[data-agent-native-transform-badge]",
          );
          return {
            refused:
              badge && window.getComputedStyle(badge).display !== "none"
                ? badge.textContent
                : null,
            editing: Boolean(
              document.querySelector("[data-agent-native-text-editing]"),
            ),
          };
        });

        expect(state.refused).toBeNull();
        expect(state.editing).toBe(true);
      },
      { textEditing: true },
    );
  },
);

/** A generated screen with no stamped ids anywhere — the common case. */
const UNSTAMPED = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0}
  ul{list-style:none;padding:0;margin:0;width:260px}
  li{height:40px;border:1px solid #ccc;box-sizing:border-box}
</style></head><body>
  <ul>
    <template x-for="task in filteredTasks" :key="task.id"><li><span x-text="task.text"></span></li></template>
    <li><span x-text="task.text">one</span></li>
    <li><span x-text="task.text">two</span></li>
    <li><span x-text="task.text">three</span></li>
  </ul>
</body></html>`;

it(
  "reports a repeat that carries no stamped ids at all",
  { timeout: 60_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 480, height: 320 },
      });
      await page.setContent(UNSTAMPED);
      await page.addScriptTag({ content: hydrated() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as never as { __picked: unknown }).__picked = null;
        window.addEventListener("message", (event) => {
          const data = event.data as { type?: string; payload?: unknown };
          if (data?.type === "element-select") {
            (window as never as { __picked: unknown }).__picked = data.payload;
          }
        });
      });

      const row = page.locator("ul > li:nth-of-type(2)");
      const box = (await row.boundingBox())!;
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
      await page.waitForFunction(
        () => (window as never as { __picked: unknown }).__picked !== null,
      );

      const repeat = await page.evaluate(
        () =>
          (
            window as never as {
              __picked: { repeat?: Record<string, unknown> };
            }
          ).__picked.repeat,
      );

      expect(repeat).toMatchObject({
        sourceSelector: "",
        instanceCount: 3,
        itemIndex: 1,
        xFor: "task in filteredTasks",
        keyExpression: "task.id",
      });
    } finally {
      await browser.close();
    }
  },
);

it(
  "reads a row's key out of Alpine's Map-based lookup",
  { timeout: 60_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 480, height: 320 },
      });
      await page.setContent(UNSTAMPED);
      // Alpine 3.15 stores _x_lookup as a Map; a for..in over it sees nothing.
      await page.evaluate(() => {
        const template = document.querySelector("template")!;
        const rows = [...template.parentElement!.children].filter(
          (el) => el.tagName === "LI",
        );
        (template as never as { _x_lookup: Map<unknown, Element> })._x_lookup =
          new Map(rows.map((row, index) => [index + 1, row]));
      });
      await page.addScriptTag({ content: hydrated() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as never as { __picked: unknown }).__picked = null;
        window.addEventListener("message", (event) => {
          const data = event.data as { type?: string; payload?: unknown };
          if (data?.type === "element-select") {
            (window as never as { __picked: unknown }).__picked = data.payload;
          }
        });
      });

      const row = page.locator("ul > li:nth-of-type(2)");
      const box = (await row.boundingBox())!;
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
      await page.waitForFunction(
        () => (window as never as { __picked: unknown }).__picked !== null,
      );

      expect(
        await page.evaluate(
          () =>
            (
              window as never as {
                __picked: { repeat?: { itemKey?: string } };
              }
            ).__picked.repeat?.itemKey,
        ),
      ).toBe("2");
    } finally {
      await browser.close();
    }
  },
);
