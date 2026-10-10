import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("hidden-selection"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const RESPONSIVE_HERO = `<!doctype html><html><head><style>
  body { margin: 0 }
  .hidden { display: none }
  .flex { display: flex }
  @media (min-width: 768px) { .md\\:flex { display: flex } .md\\:hidden { display: none } }
</style></head><body>
  <section style="padding: 40px">
    <div id="desktop" class="hidden md:flex" style="height: 200px; gap: 16px">
      <h1 id="desktop-title" style="margin: 0; width: 300px">Desktop hero</h1>
    </div>
    <div id="mobile" class="flex md:hidden" style="flex-direction: column; height: 160px">
      <h1 id="mobile-title" style="margin: 0; width: 200px; height: 40px">Mobile hero</h1>
      <p id="mobile-copy" style="margin: 60px 0 0 30px; width: 120px; height: 20px">Copy</p>
    </div>
  </section>
</body></html>`;

type Box = {
  display: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

async function openResponsiveHero(page: Page) {
  await page.setContent(RESPONSIVE_HERO);
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
}

async function select(page: Page, selector: string) {
  await page.evaluate((value) => {
    window.postMessage(
      { type: "select-element", selector: value, selectorCandidates: [value] },
      "*",
    );
  }, selector);
  await page.waitForTimeout(50);
}

const SELECTION = '[data-agent-native-edit-overlay="selection"]';
const MULTI_SELECTION_BOUNDS = "[data-agent-native-multi-selection-bounds]";

function overlayBox(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).evaluate((element) => {
    const style = (element as HTMLElement).style;
    return {
      display: style.display,
      left: parseFloat(style.left),
      top: parseFloat(style.top),
      width: parseFloat(style.width),
      height: parseFloat(style.height),
    };
  });
}

function elementBox(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
}

describe("selection of a node the frame does not render", () => {
  it("draws no box at a width that hides the node, and draws it once a wider frame shows it", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 800 },
      });
      await openResponsiveHero(page);

      await select(page, "#desktop");
      expect(await overlayBox(page, SELECTION)).toMatchObject({
        display: "none",
      });

      await page.setViewportSize({ width: 1024, height: 800 });
      const shown = await elementBox(page, "#desktop");
      expect(shown.width).toBeGreaterThan(0);
      await expect
        .poll(() => overlayBox(page, SELECTION))
        .toEqual({ display: "block", ...shown });
    } finally {
      await browser.close();
    }
  });

  it("draws the box once an edit makes the selected node render at this width", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 800 },
      });
      await openResponsiveHero(page);

      await select(page, "#desktop");
      expect(await overlayBox(page, SELECTION)).toMatchObject({
        display: "none",
      });

      await page
        .locator("#desktop")
        .evaluate((element) => element.classList.replace("hidden", "flex"));
      const shown = await elementBox(page, "#desktop");
      expect(shown.width).toBeGreaterThan(0);
      await expect
        .poll(() => overlayBox(page, SELECTION))
        .toEqual({ display: "block", ...shown });
    } finally {
      await browser.close();
    }
  });

  it("draws no box for a child whose ancestor is hidden at this width", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 800 },
      });
      await openResponsiveHero(page);

      await select(page, "#mobile-title");
      expect(await overlayBox(page, SELECTION)).toEqual({
        display: "block",
        ...(await elementBox(page, "#mobile-title")),
      });

      await select(page, "#desktop-title");
      expect(await overlayBox(page, SELECTION)).toMatchObject({
        display: "none",
      });
    } finally {
      await browser.close();
    }
  });

  it("bounds a multi-selection by the members this width renders", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 800 },
      });
      await openResponsiveHero(page);

      await select(page, "#mobile-title");
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-elements",
            selectorGroups: [["#desktop"], ["#mobile-copy"]],
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      const title = await elementBox(page, "#mobile-title");
      const copy = await elementBox(page, "#mobile-copy");
      expect(await overlayBox(page, MULTI_SELECTION_BOUNDS)).toEqual({
        display: "block",
        left: title.left,
        top: title.top,
        width:
          Math.max(title.left + title.width, copy.left + copy.width) -
          title.left,
        height: copy.top + copy.height - title.top,
      });
    } finally {
      await browser.close();
    }
  });
});
