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
 *    width/height are carried ONLY when authored on the element's own
 *    inline style — never diffed against the probe at all.
 *
 * Known limitation: an element sized entirely through a stylesheet rule
 * (e.g. `.card { width: 320px }`, no inline width) is NOT carried — a
 * stylesheet-rule walk to disambiguate "class-authored" from "flex/grid-
 * resolved to the same pixel value" was tried and reverted as unsound
 * (cross-origin sheets throw on `cssRules`; media/container-query/cascade
 * overrides can't be replayed correctly outside the browser's own layout).
 * Such an element loses its explicit size across a cross-screen move today.
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
});
