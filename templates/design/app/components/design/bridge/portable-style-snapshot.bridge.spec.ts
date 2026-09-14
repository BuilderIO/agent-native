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
 * Known limitation: width/height carrying is a provenance check, not a
 * cascade engine. Same-origin sheets (`document.styleSheets`, both
 * documents' and a shadow root's `adoptedStyleSheets`, and readable
 * `@import`s, recursed) are scanned for a top-level (unwrapped) stylesheet
 * rule with a PLAIN selector (type/class/id/attribute + descendant/child
 * combinators only, quoted attribute values exempted — an allowlist, since
 * the pseudo-classes that describe a transient state rather than permanent
 * provenance, e.g. `:hover`/`:checked`/`:disabled`/`:nth-*()`/`:is()`, are
 * unbounded and a denylist always misses one). A px-literal value (rule or
 * inline) is carried only when it is the ONE such rule matching the element
 * for that property and it agrees with the computed size. A non-px inline
 * value (`50%`, `2rem`, `calc(...)`) has no computed-px form to check, so it
 * is carried verbatim as authored UNLESS a matching rule for that property
 * is `!important` anywhere reachable — the one concrete, checkable sign that
 * something else may have actually won. This is fail-closed, not
 * best-effort: a second matching rule (whatever it says), a cross-origin
 * sheet or `@import` (`cssRules` throws, or the import hasn't resolved), a
 * rule type this walk does not evaluate at all but which also cannot
 * declare a matching `width`/`height` (`@font-face`, `@keyframes`, …, which
 * are simply ignored, not masked), or ANY same-property rule for a matching
 * selector inside `@media`/`@supports`/`@container`/`@layer`/`@scope` —
 * matching or not, since the condition isn't evaluated — or nested inside
 * the matching rule itself (CSS nesting: a `&` rule, or a bare declaration
 * block `.card { @media (…) { width: 200px } }`) — all mask the result and
 * leave the element fluid rather than resolve a winner by
 * specificity/cascade order.
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
 * Same drive-a-real-browser flow, but with the named grouping-rule
 * constructors (`CSSLayerBlockRule`, `CSSContainerRule`, `CSSScopeRule`, …)
 * deleted from `window` right after the bridge script loads — simulates an
 * engine build that never exposed them (older Safari/Firefox) so a fix that
 * still relies on `instanceof` against a specific global would go blind.
 */
async function portableStyleSnapshotStylesForWithoutGroupingConstructors(
  html: string,
  selector: string,
  constructorNames: string[],
): Promise<Record<string, string> | undefined> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(html);
    await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await page.evaluate((names: string[]) => {
      names.forEach((name) => {
        delete (window as any)[name];
      });
    }, constructorNames);
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
 * Same drive-a-real-browser flow, but with `document.createElement("iframe")`
 * stubbed to throw before the bridge script loads — the only way
 * portableStyleProbeDocument's own try/catch can fail (sandboxed iframe, CSP,
 * etc.). Returns the whole snapshot (not drilled into `.styles`) so a caller
 * can assert it is `undefined` — the loud, distinguishable failure — rather
 * than a `{}`-per-node snapshot that reads as "nothing here is customized".
 */
async function portableStyleSnapshotWithBrokenIframeProbe(
  html: string,
  selector: string,
): Promise<
  { nodes?: Array<{ styles: Record<string, string> }> } | null | undefined
> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(html);
    await page.evaluate(() => {
      const realCreateElement = document.createElement.bind(document);
      document.createElement = ((
        tagName: string,
        options?: ElementCreationOptions,
      ) => {
        if (tagName.toLowerCase() === "iframe") {
          throw new Error("iframe creation blocked (test)");
        }
        return realCreateElement(tagName, options);
      }) as typeof document.createElement;
    });
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
    return select?.payload?.portableStyleSnapshot;
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

  it(
    "carries a class-authored width/height with no inline style at all",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px;height:200px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // Exactly one same-origin, unwrapped rule matches and its literal px
      // value agrees with the rendered size — the one case this provenance
      // check can trust without replaying the cascade.
      expect(styles?.width).toBe("320px");
      expect(styles?.height).toBe("200px");
    },
  );

  it(
    "leaves width uncarried when a second matching rule overrides it (ambiguous, not resolved by specificity)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px}.row>.card{width:auto}</style></head><body style="margin:0">
        <div class="row"><div class="card" data-agent-native-node-id="card"></div></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // Two rules match `.card` for width. The more specific one wins in a
      // real cascade, but this probe deliberately does not compute
      // specificity — a second matching rule makes the winner ambiguous, so
      // neither is trusted and the property is left fluid.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "leaves width uncarried when a same-property rule for the same selector exists inside @media, matching or not",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px}@media (min-width:99999px){.card{width:9999px}}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The @media condition never matches this viewport, but this walk
      // never evaluates it — a same-property, same-selector rule sitting
      // inside ANY grouping construct masks the visible top-level match
      // instead of being ignored, fail-closed.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "ignores a :hover-only rule as size provenance, still carrying the plain rule it sits beside",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px}.card:hover{width:340px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // `:hover` describes a transient state, not the resting size — it
      // must be excluded entirely (neither a candidate nor a masking
      // competitor), leaving the plain rule as the sole, trusted match.
      expect(styles?.width).toBe("320px");
    },
  );

  it(
    "leaves width uncarried when an @import points to an unreadable cross-origin sheet",
    { timeout: 30_000 },
    async () => {
      // @import must precede all other rules (besides @charset/@layer
      // statements) to parse at all. A cross-origin `@import` never grants
      // `cssRules` access (there's no `crossorigin` opt-in for `@import`,
      // unlike `<link>`), regardless of whether the URL ever resolves.
      const html = `<!doctype html><html><head><style>@import url("https://portable-style-unreadable-import.invalid/x.css");.card{width:320px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The imported sheet might carry a competing declaration this walk
      // has no way to read — unreadable, so it masks rather than being
      // silently treated as empty.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "recurses into a readable (data:) @import instead of treating it as opaque",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>@import url("data:text/css,.card{width:280px}");.card{width:320px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // If the import were masked outright (or ignored as opaque), the
      // local `.card{width:320px}` would wrongly look like the sole
      // candidate. It's readable, so its own `.card{width:280px}` is a
      // second, real, matching candidate — ambiguous, left fluid.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "accepts an attribute selector whose quoted value contains a colon, comma, and asterisk",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>[data-x="a:b,c*d"]{width:320px}</style></head><body style="margin:0">
        <div data-x="a:b,c*d" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The `:`/`,`/`*` characters live inside a quoted attribute value, not
      // in the selector's own grammar — a naive char scan over the whole
      // selector text would wrongly reject this as unsafe.
      expect(styles?.width).toBe("320px");
    },
  );

  it(
    "carries a non-px inline size (%, rem, calc()) verbatim when nothing overrides it",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <div style="width:600px">
          <div data-agent-native-node-id="pct" style="width:50%;height:2rem"></div>
        </div>
        <div data-agent-native-node-id="calc" style="width:calc(100% - 20px)"></div>
      </body></html>`;
      const pct = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="pct"]',
      );
      // A non-px inline value has no computed-px form to agree with — it
      // must still be carried as authored (this is the previously-working
      // behavior a stricter px-only check would have regressed).
      expect(pct?.width).toBe("50%");
      expect(pct?.height).toBe("2rem");
      const calc = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="calc"]',
      );
      expect(calc?.width).toBe("calc(100% - 20px)");
    },
  );

  it(
    "omits a non-px inline size only when a matching stylesheet rule is !important",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:999px!important}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card" style="width:50%"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // Can't compare "50%" against a computed px value directly, but a
      // matching `!important` rule is a concrete, visible sign that the
      // inline value likely isn't what's really rendered.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "leaves width uncarried when the sole matching rule uses a stateful pseudo-class (:checked)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card:checked{width:320px}</style></head><body style="margin:0">
        <input type="checkbox" checked class="card" data-agent-native-node-id="card" />
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The checkbox IS checked, so a denylist that only knew about
      // :hover/:focus/:active would have let this rule through as the sole,
      // computed-agreeing candidate — trusting a transient toggle state as
      // permanent provenance. The allowlist rejects any `:` outright.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "leaves width uncarried when an inline value is overridden by a stylesheet !important rule",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:200px!important}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card" style="width:320px;height:100px"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The real cascade renders 200px (the !important rule wins), but the
      // raw inline attribute still reads "320px" — trusting the inline
      // string without checking it against computed style would carry a
      // value the element doesn't actually render at.
      expect(styles?.width).toBeUndefined();
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
      // A <div>'s UA-default color already renders black, so a diff against
      // the bare-tag probe alone can't tell "authored, coincidentally
      // matches the default" from "never authored" — but an explicit inline
      // declaration is unambiguous authorship and must be carried regardless
      // of what the probe says.
      expect(styles?.color).toBe("rgb(0, 0, 0)");
    },
  );

  it(
    "still drops a stylesheet-authored property that equals the bare-tag default (known ceiling, not a cascade engine)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{color:black}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // Without a real cascade engine this walk cannot tell "a stylesheet
      // rule authored this and it happens to equal the UA default" from
      // "nothing authored it at all" — see collectPortableComputedStyles's
      // KNOWN CEILING comment. Only an explicit inline declaration (tested
      // above) resolves that ambiguity; a class-authored one does not.
      expect(styles?.color).toBeUndefined();
    },
  );

  it(
    "omits a non-px inline size when the cascade is masked by an unreadable cross-origin sheet",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>@import url("https://portable-style-unreadable-import.invalid/x.css");</style></head><body style="margin:0">
        <div data-agent-native-node-id="card" style="width:50%"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The unreadable sheet could hide a matching `!important` rule this
      // walk has no way to see — fail closed the same as the pixel and
      // stylesheet-rule branches, instead of trusting the (possibly losing)
      // inline value.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "skips the whole snapshot (never a {}-per-node one) when the bare-tag probe iframe can't be created",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><body style="margin:0">
        <button data-agent-native-node-id="btn">Click</button>
      </body></html>`;
      const snapshot = await portableStyleSnapshotWithBrokenIframeProbe(
        html,
        '[data-agent-native-node-id="btn"]',
      );
      // A `{}` default here would make every computed property look
      // "customized" (nothing to diff against) — the over-carrying bug this
      // guards. `null` — not `undefined`, which means "legitimately nothing
      // to carry" — is the loud, distinguishable CAPTURE-FAILED signal;
      // collectPortableStyleSnapshot's cross-screen caller pairs it with an
      // explicit `styleSnapshotCaptureFailed` flag and refuses the move (see
      // "runCrossScreenElementDrop — portable style capture failure" in
      // cross-screen-element-drop.spec.ts) rather than silently dropping the
      // appearance carry-over.
      expect(snapshot).toBeNull();
    },
  );

  it(
    "still masks a grouping-rule match when the engine never exposed its constructor",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>@layer base {.card{width:200px}} .card{width:320px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles =
        await portableStyleSnapshotStylesForWithoutGroupingConstructors(
          html,
          '[data-agent-native-node-id="card"]',
          ["CSSLayerBlockRule", "CSSContainerRule", "CSSScopeRule"],
        );
      // Classifying a grouping rule by `instanceof CSSLayerBlockRule` goes
      // blind the moment that global is missing (older engine) or the rule
      // came from another realm — the competing `@layer` declaration would
      // silently stop masking the top-level match. Duck-typing by shape
      // (has `cssRules`, no `selectorText`) doesn't depend on the global.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "walks CSS nesting: a style rule's own nested rules still mask its match",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px;@media (max-width:100px){.row & {width:200px}}}</style></head><body style="margin:0">
        <div class="row"><div class="card" data-agent-native-node-id="card"></div></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // A CSSStyleRule can carry its own nested `cssRules` (CSS nesting) —
      // never recursed before this fix, so a nested `.row & { … }`
      // competing declaration went invisible. The @media is inactive at
      // this viewport, so the computed width still equals the outer 320px
      // and the computed-vs-declared check cannot save this case: only the
      // nested walk masking the outer match leaves it fluid.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "still carries the plain rule when a nested `&` rule does not match the element",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px;.narrow & {width:200px}}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The element is not inside `.narrow`, so the nested rule is a
      // non-match, not a competitor — the outer rule stays the sole match.
      expect(styles?.width).toBe("320px");
    },
  );

  it(
    "masks a bare declaration block nested in a style rule (CSSNestedDeclarations)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px;@media (max-width:100px){width:200px}}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // Bare declarations trailing a nested at-rule are exposed as a
      // CSSNestedDeclarations rule: `style` only, no `selectorText`, no
      // `cssRules`. Classified by shape alone it matched none of the
      // grouping/style/@import cases and fell into the "harmless" bucket
      // beside @font-face — silently dropping a real competing width for
      // the enclosing `.card`. This is the shape Tailwind v4 emits for every
      // responsive utility.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "masks a nested `&` rule inside an inactive grouping construct",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px;@media (max-width:100px){& {width:200px}}}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // The explicit-`&` spelling of the case above: `&` resolves to the
      // enclosing `.card`, so the nested rule matches and masks.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "resolves a leading `&` against the enclosing selector instead of `:scope`",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.child{width:320px}.card{@media (max-width:100px){& .child{width:200px}}}</style></head><body style="margin:0">
        <div class="card"><div class="child" data-agent-native-node-id="child"></div></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="child"]',
      );
      // `el.matches("& .child")` reads `&` as `:scope` — the element itself
      // — and asks whether `.child` is its own descendant: never. The
      // nested rule really targets `.card .child`, i.e. this element, so
      // it must mask the top-level `.child` match.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "masks a nested `&` rule whose enclosing rule is a selector list",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.child{width:320px}.card,.panel{@media (max-width:100px){& .child{width:200px}}}</style></head><body style="margin:0">
        <div class="card"><div class="child" data-agent-native-node-id="child"></div></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="child"]',
      );
      // Splicing `.card, .panel` into `& .child` builds `.card, .panel .child`
      // — a list the candidate allowlist rejects — and a rejected competitor
      // used to be skipped rather than masked, so the base 320px was carried
      // and the destination pinned a responsive element.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "masks a selector-list competitor inside a grouping construct",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px}@media (max-width:100px){.card,.panel{width:200px}}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "ignores a named @page rule as element provenance",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>@page wide{width:500px}body{margin:0;width:500px}wide{display:block}</style></head><body>
        <wide data-agent-native-node-id="card"></wide>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // `@page wide` exposes `selectorText: "wide"` and a `style` block,
      // the same shape as a style rule — but a page selector names a page,
      // not the `<wide>` element, so it is neither a candidate nor a
      // competitor. The element has no authored width at all here.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "treats an escaped `:` as ident text, not a pseudo-class (Tailwind variant classes)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>.card{width:320px}.md\\:card{@media (max-width:100px){width:200px}}</style></head><body style="margin:0">
        <div class="card md:card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // `.md\:card` is one plain class whose name contains a literal colon
      // (every Tailwind variant is spelled this way). Reading the escaped
      // `:` as a pseudo-class rejected the selector from the allowlist —
      // and a rejected selector is skipped, not masked — so its nested
      // responsive width never masked the top-level match.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "masks a match inside a grouping construct this walk has no named case for (@starting-style)",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>@starting-style {.card{width:200px}} .card{width:320px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // @starting-style is a real, engine-supported grouping construct this
      // walk names no explicit case for. An `instanceof`-based classifier
      // only recognizes constructors it was written against, so a construct
      // added after the fact falls through as "harmless" and hides a
      // competing declaration. Duck-typing by shape (cssRules, no
      // selectorText) covers it without a matching update.
      expect(styles?.width).toBeUndefined();
    },
  );

  it(
    "ignores @font-face as harmless, still carrying the plain rule it sits beside",
    { timeout: 30_000 },
    async () => {
      const html = `<!doctype html><html><head><style>@font-face{font-family:"x";src:url(data:font/woff2;base64,)}.card{width:320px}</style></head><body style="margin:0">
        <div class="card" data-agent-native-node-id="card"></div>
      </body></html>`;
      const styles = await portableStyleSnapshotStylesFor(
        html,
        '[data-agent-native-node-id="card"]',
      );
      // @font-face cannot declare a `width` matching an arbitrary element via
      // a selector — it has no `cssRules` and no `selectorText`/`style`, so
      // it must be ignored outright rather than masking the plain match.
      expect(styles?.width).toBe("320px");
    },
  );
});
