// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagramRead } from "./diagram.js";
import { setWireframeStyle } from "./wireframe-kit.js";

describe("DiagramBlock expand affordance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setWireframeStyle("sketchy");
    document.documentElement.classList.remove("dark");
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
    document.documentElement.classList.remove("dark");
    setWireframeStyle("sketchy");
    vi.unstubAllGlobals();
  });

  const expandButton = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand diagram"]',
    );

  const styleButton = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to clean diagrams"], button[aria-label="Switch to hand-drawn diagrams"]',
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

  it("renders a contextual style toggle for the html/css variant", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-style"
          ctx={{ sanitizeHtml: (html: string) => html }}
          data={{ html: "<div class='diagram-node'>Service</div>" }}
        />,
      );
    });

    const button = styleButton();
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-label")).toBe("Switch to clean diagrams");
    expect(button?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(styleButton()?.getAttribute("aria-label")).toBe(
      "Switch to hand-drawn diagrams",
    );
    expect(styleButton()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders html diagrams with the dark theme marker when the document is dark", () => {
    document.documentElement.classList.add("dark");

    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-dark"
          ctx={{ sanitizeHtml: (html: string) => html }}
          data={{
            html: [
              "<div class='diagram-card' data-rough><strong>Service</strong></div>",
              "<div class='diagram-box'>Queue</div>",
            ].join(""),
          }}
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(".plan-diagram-frame");

    expect(frame?.getAttribute("data-theme")).toBe("dark");
    expect(frame?.querySelector(".diagram-card[data-rough]")).toBeTruthy();
    expect(frame?.querySelector(".diagram-box")).toBeTruthy();
  });

  it("keeps standard diagram primitives on a visible dark-mode border token", () => {
    const css = readFileSync("src/styles/blocks.css", "utf8");

    expect(css).toMatch(
      /\.plan-diagram-frame\[data-theme="dark"\]\s*{[^}]*--wf-diagram-line:\s*color-mix\([^}]*var\(--wf-sketch\)[^}]*var\(--wf-line\)/s,
    );
    expect(css).toMatch(
      /:is\(\.diagram-panel,\s*\.diagram-card,\s*\.diagram-node,\s*\.diagram-box\)\s*{\s*--rough-stroke:\s*var\(--wf-diagram-line\);\s*border:\s*1\.25px solid var\(--wf-diagram-line\);/s,
    );
    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\s*\.diagram-pill,[^}]*--rough-stroke:\s*var\(--wf-diagram-line\);/s,
    );
    expect(css).toMatch(
      />\s*\.diagram-panel:not\(\[data-rough\]\):not\(\[data-diagram-frame\]\)/,
    );
    expect(css).toMatch(
      /\.plan-diagram-frame\[data-rough-ready\][^}]*\.plan-diagram-frame-content[^}]*>\s*\.diagram-panel:not\(\[data-rough\]\):not\(\[data-diagram-frame\]\)\s*{\s*border-color:\s*transparent !important;/s,
    );
    expect(css).not.toMatch(
      />\s*:is\(\.diagram-panel,\s*\.diagram-card,\s*\.diagram-box\):not\(\[data-rough\]\)/,
    );
  });

  it("forces html diagram primitive labels to wrap inside their boxes", () => {
    const css = readFileSync("src/styles/blocks.css", "utf8");

    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\s*\.diagram-panel,[^}]*\[class\*="box"\]\s*\)\s*{[^}]*overflow-wrap:\s*anywhere !important;[^}]*white-space:\s*normal !important;/s,
    );
    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\s*\.diagram-panel,[^}]*\)\s+:is\(h1,\s*h2,\s*h3,\s*p,\s*small,\s*strong,\s*span,\s*li\)\s*{[^}]*overflow-wrap:\s*anywhere !important;[^}]*white-space:\s*normal !important;/s,
    );
    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\.diagram-pill,[^}]*\)\s*{[^}]*flex-wrap:\s*wrap;[^}]*white-space:\s*normal !important;/s,
    );
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
    expect(styleButton()).toBeNull();
  });

  it("lets long legacy sequence edge labels wrap instead of truncating", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-sequence-wrap"
          ctx={{}}
          data={{
            nodes: [
              { id: "start", label: "Authenticated shell" },
              { id: "guard", label: "Sign-in guard" },
            ],
            edges: [
              {
                from: "start",
                to: "guard",
                label: "already on /_agent-native/sign-in",
              },
            ],
          }}
        />,
      );
    });

    const label = Array.from(container.querySelectorAll("span")).find((node) =>
      node.textContent?.includes("/_agent-native/sign-in"),
    );

    expect(label?.className).toContain("whitespace-normal");
    expect(label?.className).toContain("[overflow-wrap:anywhere]");
    expect(label?.className).not.toContain("truncate");
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

  it("mirrors positioned legacy graph nodes for RTL documents", () => {
    act(() => {
      root.render(
        <DiagramRead
          blockId="diagram-rtl"
          ctx={{ textDirection: "rtl" }}
          data={{
            nodes: [
              { id: "client", label: "Client", x: 6, y: 8 },
              { id: "created", label: "201 Created", x: 82, y: 8 },
            ],
            edges: [{ from: "client", to: "created" }],
          }}
        />,
      );
    });

    const sketch = container.querySelector<HTMLElement>(".plan-sketch");
    const client = Array.from(
      container.querySelectorAll<HTMLElement>("article"),
    ).find((node) => node.textContent?.includes("Client"));
    const created = Array.from(
      container.querySelectorAll<HTMLElement>("article"),
    ).find((node) => node.textContent?.includes("201 Created"));

    expect(sketch?.getAttribute("dir")).toBe("rtl");
    expect(client?.style.left).toBe("86%");
    expect(Number.parseFloat(client?.style.left ?? "0")).toBeGreaterThan(
      Number.parseFloat(created?.style.left ?? "0"),
    );
  });
});
