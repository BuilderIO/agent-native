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

// Alpine's live shape, written out so no runtime is needed: the template stays
// as a marker and each rendered row is a direct sibling. Static siblings carry
// stamped ids because every persisted screen is annotated; clones never can.
const PAGE = `<!doctype html><html><head><style>
  body{margin:0} ul{list-style:none;padding:0;margin:0}
  li{height:40px;border:1px solid #ccc}
</style></head><body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos"></template>
    <li>clone one</li>
    <li>clone two</li>
    <li data-agent-native-node-id="an-static" class="static-row">static row</li>
  </ul>
  <div data-agent-native-node-id="an-after" class="after">after</div>
</body></html>`;

async function selectAndRead(selectors: string[]): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    await page.setContent(PAGE);
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
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(180);
    }
    return await page.evaluate(
      () => (window as unknown as { __sel: string[] }).__sel,
    );
  } finally {
    await browser.close();
  }
}

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

    // Empty sourceId: borrowing the stamped <ul>'s anchor produced a selector
    // that resolved onto the static row and reported the write as applied.
    expect(clone.split("|")[0]).toBe("");
    expect(clone).toContain("unsupported");
  },
);
