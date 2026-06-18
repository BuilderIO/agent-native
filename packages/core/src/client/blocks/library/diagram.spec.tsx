// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramRead } from "./diagram.js";

describe("DiagramBlock expand affordance", () => {
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
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  const expandButton = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand diagram"]',
    );

  const lightbox = () =>
    document.body.querySelector<HTMLElement>('[role="dialog"]');

  it("renders a hover-revealed expand control for the html/css variant", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-1"
          ctx={{ sanitizeHtml: (html: string) => html }}
          data={{ html: "<div class='diagram-node'>Service</div>" }}
        />,
      );
    });

    expect(expandButton()).toBeTruthy();
    expect(lightbox()).toBeNull();
  });

  it("renders the expand control for the legacy node-graph variant", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-2"
          ctx={{}}
          data={{
            nodes: [
              { id: "n1", label: "Client" },
              { id: "n2", label: "Server" },
            ],
            edges: [{ from: "n1", to: "n2" }],
          }}
        />,
      );
    });

    expect(expandButton()).toBeTruthy();
  });

  it("opens a lightbox on click and closes it on Escape", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-3"
          ctx={{ sanitizeHtml: (html: string) => html }}
          data={{ html: "<div class='diagram-node'>Service</div>" }}
        />,
      );
    });

    expect(lightbox()).toBeNull();

    act(() => {
      expandButton()?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const overlay = lightbox();
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
    expect(
      overlay?.querySelector('button[aria-label="Close preview"]'),
    ).toBeTruthy();
    // The same diagram content is re-rendered larger inside the overlay.
    expect(overlay?.textContent).toContain("Service");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(lightbox()).toBeNull();
  });

  it("closes the lightbox when the backdrop is clicked", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-4"
          ctx={{ sanitizeHtml: (html: string) => html }}
          data={{ html: "<div class='diagram-node'>Service</div>" }}
        />,
      );
    });

    act(() => {
      expandButton()?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const overlay = lightbox();
    expect(overlay).toBeTruthy();

    act(() => {
      overlay?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(lightbox()).toBeNull();
  });

  it("keeps edge-positioned legacy graph nodes inside the frame without row overlap", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-5"
          ctx={{}}
          data={{
            nodes: [
              { id: "client", label: "Client", x: 6, y: 8 },
              { id: "duplicate", label: "duplicateProject()", x: 42, y: 8 },
              { id: "created", label: "201 Created", x: 82, y: 8 },
              { id: "token", label: "auth token present?", x: 42, y: 36 },
              { id: "turn", label: "runFormsTurn", x: 42, y: 63 },
              { id: "deploy", label: "build + deploy clone", x: 82, y: 87 },
            ],
            edges: [
              { from: "client", to: "duplicate" },
              { from: "duplicate", to: "created", label: "respond now" },
              { from: "duplicate", to: "token" },
              { from: "token", to: "turn" },
              { from: "turn", to: "deploy", label: "compile + publish" },
            ],
          }}
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(".plan-sketch > div");
    const client = Array.from(
      container.querySelectorAll<HTMLElement>("article"),
    ).find((node) => node.textContent?.includes("Client"));

    expect(frame?.style.minHeight).toBe("880px");
    expect(client?.style.left).toBe("14%");
    expect(client?.style.top).toBe("18%");
  });
});
