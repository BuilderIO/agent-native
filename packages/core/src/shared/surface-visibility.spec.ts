// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";

import {
  SURFACE_HIDDEN_FLAG,
  SURFACE_VISIBILITY_EVENT,
  addSurfaceVisibilityListener,
  buildSurfaceVisibilityScript,
  isHostSurfaceHidden,
  isSurfaceHidden,
} from "./surface-visibility.js";

function setDocumentVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("surface visibility", () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
    setDocumentVisibility("visible");
  });

  it("reports visible when neither signal says otherwise", () => {
    expect(isHostSurfaceHidden()).toBe(false);
    expect(isSurfaceHidden()).toBe(false);
  });

  it("honors the host flag even while the document claims visible", () => {
    // This is the whole point: an Electron <webview> guest keeps reporting
    // visibilityState "visible" while its element is display:none.
    (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = true;
    expect(isHostSurfaceHidden()).toBe(true);
    expect(isSurfaceHidden()).toBe(true);
  });

  it("still honors document visibility when no host has spoken", () => {
    setDocumentVisibility("hidden");
    expect(isHostSurfaceHidden()).toBe(false);
    expect(isSurfaceHidden()).toBe(true);
  });

  it("notifies listeners for both signals and unsubscribes cleanly", () => {
    let calls = 0;
    const stop = addSurfaceVisibilityListener(() => {
      calls += 1;
    });

    window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toBe(2);

    stop();
    window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toBe(2);
  });

  it("builds a script that sets the flag and announces the change once", () => {
    let events = 0;
    addSurfaceVisibilityListener(() => {
      events += 1;
    });

    expect(eval(buildSurfaceVisibilityScript(true))).toBe(true);
    expect(isHostSurfaceHidden()).toBe(true);
    expect(events).toBe(1);

    // Re-declaring the same state must not churn subscribers.
    expect(eval(buildSurfaceVisibilityScript(true))).toBe(true);
    expect(events).toBe(1);

    expect(eval(buildSurfaceVisibilityScript(false))).toBe(false);
    expect(isHostSurfaceHidden()).toBe(false);
    expect(events).toBe(2);
  });
});
