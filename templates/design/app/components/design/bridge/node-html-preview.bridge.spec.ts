import { chromium, type Page } from "@playwright/test";
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
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

async function postNodeHtmlPreview(
  page: Page,
  proposalId: string,
  target: Record<string, string>,
  html = `<button id="preview-${proposalId}">Preview</button>`,
): Promise<void> {
  await page.evaluate(
    ({ proposalId, target, html }) =>
      new Promise<void>((resolve) => {
        const onMessage = (event: MessageEvent) => {
          if (
            event.data?.type !== "node-html-preview" ||
            event.data.proposalId !== proposalId
          ) {
            return;
          }
          window.removeEventListener("message", onMessage);
          resolve();
        };
        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            type: "node-html-preview",
            operation: "preview",
            proposalId,
            target,
            html,
          },
          "*",
        );
      }),
    { proposalId, target, html },
  );
}

async function postNodeHtmlPreviewAndWaitForResult(
  page: Page,
  proposalId: string,
  target: Record<string, string>,
  html = `<button id="preview-${proposalId}">Preview</button>`,
): Promise<{ proposalId: string; reason?: string; type: string }> {
  return page.evaluate(
    ({ proposalId, target, html }) =>
      new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          reject(
            new Error("Node HTML preview did not acknowledge the request"),
          );
        }, 5_000);
        const onMessage = (event: MessageEvent) => {
          if (
            event.data?.proposalId !== proposalId ||
            (event.data?.type !== "agent-native:node-html-preview-applied" &&
              event.data?.type !== "agent-native:node-html-preview-failed")
          ) {
            return;
          }
          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          resolve(event.data);
        };
        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            type: "node-html-preview",
            operation: "preview",
            proposalId,
            target,
            html,
          },
          "*",
        );
      }),
    { proposalId, target, html },
  );
}

describe("node-html-preview iframe bridge", () => {
  it(
    "falls back from a missing versioned selector to a unique node id",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];

      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html><html><body>
          <main><section data-agent-native-node-id="hero">Original hero</section></main>
        </body></html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await postNodeHtmlPreview(page, "stale-selector", {
          nodeId: "hero",
          selector:
            "source-equivalent:v1:body > main:nth-of-type(1) > section:nth-of-type(2)",
        });

        expect(
          await page
            .locator(
              '[data-agent-native-node-rewrite-proposal="stale-selector"]',
            )
            .textContent(),
        ).toBe("Preview");
        expect(
          await page.locator('[data-agent-native-node-id="hero"]').count(),
        ).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "uses a unique node ID when its saved source selector shifted to a sibling",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });

      try {
        const page = await browser.newPage();
        await page.setContent(`<!doctype html><html><body>
          <main>
            <section data-agent-native-node-id="hero">Original hero</section>
            <section id="shifted-sibling">Unrelated sibling</section>
          </main>
        </body></html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await postNodeHtmlPreview(
          page,
          "unique-id-wins",
          {
            nodeId: "hero",
            selector:
              "source-equivalent:v1:body > main:nth-of-type(1) > section:nth-of-type(2)",
          },
          '<article id="hero-variant">Hero preview</article>',
        );

        expect(
          await page
            .locator(
              '[data-agent-native-node-rewrite-proposal="unique-id-wins"]',
            )
            .getAttribute("id"),
        ).toBe("hero-variant");
        expect(await page.locator("#shifted-sibling").textContent()).toBe(
          "Unrelated sibling",
        );
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "uses a source selector to disambiguate repeated node IDs",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });

      try {
        const page = await browser.newPage();
        await page.setContent(`<!doctype html><html><body>
          <main>
            <section data-loc="src:repeat">First instance</section>
            <section data-loc="src:repeat">Second instance</section>
          </main>
        </body></html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await postNodeHtmlPreview(
          page,
          "repeated-id-selector",
          {
            nodeId: "src:repeat",
            selector:
              "source-equivalent:v1:body > main:nth-of-type(1) > section:nth-of-type(2)",
          },
          '<article id="second-variant">Second preview</article>',
        );

        expect(await page.locator("section").count()).toBe(1);
        expect(await page.locator("section").textContent()).toBe(
          "First instance",
        );
        expect(
          await page
            .locator(
              '[data-agent-native-node-rewrite-proposal="repeated-id-selector"]',
            )
            .getAttribute("id"),
        ).toBe("second-variant");
      } finally {
        await browser.close();
      }
    },
  );

  it("acknowledges invalid preview markup without changing the target", async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><body>
        <main><section data-agent-native-node-id="hero">Original hero</section></main>
      </body></html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });

      const result = await postNodeHtmlPreviewAndWaitForResult(
        page,
        "invalid-preview",
        { nodeId: "hero" },
        "<section>First</section><section>Second</section>",
      );

      expect(result).toMatchObject({
        type: "agent-native:node-html-preview-failed",
        proposalId: "invalid-preview",
        reason: "preview-invalid",
      });
      expect(await page.locator("main").textContent()).toBe("Original hero");
    } finally {
      await browser.close();
    }
  });

  it("acknowledges a failed variant replacement while retaining the current preview", async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><body>
        <main><section data-agent-native-node-id="hero">Original hero</section></main>
      </body></html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });

      const firstResult = await postNodeHtmlPreviewAndWaitForResult(
        page,
        "variant-preview",
        { nodeId: "hero" },
      );
      expect(firstResult.type).toBe("agent-native:node-html-preview-applied");
      await page.evaluate(() => {
        const walker = document.createTreeWalker(
          document,
          NodeFilter.SHOW_COMMENT,
        );
        let comment = walker.nextNode();
        while (comment) {
          if (comment.nodeValue?.includes("node-html-preview:start")) {
            comment.parentNode?.removeChild(comment);
          }
          comment = walker.nextNode();
        }
      });

      const result = await postNodeHtmlPreviewAndWaitForResult(
        page,
        "variant-preview",
        { nodeId: "hero" },
        '<button id="next-variant">Next</button>',
      );

      expect(result).toMatchObject({
        type: "agent-native:node-html-preview-failed",
        proposalId: "variant-preview",
        reason: "preview-replacement-failed",
      });
      expect(
        await page
          .locator(
            '[data-agent-native-node-rewrite-proposal="variant-preview"]',
          )
          .getAttribute("id"),
      ).toBe("preview-variant-preview");
    } finally {
      await browser.close();
    }
  });

  it(
    "resolves unique node-id-only targets across supported identity attributes",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];

      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html><html><body><main>
          <button data-agent-native-node-id="agent-native">Agent-Native</button>
          <button data-code-layer-id="code-layer">Code layer</button>
          <button data-layer-id="layer">Layer</button>
          <button data-builder-id="builder">Builder</button>
          <button data-loc="source-location">Source location</button>
          <button id="plain-id">Plain id</button>
        </main></body></html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        const identities = [
          ["data-agent-native-node-id", "agent-native", "Agent-Native"],
          ["data-code-layer-id", "code-layer", "Code layer"],
          ["data-layer-id", "layer", "Layer"],
          ["data-builder-id", "builder", "Builder"],
          ["data-loc", "source-location", "Source location"],
          ["id", "plain-id", "Plain id"],
        ] as const;

        for (const [attribute, nodeId, originalText] of identities) {
          const proposalId = `identity-${nodeId}`;
          await postNodeHtmlPreview(page, proposalId, { nodeId });

          expect(
            await page
              .locator(
                `[data-agent-native-node-rewrite-proposal="${proposalId}"]`,
              )
              .textContent(),
          ).toBe("Preview");
          expect(await page.locator(`[${attribute}="${nodeId}"]`).count()).toBe(
            0,
          );
          expect(await page.locator("main").textContent()).not.toContain(
            originalText,
          );
        }

        for (const [attribute, nodeId] of [
          ["data-loc", "repeated-location"],
          ["id", "repeated-id"],
        ] as const) {
          await page.locator("main").evaluate(
            (main, values) => {
              for (const text of values.text) {
                const element = document.createElement("button");
                element.setAttribute(values.attribute, values.nodeId);
                element.textContent = text;
                main.appendChild(element);
              }
            },
            { attribute, nodeId, text: ["First", "Second"] },
          );
          const repeated = page.locator(`[${attribute}="${nodeId}"]`);

          const result = await postNodeHtmlPreviewAndWaitForResult(
            page,
            `ambiguous-${nodeId}`,
            { nodeId },
          );

          expect(result).toMatchObject({
            type: "agent-native:node-html-preview-failed",
            proposalId: `ambiguous-${nodeId}`,
            reason: "target-unresolved",
          });
          expect(await repeated.allTextContents()).toEqual(["First", "Second"]);
          expect(
            await page
              .locator("[data-agent-native-node-rewrite-proposal]")
              .count(),
          ).toBe(0);
        }

        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

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
            ?.addEventListener("agent-native-node-identity-probe", () => {
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
          element.dispatchEvent(
            new CustomEvent("agent-native-node-identity-probe", {
              bubbles: true,
            }),
          );
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
            element.dispatchEvent(
              new CustomEvent("agent-native-node-identity-probe", {
                bubbles: true,
              }),
            );
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
