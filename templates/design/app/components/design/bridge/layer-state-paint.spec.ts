import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("layer-state-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

const content = `<!doctype html><html><head><style>#plain{background-color:rgb(1, 2, 3)}</style></head><body style="margin:0">
  <div id="locked" style="width:120px;height:60px;background:tomato"></div>
  <div id="plain" style="width:120px;height:60px;background:steelblue"></div>
  <div id="gone" style="width:120px;height:60px;background:seagreen"></div>
</body></html>`;

describe("editor chrome layer-state paint", () => {
  it(
    "removes an inline override when a style change restores an empty value",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(content);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "style-change",
              selector: "#plain",
              property: "backgroundColor",
              value: "tomato",
            },
            "*",
          );
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.getElementById("plain")!.style.backgroundColor,
            ),
          )
          .toBe("tomato");

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "style-change",
              selector: "#plain",
              property: "backgroundColor",
              value: "",
            },
            "*",
          );
        });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const element = document.getElementById("plain")!;
              return {
                inline: element.style.backgroundColor,
                computed: getComputedStyle(element).backgroundColor,
              };
            }),
          )
          .toEqual({ inline: "", computed: "rgb(1, 2, 3)" });
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "paints a locked layer distinguishably from an unlocked one, and clears it on unlock",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(content);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        const readPaint = () =>
          page.evaluate(() => {
            const read = (id: string) => {
              const el = document.getElementById(id)!;
              const style = getComputedStyle(el);
              return {
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                display: style.display,
              };
            };
            return {
              locked: read("locked"),
              plain: read("plain"),
              gone: read("gone"),
            };
          });

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "layer-states",
              lockedSelectors: ["#locked"],
              hiddenSelectors: ["#gone"],
            },
            "*",
          );
        });
        await page.waitForTimeout(50);

        const applied = await readPaint();
        // Lock has to be visible, not just semantic: a locked layer must not
        // render identically to an unlocked sibling.
        expect(applied.locked.outlineStyle).toBe("dashed");
        expect(Number.parseFloat(applied.locked.outlineWidth)).toBeGreaterThan(
          0,
        );
        expect(applied.locked).not.toEqual(applied.plain);
        expect(applied.gone.display).toBe("none");
        expect(applied.plain.display).toBe("block");

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "layer-states",
              lockedSelectors: [],
              hiddenSelectors: [],
            },
            "*",
          );
        });
        await page.waitForTimeout(50);

        const cleared = await readPaint();
        expect(cleared.locked).toEqual(cleared.plain);
        expect(cleared.gone.display).toBe("block");
      } finally {
        await browser.close();
      }
    },
  );
});
