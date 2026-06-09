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

  it("renders a JSONC (commented) example with the JSON explorer", () => {
    // The second endpoint in a recap often carries example bodies annotated with
    // `//` comments. Those must still earn the collapsible explorer (comments are
    // stripped before parsing) — not the plain code fallback.
    act(() => {
      root.render(
        <ApiEndpointRead
          blockId="api-jsonc"
          ctx={{}}
          data={{
            method: "POST",
            path: "/_agent-native/actions/update-visual-plan",
            request: {
              contentType: "application/json",
              example: [
                "{",
                "  // the plan to update",
                '  "planId": "plan_123",',
                '  "homepage": "https://example.com", // not a comment',
                '  "blocks": ["columns", "tabs"], // trailing comma below is fine',
                "}",
              ].join("\n"),
            },
          }}
        />,
      );
    });

    const endpointToggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded='false']",
    );
    act(() => {
      endpointToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // Explorer chrome present, comment text gone, but a `//` INSIDE a string is
    // preserved (the URL value survives intact).
    expect(container.textContent).toContain("Expand all");
    expect(container.textContent).toContain('"planId"');
    expect(container.textContent).toContain('"blocks"');
    expect(container.textContent).toContain("https://example.com");
    expect(container.textContent).not.toContain("the plan to update");
    // No plain `<pre>` fallback — JSONC resolved to the explorer.
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders a non-JSON example in the shared code surface, not a bare pre box", () => {
    // A genuinely non-JSON / non-parseable example falls back to a code surface
    // that MATCHES the explorer chrome (single rounded `bg-plan-code` box with a
    // scrollable `<pre>`), so it never looks like a differently-styled box.
    act(() => {
      root.render(
        <ApiEndpointRead
          blockId="api-text"
          ctx={{}}
          data={{
            method: "GET",
            path: "/health",
            responses: [
              {
                status: "200",
                example: "OK — service healthy (not json)",
              },
            ],
          }}
        />,
      );
    });

    const endpointToggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded='false']",
    );
    act(() => {
      endpointToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const surface = container.querySelector("[data-code-surface]");
    expect(surface).toBeTruthy();
    // Same surface tokens as the explorer box (no extra background tint).
    expect(surface?.classList.contains("bg-plan-code")).toBe(true);
    expect(surface?.classList.contains("rounded-xl")).toBe(true);
    // Body scrolls horizontally rather than clipping/overflowing.
    const pre = surface?.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.className).toContain("overflow-x-auto");
    expect(pre?.textContent).toContain("not json");
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
