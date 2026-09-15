// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendContentSizeReporter } from "./content-size-report";

/**
 * The reporter's MutationObserver watches the whole document subtree with
 * `attributes: true`. Editor chrome (hover ring, selection box, measurement
 * labels) lives in that subtree: the hover ring is repositioned on every
 * pointermove, and measure() hides and restores every chrome node to take a
 * chrome-free reading. Observing either let the reporter re-arm from its own
 * writes, so a single mutation reflowed the whole document every frame for as
 * long as the cursor stayed over the canvas. Chrome is not content and must
 * not drive this loop.
 */

/** Pulls the reporter IIFE out of the injected markup so it runs for real
 *  instead of being asserted as a string. */
function reporterSource(): string {
  const html = appendContentSizeReporter("<html><body></body></html>");
  const match =
    /<script data-agent-native-content-size-bridge>([\s\S]*?)<\/script>/.exec(
      html,
    );
  if (!match) throw new Error("reporter script not found in injected markup");
  return match[1]!;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** High enough that a live feedback loop pins the counter to it rather than
 *  settling, which is how the pre-fix behavior reads in a failure message. */
const FRAME_BUDGET = 200;

describe("content-size reporter ignores editor-chrome mutations", () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let scheduled: number;
  let pending: FrameRequestCallback[];
  // Each test re-runs the reporter against the same documentElement, so its
  // observers must be torn down or the previous test's copy keeps measuring.
  let observers: Array<{ disconnect: () => void }>;
  const RealMutationObserver = globalThis.MutationObserver;
  const RealResizeObserver = globalThis.ResizeObserver;

  /** Runs whatever the reporter queued, the way real frames would, so the
   *  measurement's own chrome writes land inside the flush. */
  async function flushFrames(): Promise<void> {
    for (let i = 0; i < FRAME_BUDGET && pending.length > 0; i += 1) {
      const batch = pending;
      pending = [];
      for (const cb of batch) cb(0);
      await flushMicrotasks();
    }
  }

  beforeEach(async () => {
    document.documentElement.innerHTML =
      "<head></head><body><main>authored content</main></body>";
    delete (window as unknown as Record<string, unknown>)
      .__agentNativeContentSizeReport;
    scheduled = 0;
    pending = [];
    observers = [];
    globalThis.MutationObserver = class extends RealMutationObserver {
      constructor(cb: MutationCallback) {
        super(cb);
        observers.push(this);
      }
    };
    globalThis.ResizeObserver = class extends RealResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        super(cb);
        observers.push(this);
      }
    };
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(((
      cb: FrameRequestCallback,
    ) => {
      scheduled += 1;
      pending.push(cb);
      return scheduled;
    }) as unknown as typeof window.requestAnimationFrame);
    (0, eval)(reporterSource());
    await flushFrames();
  });

  afterEach(() => {
    for (const observer of observers) observer.disconnect();
    globalThis.MutationObserver = RealMutationObserver;
    globalThis.ResizeObserver = RealResizeObserver;
    rafSpy.mockRestore();
    delete (window as unknown as Record<string, unknown>)
      .__agentNativeContentSizeReport;
  });

  /** The editor chrome bridge appends these to every live canvas iframe. */
  async function addChromeOverlay(): Promise<HTMLElement> {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-agent-native-edit-overlay", "highlight");
    overlay.setAttribute("style", "position:fixed;display:none;");
    document.body.appendChild(overlay);
    await flushMicrotasks();
    await flushFrames();
    return overlay;
  }

  it("does not let hover-ring movement drive measurement work", async () => {
    const overlay = await addChromeOverlay();

    /** One pointermove worth of hover-ring repositioning — what
     *  positionOverlay() writes for each newly hovered element. */
    async function hoverSweep(moves: number): Promise<number> {
      const before = scheduled;
      for (let i = 0; i < moves; i += 1) {
        overlay.setAttribute(
          "style",
          `position:fixed;display:block;top:${i}px;left:${i}px;width:120px;height:40px;`,
        );
        await flushMicrotasks();
      }
      await flushFrames();
      return scheduled - before;
    }

    const first = await hoverSweep(100);
    const second = await hoverSweep(400);

    // The invariant: measurement cost must not scale with cursor movement.
    // Pre-fix each move re-armed the reporter, so both sweeps pinned the frame
    // budget and the document reflowed on every frame the cursor was moving.
    expect(second).toBe(first);
    expect(first).toBeLessThanOrEqual(1);
    expect(pending).toHaveLength(0);
  });

  it("settles after one content change instead of re-arming from its own chrome writes", async () => {
    await addChromeOverlay();
    const before = scheduled;

    document.body.appendChild(document.createElement("p"));
    await flushMicrotasks();
    await flushFrames();

    expect(scheduled - before).toBe(1);
    // A surviving queued frame means the loop is still running.
    expect(pending).toHaveLength(0);
  });

  it("still measures when authored content is added", async () => {
    await addChromeOverlay();
    const before = scheduled;

    const content = document.createElement("section");
    content.textContent = "real content";
    document.body.appendChild(content);
    await flushMicrotasks();
    await flushFrames();

    expect(scheduled - before).toBe(1);
  });

  it("still measures when a non-chrome element's style changes", async () => {
    await addChromeOverlay();
    const content = document.createElement("section");
    document.body.appendChild(content);
    await flushMicrotasks();
    await flushFrames();
    const before = scheduled;

    content.setAttribute("style", "height:500px");
    await flushMicrotasks();
    await flushFrames();

    expect(scheduled - before).toBe(1);
  });

  it("still measures when authored text changes", async () => {
    await addChromeOverlay();
    const main = document.querySelector("main")!;
    const before = scheduled;

    main.textContent = "changed";
    await flushMicrotasks();
    await flushFrames();

    expect(scheduled - before).toBe(1);
  });
});
