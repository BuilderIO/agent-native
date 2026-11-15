// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mermaid fallback is the path a diagram actually takes when excalidraw cannot read it,
// and the sanitizer it returns through removes every foreignObject. So the render config must
// ask for text labels: with the HTML default each node's label group comes back empty and the
// reader gets shapes with no words.
const renderCalls = vi.hoisted(() => ({
  initialize: [] as Record<string, unknown>[],
  render: [] as { id: string; source: string }[],
}));

const LABELLED_SVG =
  '<svg class="flowchart"><g class="nodes"><g class="rough-node"><g class="label"><text>Start</text></g></g></g><foreignObject><div>should be stripped</div></foreignObject></svg>';

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: async () => {
    throw new Error("excalidraw cannot read this diagram");
  },
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown[]) => elements,
  exportToSvg: async () => ({ outerHTML: "<svg></svg>" }),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: (config: Record<string, unknown>) => {
      renderCalls.initialize.push(config);
    },
    render: async (id: string, source: string) => {
      renderCalls.render.push({ id, source });
      return { svg: LABELLED_SVG };
    },
  },
}));

const { MermaidRead } = await import("./MermaidBlock.js");

describe("MermaidBlock labels survive the sanitizer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    renderCalls.initialize.length = 0;
    renderCalls.render.length = 0;
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

  const mount = async (source: string) => {
    await act(async () => {
      root.render(
        <MermaidRead
          blockId="mermaid-labels"
          data={{ source }}
          onChange={async () => {}}
        />,
      );
    });
    // the renderer is imported and run in an effect; let both settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  };

  it("asks mermaid for text labels and keeps them", async () => {
    await mount("graph TD; A[Start]-->B[Done];");
    expect(renderCalls.render.length).toBe(1);
    expect(renderCalls.initialize.at(-1)).toMatchObject({
      flowchart: { htmlLabels: false },
    });
    expect(container.innerHTML).toContain("<text>Start</text>");
    expect(container.innerHTML).not.toContain("foreignObject");
  });
});
