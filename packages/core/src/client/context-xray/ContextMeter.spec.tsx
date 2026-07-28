// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextManifest } from "../../shared/context-xray.js";

const manifestRef: { current: ContextManifest | undefined } = {
  current: undefined,
};

vi.mock("../use-action.js", () => ({
  useActionQuery: () => ({ data: manifestRef.current }),
  useActionMutation: () => ({ mutate: vi.fn() }),
}));

const { ContextMeter } = await import("./ContextMeter.js");

function manifest(overrides: Partial<ContextManifest> = {}): ContextManifest {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    computedAt: 1000,
    updatedAt: 1000,
    model: "claude-sonnet-4-5",
    totalTokens: 20_000,
    rawTokens: 20_000,
    reclaimedTokens: 0,
    tokenCountMethod: "exact",
    conversationTokens: 20_000,
    systemTokens: 0,
    source: "structured",
    enforceable: true,
    segments: [],
    ...overrides,
  };
}

describe("ContextMeter freshness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    manifestRef.current = undefined;
    vi.unstubAllGlobals();
  });

  const render = () => {
    act(() => {
      root.render(<ContextMeter threadId="thread-1" />);
    });
    return container.querySelector("button");
  };

  it("dims the figure and explains itself when the manifest trails the newest turn", () => {
    manifestRef.current = manifest({
      turnId: "turn-1",
      latestTurnId: "turn-2",
      latestTurnStartedAt: 2000,
    });

    const button = render();

    expect(button?.getAttribute("aria-label")).toContain(
      "Measured on an earlier turn",
    );
    expect(button?.className).toContain("opacity-50");
  });

  it("shows the live figure when the manifest names the newest turn", () => {
    manifestRef.current = manifest({
      turnId: "turn-2",
      latestTurnId: "turn-2",
      latestTurnStartedAt: 2000,
    });

    const button = render();

    expect(button?.getAttribute("aria-label")).not.toContain(
      "Measured on an earlier turn",
    );
    expect(button?.className).not.toContain("opacity-50");
  });

  it("shows an em dash when the manifest write failed", () => {
    manifestRef.current = manifest({
      turnId: "turn-1",
      latestTurnId: "turn-2",
      latestTurnStartedAt: 2000,
      writeStatus: "failed",
    });

    const button = render();

    expect(button?.textContent).toBe("\u2014");
    expect(button?.getAttribute("aria-label")).toContain(
      "Context \u2014, \u2014",
    );
  });
});
