// @vitest-environment happy-dom

import { BlockRegistryProvider } from "@agent-native/core/blocks";
import type { PlanBlock } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanBlockView } from "./DocumentArea";
import { createPlanBlockRenderContext, planBlockRegistry } from "./planBlocks";

describe("salvaged invalid block warning", () => {
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

  it("renders marker callouts as a Plan warning before registry callout handling", () => {
    const block = {
      id: "bad-tabs",
      type: "callout",
      data: {
        tone: "warning",
        body: "​__unknown_block__:tabs\ndata.tabs.0.blocks.0.data.annotations.0.lines: Invalid input",
      },
    } as unknown as PlanBlock;

    act(() => {
      root.render(
        <BlockRegistryProvider
          registry={planBlockRegistry}
          ctx={createPlanBlockRenderContext({})}
        >
          <PlanBlockView block={block} />
        </BlockRegistryProvider>,
      );
    });

    expect(container.textContent).toContain("Invalid tabs block");
    expect(container.textContent).toContain("Validation details");
    expect(container.textContent).toContain(
      "data.tabs.0.blocks.0.data.annotations.0.lines",
    );
    expect(container.textContent).not.toContain("__unknown_block__");
  });
});
