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

  it("tags each endpoint so a run of consecutive endpoints renders flush", () => {
    // Render two endpoints back-to-back the way the document flow does. The tight
    // list look (no divider/gap between adjacent endpoints, merged flush cards)
    // is driven by CSS that keys off `data-block-type="api-endpoint"` on the
    // block section plus the `.an-api-endpoint-card` surface. Assert the renderer
    // emits both markers so consecutive endpoints can be detected and merged —
    // and that there is NO per-block separator element between the two sections.
    act(() => {
      root.render(
        <>
          <ApiEndpointRead
            blockId="api-1"
            ctx={{}}
            data={{ method: "GET", path: "/users", summary: "List users" }}
          />
          <ApiEndpointRead
            blockId="api-2"
            ctx={{}}
            data={{ method: "POST", path: "/users", summary: "Create user" }}
          />
        </>,
      );
    });

    const sections = container.querySelectorAll<HTMLElement>(
      'section[data-block-type="api-endpoint"]',
    );
    expect(sections).toHaveLength(2);
    // Both endpoints expose the run marker and the flush-able card surface.
    sections.forEach((section) => {
      expect(section.classList.contains("plan-block")).toBe(true);
      expect(section.querySelector(".an-api-endpoint-card")).toBeTruthy();
    });
    // The two endpoint sections are immediate siblings — no divider/separator
    // node is injected between them; the run-collapse is purely CSS on the
    // adjacent `data-block-type="api-endpoint"` pair.
    expect(sections[0]?.nextElementSibling).toBe(sections[1]);
  });
});
