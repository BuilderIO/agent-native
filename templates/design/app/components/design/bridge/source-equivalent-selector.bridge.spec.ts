import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydrated(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("srcsel"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const PAGE = `<!doctype html><html><head><style>
  body{margin:0} ul{list-style:none;padding:0;margin:0}
  li{height:40px;border:1px solid #ccc}
</style></head><body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos"><li></li></template>
    <li>clone one</li>
    <li>clone two</li>
    <li data-agent-native-node-id="an-static" class="static-row">static row</li>
    <li id="123" class="digit-id-row">numeric authored id</li>
  </ul>
  <div data-agent-native-node-id="an-after" class="after">after</div>
</body></html>`;

async function selectAndRead(
  selectors: string[],
  options: { disableCssEscape?: boolean; omitAlpineLookup?: boolean } = {},
): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    await page.setContent(PAGE);
    if (options.disableCssEscape) {
      await page.evaluate(() => {
        Object.defineProperty(window.CSS, "escape", {
          configurable: true,
          value: undefined,
        });
      });
    }
    if (!options.omitAlpineLookup) {
      await page.evaluate(() => {
        const template =
          document.querySelector<HTMLTemplateElement>("template[x-for]")!;
        const rows = Array.from(
          document.querySelectorAll(
            "ul > li:not([data-agent-native-node-id]):not(.digit-id-row)",
          ),
        );
        (
          template as HTMLTemplateElement & { _x_lookup: Map<number, Element> }
        )._x_lookup = new Map(rows.map((row, index) => [index, row]));
      });
    }
    await page.addScriptTag({ content: hydrated() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as unknown as { __sel: string[] }).__sel = [];
      window.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: string; payload?: unknown };
        if (data?.type !== "element-select") return;
        const payload = data.payload as {
          sourceId?: string;
          editCapabilities?: { kind?: string }[];
        };
        (window as unknown as { __sel: string[] }).__sel.push(
          `${payload?.sourceId ?? ""}|${(payload?.editCapabilities ?? [])
            .map((capability) => capability.kind)
            .join(",")}`,
        );
      });
    });
    for (const selector of selectors) {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`no box for ${selector}`);
      const before = await page.evaluate(
        () => (window as unknown as { __sel: string[] }).__sel.length,
      );
      await page.evaluate((sel) => {
        window.postMessage({ type: "select-element", selector: sel }, "*");
      }, selector);
      await page.waitForFunction(
        (count) =>
          (window as unknown as { __sel: string[] }).__sel.length > count,
        before,
      );
    }
    return await page.evaluate(
      () => (window as unknown as { __sel: string[] }).__sel,
    );
  } finally {
    await browser.close();
  }
}

it(
  "keeps static siblings editable before Alpine creates its lookup",
  { timeout: 120_000 },
  async () => {
    const [row = ""] = await selectAndRead([".static-row"], {
      omitAlpineLookup: true,
    });

    expect(row).toContain("an-static");
    expect(row).toContain("deterministic-style-edit");
    expect(row).not.toContain("unsupported");
  },
);

it(
  "a stamped element beside x-for clones stays fully editable",
  { timeout: 120_000 },
  async () => {
    const [row = ""] = await selectAndRead([".static-row"]);

    expect(row).toContain("an-static");
    expect(row).toContain("deterministic-style-edit");
    expect(row).not.toContain("unsupported");
  },
);

it(
  "an x-for clone offers no source target and declares itself unsupported",
  { timeout: 120_000 },
  async () => {
    const [clone = ""] = await selectAndRead(["li:nth-of-type(2)"]);

    expect(clone.split("|")[0]).toBe("");
    expect(clone).toContain("unsupported");
  },
);

it(
  "keeps a numeric authored id unique when CSS.escape is unavailable",
  { timeout: 120_000 },
  async () => {
    const [row = ""] = await selectAndRead([".digit-id-row"], {
      disableCssEscape: true,
    });

    expect(row).toContain("123");
    expect(row).toContain("deterministic-style-edit");
    expect(row).not.toContain("unsupported");
  },
);
