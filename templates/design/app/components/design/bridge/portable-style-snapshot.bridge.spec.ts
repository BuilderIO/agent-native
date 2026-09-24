import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Regression coverage for review-bot findings on the portable-style
 * diff-vs-defaults probe (collectPortableComputedStyles / collectPortableStyleSnapshot
 * in editor-chrome.bridge.ts):
 *
 * 1. The bare-tag probe used to be inserted into the SOURCE document itself,
 *    so a tag-level author rule there (e.g. `button { background: teal }`)
 *    matched the probe too — the diff then saw "same as default" and dropped
 *    a real, authored appearance property the destination document (which
 *    lacks that rule) does not have. The probe must be measured against
 *    user-agent defaults only, in a stylesheet-free context.
 * 2. The probe used to force `position:absolute` on itself to keep it out of
 *    page layout. That changes width's auto-sizing algorithm (absolute
 *    shrink-to-fit vs static fill-the-containing-block), so an ordinary
 *    flow element with no authored width looked "different from default"
 *    purely because of the probe's forced position — freezing what should
 *    stay fluid into a hardcoded pixel value on every move/duplicate. Fix:
 *    width/height use native computed Typed OM values, which preserve auto
 *    and percentages without using layout-resolved pixels from the probe.
 *    The source capture regressions live in portable-typed-om-capture.spec.ts.
 */
function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("portable-fixture"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

async function portableStyleSnapshotStylesFor(
  html: string,
  selector: string,
): Promise<Record<string, string> | undefined> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(html);
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        (window as any).__messages.push(event.data);
      });
    });
    await page.evaluate((sel) => {
      window.postMessage(
        { type: "select-element", selector: sel, selectorCandidates: [sel] },
        "*",
      );
    }, selector);
    await page.waitForFunction(() =>
      ((window as any).__messages ?? []).some(
        (message: any) => message.type === "element-select",
      ),
    );
    const messages: Array<Record<string, unknown>> = await page.evaluate(
      () => (window as any).__messages,
    );
    const select = messages.find(
      (message) => message.type === "element-select",
    ) as {
      payload?: {
        portableStyleSnapshot?: {
          nodes?: Array<{ styles: Record<string, string> }>;
        };
      };
    };
    return select?.payload?.portableStyleSnapshot?.nodes?.[0]?.styles;
  } finally {
    await browser.close();
  }
}

/**
 * Same drive-a-real-browser flow, but with the probe iframe made unavailable
 * before the bridge script loads. Returns the snapshot plus the capture-failure
 * marker so a caller can distinguish an omitted failed capture from a
 * legitimate absent snapshot.
 */
async function portableStyleSnapshotWithIframeProbe(
  html: string,
  selector: string,
  mode: "throw" | "null",
): Promise<{
  snapshot?: { nodes?: Array<{ styles: Record<string, string> }> };
  styleSnapshotCaptureFailed?: boolean;
}> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(html);
    await page.evaluate((probeMode) => {
      const realCreateElement = document.createElement.bind(document);
      document.createElement = ((
        tagName: string,
        options?: ElementCreationOptions,
      ) => {
        if (tagName.toLowerCase() === "iframe") {
          if (probeMode === "throw") {
            throw new Error("iframe creation blocked (test)");
          }
          const iframe = realCreateElement(
            tagName,
            options,
          ) as HTMLIFrameElement;
          Object.defineProperty(iframe, "contentDocument", {
            configurable: true,
            get: () => null,
          });
          return iframe;
        }
        return realCreateElement(tagName, options);
      }) as typeof document.createElement;
    }, mode);
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        (window as any).__messages.push(event.data);
      });
    });
    await page.evaluate((sel) => {
      window.postMessage(
        { type: "select-element", selector: sel, selectorCandidates: [sel] },
        "*",
      );
    }, selector);
    await page.waitForFunction(() =>
      ((window as any).__messages ?? []).some(
        (message: any) => message.type === "element-select",
      ),
    );
    const messages: Array<Record<string, unknown>> = await page.evaluate(
      () => (window as any).__messages,
    );
    const select = messages.find(
      (message) => message.type === "element-select",
    ) as {
      payload?: {
        portableStyleSnapshot?: {
          nodes?: Array<{ styles: Record<string, string> }>;
        };
        styleSnapshotCaptureFailed?: boolean;
      };
    };
    return {
      snapshot: select?.payload?.portableStyleSnapshot,
      styleSnapshotCaptureFailed: select?.payload?.styleSnapshotCaptureFailed,
    };
  } finally {
    await browser.close();
  }
}

describe("portable style snapshot diff-vs-defaults probe", () => {
  it(
    "carries a bare tag's authored appearance from the source document's own stylesheet (not just classed elements)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>button{background-color:teal}</style></head><body style="margin:0">
        <button data-agent-native-node-id="btn">Click</button>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="btn"]',
      );
      // teal = rgb(0, 128, 128). If the probe is measured inside the SAME
      // document, it matches the bare `button` rule too and this gets
      // dropped as "same as default" — losing the button's real appearance
      // once it lands in a destination document without this stylesheet.
      expect(styles?.backgroundColor).toBe("rgb(0, 128, 128)");
    },
  );

  it(
    "does not freeze an auto-sized flow element's width into an explicit pixel value",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="width:600px">
          <div data-agent-native-node-id="child"></div>
        </div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="child"]',
      );
      // "child" has no authored width — it is an ordinary static block that
      // fills its 600px parent. The probe forcing position:absolute on
      // itself resolves to shrink-to-fit (~0px), so the diff wrongly saw
      // "600px" as a customization and baked it in as an explicit style.
      expect(styles?.width).toBeUndefined();
      expect(styles?.height).toBeUndefined();
    },
  );

  it(
    "carries an explicit inline width/height authored on the element itself",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div data-agent-native-node-id="card" style="width:320px;height:200px"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // Authored directly on the element's own inline style — the one
      // unambiguous "this element decided its own size" signal — must be
      // carried so the card doesn't collapse in a destination document.
      expect(styles?.width).toBe("320px");
      expect(styles?.height).toBe("200px");
    },
  );

  it(
    "carries an inline-authored property even when it equals the bare-tag default",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div data-agent-native-node-id="card" style="color:black"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      expect(styles?.color).toBe("rgb(0, 0, 0)");
    },
  );

  it(
    "still drops a stylesheet-authored property that equals the bare-tag default",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{color:black}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // This snapshot is a portable-value collector, not a CSS cascade
      // engine; a class rule equal to the bare-tag default stays ambiguous.
      expect(styles?.color).toBeUndefined();
    },
  );

  it(
    "leaves a plain flex child's flex-derived size uncarried (stays fluid)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.row{display:flex;width:500px}.row>div{flex:1}</style></head><body style="margin:0">
        <div class="row"><div data-agent-native-node-id="child"></div></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="child"]',
      );
      // "child" is sized entirely by `flex:1` against its row — no rule
      // declares an explicit width/height for it, so none must be carried;
      // freezing the flex-resolved pixel width here would un-flex it the
      // moment it lands anywhere the row's width differs.
      expect(styles?.width).toBeUndefined();
      expect(styles?.height).toBeUndefined();
    },
  );

  it(
    "skips the whole snapshot (never a {}-per-node one) when the bare-tag probe iframe can't be created",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <button data-agent-native-node-id="btn">Click</button>
      </body></html>`;
      const capture = await portableStyleSnapshotWithIframeProbe(
        html,
        '[data-agent-native-node-id="btn"]',
        "throw",
      );
      // Failed capture is omitted and marked distinctly from an absent snapshot.
      expect(capture.snapshot).toBeUndefined();
      expect(capture.styleSnapshotCaptureFailed).toBe(true);
    },
  );

  it(
    "uses the same-document fallback when the probe iframe has no readable document",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>div{background-color:teal}</style></head><body style="margin:0;color:rgb(128, 0, 128);font-family:Courier New">
        <div data-agent-native-node-id="btn">Click</div>
      </body></html>`;
      const capture = await portableStyleSnapshotWithIframeProbe(
        html,
        '[data-agent-native-node-id="btn"]',
        "null",
      );
      const styles = capture.snapshot?.nodes?.[0]?.styles;

      expect(capture.styleSnapshotCaptureFailed).toBeUndefined();
      expect(styles?.backgroundColor).toBe("rgb(0, 128, 128)");
      expect(styles?.color).toBe("rgb(128, 0, 128)");
      expect(styles?.visibility).toBeUndefined();
      expect(styles?.pointerEvents).toBeUndefined();
    },
  );
});
