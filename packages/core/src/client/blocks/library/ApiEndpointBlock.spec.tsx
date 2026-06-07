// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiEndpointRead } from "./ApiEndpointBlock.js";

describe("ApiEndpointBlock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders JSON request and response examples with the JSON explorer", () => {
    act(() => {
      root.render(
        <ApiEndpointRead
          blockId="api-1"
          ctx={{}}
          data={{
            method: "POST",
            path: "/_agent-native/actions/create-visual-plan",
            request: {
              contentType: "application/json",
              example: JSON.stringify({
                title: "Visual recap",
                content: {
                  blocks: ["columns", "diagram", "tabs"],
                },
              }),
            },
            responses: [
              {
                status: "200",
                example: JSON.stringify({
                  planId: "plan_123",
                  url: "/plans/plan_123",
                }),
              },
            ],
          }}
        />,
      );
    });

    const endpointToggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded='false']",
    );
    expect(endpointToggle).toBeTruthy();

    act(() => {
      endpointToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain("Expand all");
    expect(container.textContent).toContain("Collapse all");
    expect(container.textContent).toContain('"title"');
    expect(container.textContent).toContain('"content"');
    expect(container.textContent).toContain('"blocks"');
    expect(container.textContent).not.toContain('"diagram"');
    expect(container.querySelector("pre")).toBeNull();
  });
});
