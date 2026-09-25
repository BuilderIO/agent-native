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

async function crossScreenStartSizeFor(
  html: string,
  selector: string,
): Promise<{ width?: number; height?: number } | undefined> {
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
        if (event.data?.type === "agent-native:cross-screen-drag") {
          (window as any).__messages.push(event.data);
        }
      });
    });
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`Missing drag fixture ${selector}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() =>
      ((window as any).__messages ?? []).some(
        (message: any) => message.phase === "start",
      ),
    );
    const startSize = await page.evaluate(
      () =>
        (window as any).__messages.find(
          (message: any) => message.phase === "start",
        )?.sourceComputedSize,
    );
    await page.mouse.up();
    return startSize;
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
    "does not send used pixels for authored percentage and auto sizing on an ordinary drag",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="width:600px;height:240px;position:relative">
          <div data-agent-native-node-id="responsive" style="display:inline-block;width:50%;height:auto">Responsive</div>
        </div>
      </body></html>`;
      const sourceComputedSize = await crossScreenStartSizeFor(
        html,
        '[data-agent-native-node-id="responsive"]',
      );
      expect(sourceComputedSize).toBeUndefined();
    },
  );

  it(
    "sends only the omitted dimension resolved by an auto-layout parent",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:flex;width:400px;height:100px">
          <div data-agent-native-node-id="child" style="flex:0 0 100px;height:50px"></div>
        </div>
      </body></html>`;
      const sourceComputedSize = await crossScreenStartSizeFor(
        html,
        '[data-agent-native-node-id="child"]',
      );
      expect(sourceComputedSize).toEqual({ width: 100 });
    },
  );

  it(
    "captures the default flex cross-axis stretch dimension",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:flex;width:300px;height:200px">
          <div data-agent-native-node-id="stretched" style="width:40px;height:auto">Tall item</div>
        </div>
      </body></html>`;
      const selector = '[data-agent-native-node-id="stretched"]';
      const styles = await portableStyleSnapshotStylesFor(html, selector);
      const sourceComputedSize = await crossScreenStartSizeFor(html, selector);
      expect(styles?.height).toBe("auto");
      expect(sourceComputedSize).toEqual({ height: 200 });
    },
  );

  it(
    "captures Flex sizing for relatively positioned in-flow items",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:flex;width:300px;height:200px">
          <div data-agent-native-node-id="relative" style="position:relative;width:40px;height:auto">Tall item</div>
        </div>
      </body></html>`;
      const selector = '[data-agent-native-node-id="relative"]';
      const styles = await portableStyleSnapshotStylesFor(html, selector);
      const sourceComputedSize = await crossScreenStartSizeFor(html, selector);
      expect(styles?.height).toBe("auto");
      expect(sourceComputedSize).toEqual({ height: 200 });
    },
  );

  it(
    "captures an auto-basis Flex main-axis size after flex-shrink",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:flex;width:120px;height:40px">
          <div data-agent-native-node-id="shrunk" style="width:auto;min-width:0;flex:0 1 auto;white-space:nowrap">A long unbreakable flex item</div>
        </div>
      </body></html>`;
      const selector = '[data-agent-native-node-id="shrunk"]';
      const styles = await portableStyleSnapshotStylesFor(html, selector);
      const sourceComputedSize = await crossScreenStartSizeFor(html, selector);
      expect(styles?.width).toBe("auto");
      expect(sourceComputedSize).toEqual({ width: 120, height: 40 });
    },
  );

  it(
    "does not capture flex cross-axis size when auto margins disable stretch",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:flex;width:300px;height:200px">
          <div data-agent-native-node-id="auto-margin" style="width:40px;margin-top:auto">Tall item</div>
        </div>
      </body></html>`;
      const sourceComputedSize = await crossScreenStartSizeFor(
        html,
        '[data-agent-native-node-id="auto-margin"]',
      );
      expect(sourceComputedSize).toBeUndefined();
    },
  );

  it(
    "captures default Flex stretch on the cross axis for column layout",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:flex;flex-direction:column;width:300px;height:200px">
          <div data-agent-native-node-id="stretched" style="width:auto;height:40px">Wide item</div>
        </div>
      </body></html>`;
      const selector = '[data-agent-native-node-id="stretched"]';
      const styles = await portableStyleSnapshotStylesFor(html, selector);
      const sourceComputedSize = await crossScreenStartSizeFor(html, selector);
      expect(styles?.width).toBe("auto");
      expect(sourceComputedSize).toEqual({ width: 300 });
    },
  );

  it(
    "preserves a fixed width when flex-basis controls the used width",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.item{width:200px}</style></head><body style="margin:0">
        <div style="display:flex;width:400px">
          <div class="item" data-agent-native-node-id="child" style="flex:0 0 100px;height:50px"></div>
        </div>
      </body></html>`;
      const selector = '[data-agent-native-node-id="child"]';
      const styles = await portableStyleSnapshotStylesFor(html, selector);
      const sourceComputedSize = await crossScreenStartSizeFor(html, selector);
      expect(styles?.width).toBe("200px");
      expect(sourceComputedSize).toBeUndefined();
    },
  );

  it(
    "captures default Grid stretch sizing when a static item is dropped as absolute",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:grid;width:300px;height:100px;grid-template-columns:300px;grid-template-rows:100px">
          <div data-agent-native-node-id="stretched"></div>
        </div>
      </body></html>`;
      const selector = '[data-agent-native-node-id="stretched"]';
      const styles = await portableStyleSnapshotStylesFor(html, selector);
      const sourceComputedSize = await crossScreenStartSizeFor(html, selector);
      expect(styles?.width).toBeUndefined();
      expect(sourceComputedSize).toEqual({ width: 300, height: 100 });
    },
  );

  it(
    "does not capture Grid dimensions when inherited alignment avoids stretching",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:grid;width:300px;height:100px;grid-template-columns:300px;grid-template-rows:100px;justify-items:center;align-items:center">
          <div data-agent-native-node-id="centered">Intrinsic content</div>
        </div>
      </body></html>`;
      const sourceComputedSize = await crossScreenStartSizeFor(
        html,
        '[data-agent-native-node-id="centered"]',
      );
      expect(sourceComputedSize).toBeUndefined();
    },
  );

  it(
    "does not freeze intrinsic Grid sizing when normal alignment is not a proven stretch",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="display:grid;width:300px;grid-template-columns:auto;grid-template-rows:auto">
          <div data-agent-native-node-id="intrinsic" style="aspect-ratio:2">Intrinsic content</div>
        </div>
      </body></html>`;
      const sourceComputedSize = await crossScreenStartSizeFor(
        html,
        '[data-agent-native-node-id="intrinsic"]',
      );
      expect(sourceComputedSize).toBeUndefined();
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

  it(
    "carries no inherited colour, font, empty border or outline onto a moved vector or image",
    { timeout: 30_000 },
    async () => {
      const page = `<!doctype html><html><head><style>*{box-sizing:border-box}</style></head><body style="margin:0;color:#111827;font-family:Inter">
        <svg data-agent-native-node-id="vec" viewBox="0 0 10 10" style="position:absolute;left:10px;top:10px;width:100px;height:100px"><path d="M0 0 L10 10" stroke="#fff"></path></svg>
        <img data-agent-native-node-id="img" alt="" style="position:absolute;left:200px;top:10px;width:100px;height:60px">
      </body></html>`;
      for (const id of ["vec", "img"]) {
        const styles = await portableStyleSnapshotStylesFor(
          page,
          `[data-agent-native-node-id="${id}"]`,
        );
        for (const property of [
          "border",
          "outline",
          "color",
          "font",
          "textDecorationColor",
          "transformOrigin",
          "boxSizing",
          "display",
        ]) {
          expect(styles?.[property], `${id} ${property}`).toBeUndefined();
        }
      }
    },
  );

  it(
    "keeps a border that paints and the colour a currentColor stroke reads",
    { timeout: 30_000 },
    async () => {
      const styles = await portableStyleSnapshotStylesFor(
        `<!doctype html><html><body style="margin:0;color:rgb(10, 20, 30)">
          <div data-agent-native-node-id="box" style="position:absolute;width:40px;height:40px;border:2px solid"></div>
        </body></html>`,
        '[data-agent-native-node-id="box"]',
      );
      expect(styles?.borderTopWidth).toBe("2px");
      expect(styles?.borderTopColor).toBe("rgb(10, 20, 30)");
    },
  );
});
