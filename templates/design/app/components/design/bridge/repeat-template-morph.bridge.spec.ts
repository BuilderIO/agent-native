import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydrated(head: string): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("repeat-morph"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, JSON.stringify(head));
}

const HEAD = "<style>li{height:32px}</style>";
const BODY_ROW = '<li data-agent-native-node-id="an-row">';

/** Alpine keeps the template in place and inserts each clone as a sibling. */
const LIVE = `<!doctype html><html><head>${HEAD}</head><body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos" data-agent-native-node-id="an-tpl">${BODY_ROW}<span x-text="t"></span></li></template>
    <li data-agent-native-node-id="an-static">Add a task</li>
  </ul>
</body></html>`;

/** Alpine inserts each clone directly after the template, with no whitespace
 *  between them, and does it before the bridge initialises. */
const TODOS = [
  "Fix login redirect bug",
  "Write onboarding tests",
  "Polish empty states",
];

/** What the editor persists after styling one repeated row: the template body
 *  carries the declaration, and no clone exists in source at all. */
const NEXT_SOURCE = `<!doctype html><html><head>${HEAD}</head><body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos" data-agent-native-node-id="an-tpl"><li data-agent-native-node-id="an-row" style="background-color: rgb(1, 2, 3);"><span x-text="t"></span></li></template>
    <li data-agent-native-node-id="an-static">Add a task</li>
  </ul>
</body></html>`;

async function applyRepeatStyleEdit() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 480, height: 400 },
    });
    await page.setContent(LIVE);
    await page.evaluate((todos) => {
      const template = document.querySelector("template")!;
      let at: Node = template;
      for (const text of todos) {
        const row = (
          template as HTMLTemplateElement
        ).content.firstElementChild!.cloneNode(true) as HTMLElement;
        row.querySelector("span")!.textContent = text;
        at.parentNode!.insertBefore(row, at.nextSibling);
        at = row;
      }
    }, TODOS);
    await page.addScriptTag({ content: hydrated(HEAD) });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

    await page.evaluate((content) => {
      window.postMessage(
        {
          type: "replace-document-content",
          content,
          selectedSelector: '[data-agent-native-node-id="an-row"]',
          selectorCandidates: ['[data-agent-native-node-id="an-row"]'],
        },
        "*",
      );
    }, NEXT_SOURCE);
    await page.waitForTimeout(200);

    return await page.evaluate(() => {
      const list = document.querySelector("ul")!;
      const rows = [...list.children].filter((child) => child.tagName === "LI");
      const template = list.querySelector("template");
      const body = template
        ? (template as HTMLTemplateElement).content.querySelector("li")
        : null;
      return {
        rowTexts: rows.map((row) => row.textContent!.trim()),
        templateSurvived: Boolean(template),
        templateBodyStyle: body?.getAttribute("style") ?? null,
      };
    });
  } finally {
    await browser.close();
  }
}

it(
  "styling a repeated row keeps every row instead of deleting one",
  { timeout: 30_000 },
  async () => {
    const after = await applyRepeatStyleEdit();

    expect(after.rowTexts).toEqual([
      "Fix login redirect bug",
      "Write onboarding tests",
      "Polish empty states",
      "Add a task",
    ]);
    expect(after.templateSurvived).toBe(true);
    expect(after.templateBodyStyle).toContain("rgb(1, 2, 3)");
  },
);
