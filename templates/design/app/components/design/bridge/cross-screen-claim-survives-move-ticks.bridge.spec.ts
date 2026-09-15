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
});
