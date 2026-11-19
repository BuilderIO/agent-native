// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { AGENT_NAVIGATE_MESSAGE_TYPE, postNavigate } from "./embed.js";

describe("postNavigate", () => {
  it("uses client-side history navigation instead of location.href when not embedded", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const popStateSpy = vi.fn();
    window.addEventListener("popstate", popStateSpy);

    const initialHref = window.location.href;
    postNavigate("/inbox/thread-42");

    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/inbox/thread-42");
    expect(popStateSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/inbox/thread-42");
    expect(window.location.href).not.toBe(initialHref);

    window.removeEventListener("popstate", popStateSpy);
    pushStateSpy.mockRestore();
  });

  it("posts a message to the parent window when embedded in an iframe", () => {
    const postMessage = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage },
    });

    try {
      postNavigate("/sent/thread-99");
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: AGENT_NAVIGATE_MESSAGE_TYPE,
          path: "/sent/thread-99",
        },
        window.location.origin,
      );
    } finally {
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
    }
  });
});
