import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";

/**
 * Figma parity (unique-paths: "holding Space mid-drag keeps an element a
 * sibling"): holding Space while dragging must suppress reparenting into
 * whatever container the pointer passes over.
 *
 * Three compounding bugs, all in the reorder gesture's Space tracking:
 * 1. The bridge's global keydown/keyup listeners (registered at bridge init,
 *    BEFORE any drag starts) intercepted Space while a drag was active via
 *    stopNativeInteraction — which calls stopImmediatePropagation — so the
 *    drag's OWN onReorderKeyDown/KeyUp listeners (registered later, same
 *    document, same capture phase, added when the drag begins) never saw
 *    the event and keepCurrentFlowParent never flipped true at all.
 * 2. onReorderKeyUp reset keepCurrentFlowParent to false the instant Space
 *    was released. onReorderUp (the drop) re-resolves the target fresh from
 *    the release point instead of reusing the last live preview, so
 *    releasing Space just before mouseup with no further pointer move (this
 *    test's exact sequence) read the flag back as false and reparented
 *    anyway, even though Space visibly protected the object for the whole
 *    visible drag.
 * 3. "Keep current parent" resolved to the object's immediate DOM parent
 *    (Row) — but an auto-layout parent cannot host a freely (absolutely)
 *    positioned child at all, so a drag far outside a small auto-layout row
 *    nested inside an ALSO auto-layout screen must escape every auto-layout
 *    ancestor (Row, then the screen's own auto-layout root) up to the
 *    nearest one that isn't, landing as a free sibling of the screen's
 *    top-level wrapper — not literally back inside Row.
 *
 * Runs the real generated bridge in a real browser: flex/box layout and
 * getBoundingClientRect need a real layout engine, not happy-dom's stub.
 */
function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

function embeddedWheelEditModeBridgeScript(): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "false")
    .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
    .replace("__EDITING_SAFETY_ENABLED__", "true");
}

function embeddedWheelInteractModeBridgeScript(): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "false")
    .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "true")
    .replace("__EDITING_SAFETY_ENABLED__", "false");
}

// Mirrors e2e/global-setup.ts's FIXTURE_HTML shape: a flex row holding the
// dragged element, and a bigger container (a section with its own child)
// further down the flow that a plain drag would reparent into.
const FIXTURE = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:16px;padding:24px">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row"
         style="display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha"
           style="width:100px;height:60px;background:#3b82f6"></div>
      <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta"
           style="width:100px;height:60px;background:#22c55e"></div>
    </div>
    <section data-agent-native-node-id="section" data-agent-native-layer-name="Section"
         style="width:300px;height:200px;padding:16px;background:#1a1d24">
      <h2 data-agent-native-node-id="section-title" data-agent-native-layer-name="Section Title"
          style="margin:0">Section Title</h2>
    </section>
  </main>
</body></html>`;

describe("holding Space mid-drag suppresses reparenting", () => {
  it("keeps the dragged element in its original parent instead of nesting it into the section under the pointer", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: embeddedWheelEditModeBridgeScript() });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      // Select Alpha directly, same as ctrl-drag-flex-no-cross-screen's
      // pattern: a click would hit container-first selection instead.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="alpha"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      await page.mouse.move(74, 54);
      await page.mouse.down();
      // Drag well into the section before Space is ever pressed, then hold
      // Space, move further, and release Space BEFORE mouseup with no
      // further pointer move — the exact sequence
      // parity-unique-paths.spec.ts drives, and the one bug #2 above broke.
      await page.mouse.move(174, 150, { steps: 10 });
      await page.keyboard.down("Space");
      await page.mouse.move(174, 200, { steps: 10 });
      await page.keyboard.up("Space");
      await page.mouse.up();
      await page.waitForTimeout(50);

      const dropped = await page.evaluate(() => {
        const node = document.querySelector(
          '[data-agent-native-node-id="alpha"]',
        );
        return {
          exists: !!node,
          insideSection: !!node?.closest("section"),
          insideMain: !!node?.closest("main"),
        };
      });
      expect(dropped.exists).toBe(true);
      expect(dropped.insideSection).toBe(false);
      expect(dropped.insideMain).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it("a stale 'space released' forward arriving after the drag already ended still clears state for the NEXT gesture", async () => {
    // Regression for a real sequence the fixed test above can't reach:
    // release the MOUSE before Space. DesignEditor.tsx's own keyup handler
    // used to check activeEditorDragRef.current — already false by then,
    // since mouseup clears it — and take the temporary-pan branch instead
    // of forwarding "held:false", leaving every preview iframe's
    // bridgeSpaceKeyPressed stuck true forever. The fix tracks whether
    // forwarding was armed at keydown and always undoes it at keyup
    // regardless of activeEditorDragRef's value by then; this spec plays
    // the host's now-guaranteed message directly at the bridge boundary
    // (mouseup, THEN the "held:false" forward) and proves a wholly separate
    // SECOND drag — no Space involved at all — reparents normally
    // afterward instead of inheriting the first gesture's suppression.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="alpha"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);

      // Gesture 1: Space held mid-drag, but the MOUSE releases first —
      // activeEditorDragRef.current is already false by the time the host
      // would see Space's keyup.
      await page.mouse.move(74, 54);
      await page.mouse.down();
      await page.mouse.move(174, 150, { steps: 10 });
      await page.evaluate(() =>
        window.postMessage(
          { type: "agent-native:set-space-held", held: true },
          "*",
        ),
      );
      await page.mouse.move(174, 200, { steps: 10 });
      await page.mouse.up();
      // The fixed host still forwards the matching keyup after the drag
      // ended — play that message directly at the bridge boundary.
      await page.evaluate(() =>
        window.postMessage(
          { type: "agent-native:set-space-held", held: false },
          "*",
        ),
      );
      await page.waitForTimeout(50);

      // Gesture 2: a wholly separate, plain drag with no Space at all —
      // Beta, still in its original row, dropped squarely inside Section.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="beta"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      const betaBox = await page
        .locator('[data-agent-native-node-id="beta"]')
        .boundingBox();
      const sectionBox = await page
        .locator('[data-agent-native-node-id="section"]')
        .boundingBox();
      if (!betaBox || !sectionBox) throw new Error("missing box");
      await page.mouse.move(
        betaBox.x + betaBox.width / 2,
        betaBox.y + betaBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        sectionBox.x + sectionBox.width / 2,
        sectionBox.y + sectionBox.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.waitForTimeout(50);

      const html = await page.content();
      const mainCloseIdx = html.indexOf("</main>");
      const betaIdx = html.indexOf('data-agent-native-node-id="beta"');
      // The precise regression: gesture 1's "keep current parent" escape
      // (Space held) lands the dragged node OUTSIDE </main> entirely (see
      // the first test in this file). A leaked bridgeSpaceKeyPressed would
      // make this second, Space-free gesture do the exact same thing to
      // Beta. Asserting Beta stays INSIDE main — whatever normal reorder
      // slot it lands in — isolates that leak without also re-asserting
      // exactly what a plain reorder-into-a-container resolves to.
      expect(
        betaIdx > 0 && betaIdx < mainCloseIdx,
        `A plain second drag (no Space) must stay inside <main>, not escape it the way gesture 1's Space-held drag did — a leaked keepCurrentFlowParent would do exactly that; html: ${html}`,
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("forwards Space keyup if the frame changes from Interact to Edit while Space is held", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        const chromeHost = document.createElement("div");
        chromeHost.setAttribute("data-agent-native-editor-chrome-host", "");
        document.body.append(chromeHost);
        (window as any).__spaceEvents = [];
        window.addEventListener("message", (event) => {
          if (
            event.data?.type === "design-hotkey" ||
            event.data?.type === "design-hotkey-up"
          ) {
            (window as any).__spaceEvents.push(event.data.type);
          }
        });
      });
      await page.addScriptTag({
        content: embeddedWheelInteractModeBridgeScript(),
      });

      await page.keyboard.down("Space");
      await page.waitForFunction(() =>
        (window as any).__spaceEvents.includes("design-hotkey"),
      );
      await page.evaluate(() =>
        window.postMessage(
          {
            type: "embedded-canvas-gesture-mode",
            wheelEnabled: false,
            spaceKeyForwardingEnabled: false,
            editingSafetyEnabled: true,
          },
          "*",
        ),
      );
      await page.waitForTimeout(20);
      await page.keyboard.up("Space");

      await expect
        .poll(() => page.evaluate(() => (window as any).__spaceEvents))
        .toEqual(["design-hotkey", "design-hotkey-up"]);
    } finally {
      await browser.close();
    }
  });
});
