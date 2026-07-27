import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("preview-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

describe("node-html-preview iframe bridge", () => {
  it(
    "switches variants without re-resolving the replaced target and restores the exact original node",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];

      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html><html><body>
          <main>
            <button data-agent-native-node-id="hero" class="hero original" data-copy="A &amp; B">
              <span>Original</span>
            </button>
          </main>
        </body></html>`);
        await page.evaluate(() => {
          (
            window as Window & {
              __nodeHtmlPreviewAcks?: Array<Record<string, unknown>>;
            }
          ).__nodeHtmlPreviewAcks = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type !== "agent-native:node-html-preview-applied")
              return;
            (
              window as Window & {
                __nodeHtmlPreviewAcks?: Array<Record<string, unknown>>;
              }
            ).__nodeHtmlPreviewAcks?.push(event.data);
          });
          (window as Window & { __originalClicks?: number }).__originalClicks =
            0;
          document
            .querySelector('[data-agent-native-node-id="hero"]')
            ?.addEventListener("click", () => {
              (
                window as Window & { __originalClicks?: number }
              ).__originalClicks! += 1;
            });
        });
        const originalOuterHtml = await page
          .locator('[data-agent-native-node-id="hero"]')
          .evaluate((element) => element.outerHTML);

        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "node-html-preview",
              operation: "preview",
              proposalId: "proposal-a",
              target: { nodeId: "hero" },
              html: '<section id="variant-one"><p>First</p></section>',
            },
            "*",
          );
        });

        expect(await page.locator("#variant-one").count()).toBe(1);
        expect(
          await page
            .locator("#variant-one")
            .getAttribute("data-agent-native-node-rewrite-proposal"),
        ).toBe("proposal-a");
        expect(
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __nodeHtmlPreviewAcks?: Array<Record<string, unknown>>;
                }
              ).__nodeHtmlPreviewAcks,
          ),
        ).toEqual([
          {
            type: "agent-native:node-html-preview-applied",
            proposalId: "proposal-a",
          },
        ]);
        expect(
          await page.locator('[data-agent-native-node-id="hero"]').count(),
        ).toBe(0);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "node-html-preview",
              operation: "preview",
              proposalId: "proposal-a",
              target: { nodeId: "hero" },
              html: '<article id="variant-two"><p>Second</p></article>',
            },
            "*",
          );
        });

        expect(await page.locator("#variant-one").count()).toBe(0);
        expect(await page.locator("#variant-two").count()).toBe(1);
        expect(
          await page
            .locator("#variant-two")
            .getAttribute("data-agent-native-node-rewrite-proposal"),
        ).toBe("proposal-a");
        expect(
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __nodeHtmlPreviewAcks?: Array<Record<string, unknown>>;
                }
              ).__nodeHtmlPreviewAcks?.length,
          ),
        ).toBe(2);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "node-html-preview",
              operation: "restore",
              proposalId: "stale-proposal",
              target: { nodeId: "hero" },
            },
            "*",
          );
        });
        expect(await page.locator("#variant-two").count()).toBe(1);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "node-html-preview",
              operation: "restore",
              proposalId: "proposal-a",
              target: { nodeId: "hero" },
            },
            "*",
          );
        });

        const restored = page.locator('[data-agent-native-node-id="hero"]');
        expect(await restored.count()).toBe(1);
        expect(
          await restored.getAttribute(
            "data-agent-native-node-rewrite-proposal",
          ),
        ).toBeNull();
        expect(await restored.evaluate((element) => element.outerHTML)).toBe(
          originalOuterHtml,
        );
        await restored.evaluate((element) => {
          element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(
          await page.evaluate(
            () =>
              (window as Window & { __originalClicks?: number })
                .__originalClicks,
          ),
        ).toBe(1);
        expect(await page.locator("body").innerHTML()).not.toContain(
          "agent-native:node-html-preview",
        );

        const originalBodyOuterHtml = await page
          .locator("body")
          .evaluate((element) => element.outerHTML);
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "node-html-preview",
              operation: "preview",
              proposalId: "proposal-body",
              target: { selector: "body" },
              html: '<body class="body-candidate"><main id="body-variant">Body candidate</main></body>',
            },
            "*",
          );
        });

        expect(await page.locator("#body-variant").count()).toBe(1);
        expect(await page.locator("body").getAttribute("class")).toBe(
          "body-candidate",
        );
        expect(
          await page
            .locator("body")
            .getAttribute("data-agent-native-node-rewrite-proposal"),
        ).toBe("proposal-body");

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "node-html-preview",
              operation: "restore",
              proposalId: "proposal-body",
              target: { selector: "body" },
            },
            "*",
          );
        });

        expect(
          await page.locator("body").evaluate((element) => element.outerHTML),
        ).toBe(originalBodyOuterHtml);
        await page
          .locator('[data-agent-native-node-id="hero"]')
          .evaluate((element) => {
            element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
        expect(
          await page.evaluate(
            () =>
              (window as Window & { __originalClicks?: number })
                .__originalClicks,
          ),
        ).toBe(2);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});
