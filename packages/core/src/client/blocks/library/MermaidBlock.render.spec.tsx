// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENLARGEABLE_SVG =
  '<svg data-testid="mermaid-svg"><text>Lifecycle</text></svg>';

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: async () => ({ elements: [], files: {} }),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown[]) => elements,
  exportToSvg: async () => ({ outerHTML: ENLARGEABLE_SVG }),
}));

const { MermaidRead } = await import("./MermaidBlock.js");

describe("MermaidBlock expand affordance", () => {
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

  async function renderDiagram() {
    await act(async () => {
      root.render(
        <MermaidRead
          blockId="mermaid-1"
          data={{ source: "sequenceDiagram\n  A->>B: hi" }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("renders a hover-revealed expand control once the diagram has rendered", async () => {
    await renderDiagram();
    expect(container.innerHTML).toContain("mermaid-svg");
    expect(expandButton()).toBeTruthy();
    expect(lightbox()).toBeNull();
  });

  it("opens a lightbox with the enlarged SVG and closes on Escape", async () => {
    await renderDiagram();

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
    expect(overlay?.querySelector('[data-testid="mermaid-svg"]')).toBeTruthy();
    expect(overlay?.textContent).toContain("Lifecycle");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(lightbox()).toBeNull();
  });

  it("closes the lightbox when the backdrop is clicked", async () => {
    await renderDiagram();

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
});
