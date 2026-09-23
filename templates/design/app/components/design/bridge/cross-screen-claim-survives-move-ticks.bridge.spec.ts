import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Figma parity (drag-reparent-1): dragging an element across a screen
 * boundary must leave the source screen and land in the destination, never
 * getting stuck committed in place inside the source.
 *
 * Every per-screen preview iframe renders oversized relative to its screen's
 * visible card, so `isOutsideIframeViewport` reads false even while the
 * pointer sits squarely over a DIFFERENT screen — the host's own
 * "agent-native:cross-screen-claim" reply is the only real signal that a
 * destination screen has claimed the drop. That reply is async (a
 * postMessage round trip), but a move tick fires on every animation frame
 * regardless, so the source bridge used to re-derive "am I still claimed?"
 * from the (always-false) `isOutsideIframeViewport` check on each of those
 * ticks and stomp the flag back to false a frame after the host had just set
 * it true — leaving it stale-false at the moment of mouseup on almost every
 * drag, so the element committed locally instead of ceding to the
 * cross-screen drop.
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

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="widget"
       style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

const FLOW_FIXTURE = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:16px;padding:24px">
    <div data-agent-native-node-id="row" style="display:flex;gap:8px">
      <div data-agent-native-node-id="alpha" style="width:100px;height:60px;background:#3b82f6"></div>
      <div data-agent-native-node-id="beta" style="width:100px;height:60px;background:#22c55e"></div>
    </div>
    <section data-agent-native-node-id="section" style="width:300px;height:200px;padding:16px;background:#1a1d24">
      <h2 style="margin:0">Section</h2>
    </section>
  </main>
</body></html>`;

describe("crossScreenClaimedByHost survives the move ticks between claim and release", () => {
  it("does not commit the drag locally once the host has claimed it, even though isOutsideIframeViewport never fires", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      const messages: Array<Record<string, unknown>> = [];
      await page.exposeFunction(
        "__pushMessage",
        (data: Record<string, unknown>) => messages.push(data),
      );
      await page.evaluate(() => {
        // Stand in for the real host's claimCrossScreenDrop: it re-resolves
        // the drop target on every "move" tick but only POSTS a fresh claim
        // message when the claimed value actually changes (MultiScreenCanvas
        // dedupes on crossScreenClaimSentRef) — so once it has claimed the
        // drop, later ticks send no further message to re-affirm it.
        let claimSent: boolean | null = null;
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as { type?: string };
          (window as any).__pushMessage(data);
          if (
            data?.type === "agent-native:cross-screen-drag" &&
            (data as any).phase === "move"
          ) {
            if (claimSent === true) return;
            claimSent = true;
            setTimeout(() => {
              window.postMessage(
                { type: "agent-native:cross-screen-claim", claimed: true },
                "*",
              );
            }, 4);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="widget"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      // Several move ticks, each ~16ms apart (one rAF), well within the
      // window's own bounds — isOutsideIframeViewport is false for every one
      // of these, exactly like a real oversized preview iframe.
      await page.mouse.move(90, 320);
      await page.mouse.down();
      for (const [x, y] of [
        [140, 340],
        [190, 360],
        [240, 380],
        [290, 400],
      ] as const) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(16);
      }
      // Give the last tick's async claim reply time to land before release —
      // the real race this test targets is the RESET on the tick immediately
      // after, not this reply itself arriving late.
      await page.waitForTimeout(20);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const committedLocally = messages.some(
        (m) => m.type === "visual-style-change",
      );
      const cededToHost = messages.some(
        (m) => m.type === "agent-native:cross-screen-drag" && m.phase === "end",
      );
      expect(
        committedLocally,
        `the drag must not commit locally once the host has claimed it: ${JSON.stringify(messages.map((m) => m.type))}`,
      ).toBe(false);
      expect(
        cededToHost,
        "the source must post a cross-screen-drag end for the host to finalize",
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("clears a source S modifier when cross-screen end owns the keyup", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        Object.defineProperty(navigator, "platform", {
          configurable: true,
          value: "Win32",
        });
      });
      const starts: Array<{ ignoreAutoLayout?: boolean }> = [];
      await page.exposeFunction(
        "__pushCrossScreenStart",
        (data: { modifiers?: { ignoreAutoLayout?: boolean } }) =>
          starts.push(data.modifiers ?? {}),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            phase?: string;
            modifiers?: { ignoreAutoLayout?: boolean };
          };
          if (
            data.type === "agent-native:cross-screen-drag" &&
            data.phase === "start"
          ) {
            void (window as any).__pushCrossScreenStart(data);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="widget"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.keyboard.down("s");
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(900, 400, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(150, 360, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      expect(
        starts
          .filter((start) => "ignoreAutoLayout" in start)
          .map((start) => start.ignoreAutoLayout),
      ).toEqual([true, false]);
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it("carries the platform-primary modifier through flow reorder messages", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FLOW_FIXTURE);
      await page.evaluate(() => {
        Object.defineProperty(navigator, "platform", {
          configurable: true,
          value: "MacIntel",
        });
      });
      const messages: Array<Record<string, any>> = [];
      await page.exposeFunction(
        "__pushCrossScreenMessage",
        (data: Record<string, any>) => messages.push(data),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as Record<string, any>;
          if (data.type === "agent-native:cross-screen-drag") {
            void (window as any).__pushCrossScreenMessage(data);
          }
        });
      });
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
      await page.waitForTimeout(30);

      await page.keyboard.down("Meta");
      await page.mouse.move(74, 54);
      await page.mouse.down();
      await page.mouse.move(174, 150, { steps: 6 });
      await page.mouse.move(900, 400, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up("Meta");
      await page.waitForTimeout(30);

      const activeMessages = messages.filter(
        (message) =>
          (message.phase === "start" ||
            message.phase === "move" ||
            message.phase === "end") &&
          message.modifiers,
      );
      expect(activeMessages.length).toBeGreaterThan(0);
      expect(
        activeMessages.every(
          (message) =>
            message.modifiers?.metaKey === true &&
            message.modifiers?.forceNestedAutoLayout === true,
        ),
        JSON.stringify(activeMessages),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("normalizes an epoch-form release timestamp before crossing contexts", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        Object.defineProperty(Event.prototype, "timeStamp", {
          configurable: true,
          get: () => Date.now(),
        });
      });
      let releasedAt: number | undefined;
      await page.exposeFunction(
        "__captureCrossScreenEnd",
        (data: { releasedAt?: number }) => {
          releasedAt = data.releasedAt;
        },
      );
      await page.evaluate(() => {
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            phase?: string;
            releasedAt?: number;
          };
          if (
            data.type === "agent-native:cross-screen-drag" &&
            data.phase === "end"
          ) {
            void (window as any).__captureCrossScreenEnd(data);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="widget"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      const before = Date.now();
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(900, 400, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);
      const after = Date.now();

      expect(releasedAt).toBeGreaterThanOrEqual(before);
      expect(releasedAt).toBeLessThanOrEqual(after);
    } finally {
      await browser.close();
    }
  });
});
