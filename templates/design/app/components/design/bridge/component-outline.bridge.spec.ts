import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydrated(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("component-outline"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const COMPONENT = "rgb(139, 92, 246)";
const ACCENT = "rgb(59, 130, 246)";

const PAGE = `<!doctype html><html><head><style>
  :root{--design-editor-component-color:${COMPONENT};--design-editor-component-strong-color:rgb(109,40,217);--design-editor-component-contrast-color:rgb(255,255,255);--design-editor-accent-color:${ACCENT};--design-editor-accent-strong-color:rgb(29,78,216);--design-editor-accent-contrast-color:rgb(255,255,255)}
  html,body{margin:0;padding:40px}
  button{border-radius:12px;padding:10px 16px;font:14px sans-serif}
</style></head><body>
  <button data-agent-native-component="Button" data-agent-native-node-id="an-btn">Primary</button>
</body></html>`;

async function selectionChrome(selector: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 640, height: 320 },
    });
    await page.setContent(PAGE);
    await page.addScriptTag({ content: hydrated() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

    const box = (await page.locator(selector).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => {
      const overlay = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="selection"]',
      );
      return overlay && window.getComputedStyle(overlay).display === "block";
    });

    return await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="selection"]',
      )!;
      const style = window.getComputedStyle(overlay);
      const pill = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="component-tag"]',
      );
      return {
        pill:
          pill && window.getComputedStyle(pill).display !== "none"
            ? pill.textContent
            : null,
        borderColor: style.borderTopColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
  } finally {
    await browser.close();
  }
}

it(
  "marks a component root with one violet stroke, not a doubled outline",
  { timeout: 30_000 },
  async () => {
    const chrome = await selectionChrome("button");

    expect(chrome.pill).toBe("Button →");
    expect(chrome.borderColor).toBe(COMPONENT);
    expect(
      chrome.outlineStyle === "none" || chrome.outlineWidth === "0px",
    ).toBe(true);
  },
);
