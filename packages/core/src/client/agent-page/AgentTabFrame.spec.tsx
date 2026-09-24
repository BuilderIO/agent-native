// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTabFrame } from "./AgentTabFrame.js";

describe("AgentTabFrame", () => {
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
    vi.unstubAllGlobals();
  });

  it("places a documentation link immediately beside the page title", () => {
    act(() => {
      root.render(
        <AgentTabFrame
          title="Files"
          description="Files the agent can read and write."
          helpHref="https://agent-native.com/docs/agent-resources#resources-tab"
          helpLabel="Open Files documentation"
        >
          <div>Content</div>
        </AgentTabFrame>,
      );
    });

    const heading = container.querySelector("h2");
    const link = heading?.nextElementSibling as HTMLAnchorElement | null;
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe(
      "https://agent-native.com/docs/agent-resources#resources-tab",
    );
    expect(link?.getAttribute("aria-label")).toBe("Open Files documentation");
  });
});
