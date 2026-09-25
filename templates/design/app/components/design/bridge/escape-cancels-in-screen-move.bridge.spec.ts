import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Escape mid-drag must cancel an in-screen absolute-position move. The
 * host's Escape handler learns of an active drag, and cancels it, through an
 * async postMessage in each direction — but the native mouseup that ends the
 * SAME gesture is dispatched directly to this document and reliably finishes
 * (removing the gesture's own listeners and committing) before that async
 * cancel message is even delivered here. This drives the exact message
 * sequence a real Escape-during-drag produces, timed so the cancel arrives
 * AFTER the commit, and asserts the commit gets reverted rather than the
 * cancel silently finding nothing left to cancel.
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
  <div data-agent-native-node-id="box-a"
       style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
</body></html>`;

describe("Escape mid-drag cancels an in-screen move even when it loses the postMessage race", () => {
  it("reverts a commit that already landed before the cancel message arrived", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const committed: Record<string, string>[] = [];
      await page.exposeFunction(
        "__pushCommit",
        (styles: Record<string, string>) => committed.push(styles),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as {
            type?: string;
            styles?: Record<string, string>;
          };
          if (data?.type === "visual-style-change") {
            (window as any).__pushCommit(data.styles);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      // Select Box A directly (no need for the click-select path here).
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      // Escape is physically pressed just before the mouseup — captured here
      // as the host would, at the real keydown — even though, per the race
      // this test drives, the message carrying it won't arrive until after
      // the mouseup below has already committed.
      const pressedAt = await page.evaluate(() => Date.now());
      // The real mouseup that ends the gesture — dispatched directly, and in
      // production this finishes (commits) before the host's async
      // "cancel-active-drag" reply for an Escape pressed around now would
      // arrive.
      await page.mouse.up();
      await page.waitForTimeout(30);

      expect(
        committed[committed.length - 1]?.left,
        "the drag must have committed AWAY from the start position first, or this test proves nothing about the race",
      ).not.toBe("30px");

      // The cancel arrives AFTER that commit — exactly the losing order a
      // real Escape-then-mouseup produces — but it is stamped with the
      // (earlier) moment Escape was actually pressed, so it must still win.
      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, pressedAt);
      await page.waitForTimeout(30);

      expect(
        committed[committed.length - 1],
        "a cancel that arrives after the commit must still revert it",
      ).toMatchObject({ left: "30px", top: "280px" });

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(domPosition).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  });

  it("does nothing when no drag is active", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        window.postMessage({ type: "agent-native:cancel-active-drag" }, "*");
      });
      await page.waitForTimeout(30);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("a normal (non-racing) Escape mid-drag still cancels the move", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      // The cancel arrives WHILE the gesture is still active (the ordinary
      // case, message beats mouseup) — always worked, kept as a baseline
      // alongside the race case above.
      await page.evaluate(() => {
        window.postMessage({ type: "agent-native:cancel-active-drag" }, "*");
      });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(domPosition).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  });

  it("physically pressing Escape during a same-frame drag cancels before release", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.mouse.up();

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(domPosition).toEqual({ left: "30px", top: "280px" });
    } finally {
      await browser.close();
    }
  });

  it("does not revert a completed drag from an unrelated Escape reaching the local (focus-in-iframe) path after mouseup", async () => {
    // Guards the fix's own failure mode: reusing the shared activeDragCancel
    // slot for the grace window would let ANY later Escape — routed through
    // this document's own keydown listener, which runs whenever focus
    // happens to sit here, independent of the host round-trip — undo an
    // already-finished, unrelated gesture. The local keydown path keeps
    // calling cancelActiveBridgeDrag() directly, which never consults the
    // grace slot, so it must find nothing to cancel here.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const afterCommit = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterCommit).not.toBe("30px");

      // Focus sits in this single document (no real iframe here), so this
      // keypress is delivered straight to the bridge's own keydown listener
      // — the local, synchronous path, not the async host message.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(
        domPosition.left,
        "an unrelated Escape after the drag already committed must not revert it",
      ).not.toBe("30px");
    } finally {
      await browser.close();
    }
  });

  it("does not revert a completed drag from a host cancel-message whose Escape was pressed genuinely after the mouseup", async () => {
    // The regression this guards: the grace window above exists so a cancel
    // whose Escape predates the mouseup still wins even though its message
    // arrives late. But "the message arrived after the commit" is also true
    // of an Escape a user presses well AFTER the drag is already done and
    // released (the host-focus case) — that one must NOT revert. Only the
    // pressedAt-vs-releasedAt comparison tells these apart; message order
    // alone cannot.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const afterCommit = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterCommit).not.toBe("30px");

      // Escape is pressed here, strictly after the mouseup and its commit
      // above — still well inside the 200ms grace window when the message
      // arrives, so the grace window alone would wrongly revert this.
      const pressedAt = await page.evaluate(() => Date.now());
      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, pressedAt);
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({
          left: el.style.left,
          top: el.style.top,
        }));
      expect(
        domPosition.left,
        "an Escape pressed after the drag already released must not revert it",
      ).not.toBe("30px");
    } finally {
      await browser.close();
    }
  });

  it("a stale cancel for gesture A does not revert it once a new gesture has started", async () => {
    // The gesture-identity guard: pendingMoveCommitRevert is cleared the
    // moment ANY new interaction begins, so a late-arriving cancel meant for
    // the gesture that just committed cannot reach back and undo it once the
    // user has already moved on to something else.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      // Gesture A: commits, arming its own grace-revert window.
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(200, 380, { steps: 6 });
      await page.waitForTimeout(20);
      await page.mouse.up();
      await page.waitForTimeout(20);
      const afterA = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterA, "gesture A must have moved the box").not.toBe("30px");

      // A new interaction begins — even just a click, not another drag —
      // before A's 200ms grace window elapses.
      await page.mouse.move(500, 500);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(20);

      // A's stale cancel now arrives. With no gesture left armed for it, it
      // must find nothing to revert.
      await page.evaluate(() => {
        window.postMessage({ type: "agent-native:cancel-active-drag" }, "*");
      });
      await page.waitForTimeout(20);

      const finalLeft = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(
        finalLeft,
        "A's own stale cancel must not revert A after the user moved on",
      ).toBe(afterA);
    } finally {
      await browser.close();
    }
  });

  it("a same-tick release and Escape (equal timestamps) does not revert", async () => {
    // Strict "<" only: a tie means Escape did not predate the release, so it
    // must not revert an already-committed drag.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      // A window-level capture listener runs BEFORE the bridge's own
      // document-level capture listener (capture propagates window→document→
      // …→target), so this observes the SAME mouseup event object the bridge
      // uses for its releasedAt stamp, letting the test reconstruct an exact
      // tie without reaching into bridge internals.
      await page.evaluate(() => {
        // The gesture may be tracked as "mouseup" or "pointerup" depending on
        // which event type initiated it (see dragEventNames) — capture
        // whichever actually fires so this observes the real event the
        // bridge used, not an assumption about its name.
        var capture = (e: Event) => {
          (window as any).__capturedReleaseTimeStamp = e.timeStamp;
        };
        window.addEventListener("mouseup", capture, true);
        window.addEventListener("pointerup", capture, true);
      });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(290, 420, { steps: 8 });
      await page.waitForTimeout(30);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const afterCommit = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterCommit).not.toBe("30px");

      // The exact same event creation time the bridge stamped releasedAt
      // with — a genuine tie, not an approximation.
      const tiedPressedAt = await page.evaluate(
        () =>
          performance.timeOrigin + (window as any).__capturedReleaseTimeStamp,
      );
      expect(typeof tiedPressedAt).toBe("number");
      expect(Number.isNaN(tiedPressedAt)).toBe(false);
      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, tiedPressedAt);
      await page.waitForTimeout(30);

      const domPosition = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => ({ left: el.style.left }));
      expect(
        domPosition.left,
        "a tied pressedAt/releasedAt must not revert the commit",
      ).not.toBe("30px");
    } finally {
      await browser.close();
    }
  });

  it("a delayed cancel for gesture A arriving after gesture B has already started does not cancel B", async () => {
    // The round-2 identity guard: cancelActiveBridgeDragOrPendingCommit must
    // check the ACTIVE gesture's own start time against pressedAt before
    // touching it — otherwise a stale cancel meant for A, delivered late,
    // cancels whatever gesture B is active by the time it arrives.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="box-a"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);

      // Gesture A: mid-drag (not yet released) when its stale Escape is
      // pressed.
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(150, 350, { steps: 4 });
      await page.waitForTimeout(20);
      const staleAPressedAt = await page.evaluate(() => Date.now());
      // A releases and commits before its own stale cancel message arrives.
      await page.mouse.up();
      await page.waitForTimeout(20);
      const afterA = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(afterA, "gesture A must have moved the box").not.toBe("30px");

      // Gesture B starts (a new, independent drag) strictly after A's stale
      // Escape was pressed, and is still ACTIVELY dragging (no mouseup yet)
      // when A's cancel finally arrives.
      await page.mouse.move(150, 350);
      await page.mouse.down();
      await page.mouse.move(250, 400, { steps: 6 });
      await page.waitForTimeout(20);
      const duringB = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(duringB, "gesture B must be actively dragging").not.toBe(afterA);

      // A's delayed cancel finally arrives while B is still active.
      await page.evaluate((stamp) => {
        window.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt: stamp },
          "*",
        );
      }, staleAPressedAt);
      await page.waitForTimeout(20);

      // B must still be live and draggable — not cancelled out from under
      // the user — so releasing it now must commit B's own position, not
      // revert to A's.
      await page.mouse.up();
      await page.waitForTimeout(20);
      const afterB = await page
        .locator('[data-agent-native-node-id="box-a"]')
        .evaluate((el: HTMLElement) => el.style.left);
      expect(
        afterB,
        "A's stale, delayed cancel must not cancel gesture B",
      ).toBe(duringB);
    } finally {
      await browser.close();
    }
  });
});
