// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentNativeExtensionFrame,
  AgentNativeExtensionSlot,
} from "./AgentNativeExtensionFrame.js";

describe("AgentNativeExtensionFrame", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders extension content into a sandboxed srcdoc iframe", async () => {
    await act(async () => {
      root.render(
        <AgentNativeExtensionFrame
          extension={{
            id: "ext-1",
            name: "Customer panel",
            content: "<section>Customer health</section>",
          }}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-popups allow-downloads",
    );
    expect(iframe?.getAttribute("srcdoc")).toContain(
      "<section>Customer health</section>",
    );
  });

  it("renders one iframe per extension in a portable slot", async () => {
    await act(async () => {
      root.render(
        <AgentNativeExtensionSlot
          id="crm.sidebar"
          extensions={[
            { id: "ext-1", name: "One", content: "<p>One</p>" },
            { id: "ext-2", name: "Two", content: "<p>Two</p>" },
          ]}
          context={{ customerId: "cus_123" }}
        />,
      );
    });

    const frames = Array.from(container.querySelectorAll("iframe"));
    expect(frames).toHaveLength(2);
    expect(frames[0].getAttribute("srcdoc")).toContain("cus_123");
    expect(frames[1].getAttribute("srcdoc")).toContain("<p>Two</p>");
  });

  it("does not render extensions into slots outside their manifest", async () => {
    await act(async () => {
      root.render(
        <AgentNativeExtensionSlot
          id="crm.sidebar"
          extensions={[
            {
              id: "ext-1",
              name: "Allowed",
              content: "<p>Allowed</p>",
              manifest: { slots: ["crm.sidebar"] },
            },
            {
              id: "ext-2",
              name: "Blocked",
              content: "<p>Blocked</p>",
              manifest: { slots: ["billing.sidebar"] },
            },
          ]}
        />,
      );
    });

    const frames = Array.from(container.querySelectorAll("iframe"));
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute("srcdoc")).toContain("<p>Allowed</p>");
    expect(frames[0].getAttribute("srcdoc")).not.toContain("<p>Blocked</p>");
  });
});
