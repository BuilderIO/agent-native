// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresenceBar } from "./PresenceBar.js";

describe("PresenceBar", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gives the integrated AI editing label space after the avatar", () => {
    act(() => {
      root.render(
        <PresenceBar
          activeUsers={[]}
          agentPresent
          agentActive
          showAgentEditingDot={false}
        />,
      );
    });

    const label = Array.from(container.querySelectorAll("span")).find(
      (element) => element.textContent === "AI editing",
    );
    expect(label?.style.padding).toBe("0px 0px 0px 2px");
  });
});
