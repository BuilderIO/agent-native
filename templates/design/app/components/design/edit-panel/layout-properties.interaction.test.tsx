// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import type { ElementInfo } from "../types";
import {
  LayoutContextProperties,
  LayoutGuideProperties,
} from "./layout-properties";

describe("LayoutContextProperties interactions", () => {
  it("re-clicking Grid on an existing grid invokes no command at all, preserving authored custom tracks untouched", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const onApplyLayoutFlow = vi.fn().mockReturnValue("applied");
    const customColumns = "96px 1fr minmax(80px, 2fr)";
    const customRows = "repeat(2, max-content)";
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "96px 180px 180px",
        gridTemplateRows: "24px 24px",
        gridAutoFlow: "row",
        columnGap: "12px",
        rowGap: "8px",
        width: "480px",
        height: "100px",
      },
      inlineStyles: {
        gridTemplateColumns: customColumns,
        gridTemplateRows: customRows,
        gridAutoFlow: "row",
      },
      boundingRect: { x: 0, y: 0, width: 480, height: 100 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: true,
      childElementCount: 4,
      sourceId: "grid-1",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties
          element={element}
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          onApplyLayoutFlow={onApplyLayoutFlow}
        />,
      );
    });

    const gridButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid"]',
    );
    expect(gridButton?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => gridButton?.click());
    expect(onApplyLayoutFlow).not.toHaveBeenCalled();
    expect(onStylesChange).not.toHaveBeenCalled();
    expect(onStyleChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("disables the Columns field for an unknown-sizing axis, enables it once inline-authored", async () => {
    const renderGrid = async (inlineStyles: Record<string, string>) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const element = {
        tagName: "div",
        classes: [],
        computedStyles: {
          display: "grid",
          gridTemplateColumns: "80px 80px",
          gridTemplateRows: "40px",
          columnGap: "0px",
          rowGap: "0px",
          width: "160px",
          height: "40px",
        },
        inlineStyles,
        boundingRect: { x: 0, y: 0, width: 160, height: 40 },
        isFlexChild: false,
        isFlexContainer: false,
        isGridContainer: true,
        childElementCount: 2,
        sourceId: "grid-2",
      } as ElementInfo;

      await act(async () => {
        root.render(
          <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
        );
      });

      const settingsButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Grid settings"]',
      );
      await act(async () => settingsButton?.click());
      const columnsInput = document.querySelector<HTMLInputElement>(
        'input[aria-label="Columns"]',
      );
      const disabled = columnsInput?.disabled;

      await act(async () => root.unmount());
      container.remove();
      return disabled;
    };

    expect(await renderGrid({})).toBe(true);
    expect(
      await renderGrid({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }),
    ).toBe(false);
  });

  it("disables the Columns field for a known non-uniform inline template", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "96px 180px 180px",
        gridTemplateRows: "24px",
        columnGap: "0px",
        rowGap: "0px",
        width: "480px",
        height: "40px",
      },
      inlineStyles: {
        gridTemplateColumns: "96px 1fr minmax(0, 200px)",
      },
      boundingRect: { x: 0, y: 0, width: 480, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: true,
      childElementCount: 3,
      sourceId: "grid-custom",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid settings"]',
    );
    await act(async () => settingsButton?.click());

    const columnsInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Columns"]',
    );
    expect(columnsInput?.disabled).toBe(true);
    const columnSizingButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Column sizing"]',
    );
    expect(columnSizingButton?.disabled).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("disables Columns and Column sizing for a mixed multi-selection axis, shows the Mixed placeholder", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "80px 80px",
        gridTemplateRows: "repeat(2, max-content)",
        columnGap: "0px",
        rowGap: "0px",
        width: "160px",
        height: "80px",
      },
      inlineStyles: {
        gridTemplateColumns: "Mixed",
        gridTemplateRows: "repeat(2, max-content)",
      },
      boundingRect: { x: 0, y: 0, width: 160, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: true,
      childElementCount: 2,
      sourceId: "grid-mixed",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    const cellButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label*="×"]'),
    );
    expect(cellButtons.length).toBeGreaterThan(0);
    expect(cellButtons.every((button) => button.disabled)).toBe(true);

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid settings"]',
    );
    await act(async () => settingsButton?.click());

    const columnsInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Columns"]',
    );
    expect(columnsInput?.disabled).toBe(true);
    expect(columnsInput?.value).toBe("Mixed");

    const columnSizingButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Column sizing"]',
    );
    expect(columnSizingButton?.disabled).toBe(true);

    await act(async () => root.unmount());
    container.remove();
  });

  it("resolves flow to grid, not mixed, when every element is a grid even if unrelated computed properties differ", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "grid",
        flexDirection: "Mixed",
        flexWrap: "Mixed",
        gridTemplateColumns: "Mixed",
        gridTemplateRows: "Mixed",
        columnGap: "0px",
        rowGap: "0px",
        width: "160px",
        height: "80px",
      },
      inlineStyles: {
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(1, max-content)",
      },
      boundingRect: { x: 0, y: 0, width: 160, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: true,
      childElementCount: 4,
      sourceId: "merged-grid",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    const flowRow = container.querySelector("[data-flow-value]");
    expect(flowRow?.getAttribute("data-flow-value")).toBe("grid");
    expect(container.textContent).not.toContain("Mixed");

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid settings"]',
    );
    expect(settingsButton).not.toBeNull();
    await act(async () => settingsButton?.click());
    const columnsInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Columns"]',
    );
    expect(columnsInput?.disabled).toBe(false);
    expect(columnsInput?.value).toBe("2");

    await act(async () => root.unmount());
    container.remove();
  });

  it("still reports flow as mixed for a genuine flex/grid multi-selection", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "Mixed",
        flexDirection: "row",
        flexWrap: "nowrap",
        width: "160px",
        height: "80px",
      },
      inlineStyles: {},
      boundingRect: { x: 0, y: 0, width: 160, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      childElementCount: 2,
      sourceId: "merged-flex-grid",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    const flowRow = container.querySelector("[data-flow-value]");
    expect(flowRow?.getAttribute("data-flow-value")).toBe("mixed");
    expect(
      container.querySelector('button[aria-label="Grid settings"]'),
    ).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("reflows children through the layout-flow command before writing styles", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStylesChange = vi.fn();
    const onApplyLayoutFlow = vi.fn().mockReturnValue("applied");
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "block",
        width: "480px",
        height: "300px",
      },
      inlineStyles: {},
      boundingRect: { x: 0, y: 0, width: 480, height: 300 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: false,
      childElementCount: 4,
      sourceId: "frame-1",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties
          element={element}
          onStyleChange={vi.fn()}
          onStylesChange={onStylesChange}
          onApplyLayoutFlow={onApplyLayoutFlow}
        />,
      );
    });

    const gridButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid"]',
    );
    await act(async () => gridButton?.click());
    expect(onApplyLayoutFlow).toHaveBeenCalledWith("frame-1", {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(1, max-content)",
      gridAutoFlow: "row",
    });
    expect(onStylesChange).not.toHaveBeenCalled();

    onApplyLayoutFlow.mockReturnValue("failed");
    await act(async () => gridButton?.click());
    expect(onStylesChange).not.toHaveBeenCalled();

    onApplyLayoutFlow.mockReturnValue("unsupported");
    await act(async () => gridButton?.click());
    expect(onStylesChange).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("links asymmetric padding without mutating or averaging authored values", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        width: "200px",
        height: "100px",
        paddingTop: "4px",
        paddingRight: "8px",
        paddingBottom: "12px",
        paddingLeft: "16px",
      },
      boundingRect: { x: 0, y: 0, width: 200, height: 100 },
      isFlexChild: false,
      isFlexContainer: true,
      childElementCount: 1,
      sourceId: "frame-1",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties
          element={element}
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
        />,
      );
    });

    const linkButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Link padding"]',
    );
    expect(linkButton).not.toBeNull();
    await act(async () => linkButton?.click());

    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[aria-label="Unlink padding"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it.each(["container", "leaf"] as const)(
    "only writes the edited margin side for a %s",
    async (kind) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const onStyleChange = vi.fn();
      const onStylesChange = vi.fn();
      const isContainer = kind === "container";
      const element = {
        tagName: isContainer ? "div" : "span",
        primitiveKind: isContainer ? undefined : "text",
        classes: [],
        computedStyles: {
          display: isContainer ? "flex" : "inline",
          flexDirection: "row",
          flexWrap: "nowrap",
          width: "120px",
          height: "80px",
          marginTop: "auto",
          marginRight: "12px",
          marginBottom: "Mixed",
          marginLeft: "8px",
        },
        boundingRect: { x: 0, y: 0, width: 120, height: 80 },
        isFlexChild: false,
        isFlexContainer: isContainer,
        isGridContainer: false,
        childElementCount: isContainer ? 1 : 0,
        sourceId: `${kind}-1`,
      } as ElementInfo;

      await act(async () => {
        root.render(
          <LayoutContextProperties
            element={element}
            onStyleChange={onStyleChange}
            onStylesChange={onStylesChange}
          />,
        );
      });

      const leftMargin = container.querySelector<HTMLInputElement>(
        'input[aria-label="editPanel.labels.marginLeft"]',
      );
      expect(leftMargin).not.toBeNull();
      await act(async () => {
        leftMargin?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
      });

      expect(onStylesChange).toHaveBeenCalledOnce();
      expect(onStylesChange).toHaveBeenCalledWith(
        { marginLeft: "9px" },
        expect.objectContaining({
          source: "keyboard",
          phase: "commit",
        }),
      );
      expect(onStyleChange).not.toHaveBeenCalled();

      await act(async () => root.unmount());
      container.remove();
    },
  );

  it("preserves the relative delta for both sides of a linked mixed margin edit", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStylesChange = vi.fn();
    const element = {
      tagName: "span",
      primitiveKind: "text",
      classes: [],
      computedStyles: {
        display: "inline",
        width: "120px",
        height: "80px",
        marginTop: "4px",
        marginRight: "Mixed",
        marginBottom: "4px",
        marginLeft: "Mixed",
      },
      boundingRect: { x: 0, y: 0, width: 120, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: false,
      childElementCount: 0,
      sourceId: "leaf-mixed-margin",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties
          element={element}
          onStyleChange={vi.fn()}
          onStylesChange={onStylesChange}
        />,
      );
    });

    const linkButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.linkMarginSides"]',
    );
    expect(linkButton).not.toBeNull();
    await act(async () => linkButton?.click());

    const horizontalMargin = container.querySelector<HTMLInputElement>(
      'input[aria-label="editPanel.labels.marginLeft / editPanel.labels.marginRight"]',
    );
    expect(horizontalMargin).not.toBeNull();
    await act(async () => {
      horizontalMargin?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });

    expect(onStylesChange).toHaveBeenCalledOnce();
    expect(onStylesChange).toHaveBeenCalledWith(
      { marginLeft: "1px", marginRight: "1px" },
      expect.objectContaining({
        source: "keyboard",
        phase: "commit",
        relativeDelta: 1,
        relativeDeltaProperties: ["marginLeft", "marginRight"],
      }),
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a stylesheet-authored auto margin instead of its resolved pixel value", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "span",
      primitiveKind: "text",
      classes: [],
      computedStyles: {
        display: "inline",
        width: "120px",
        height: "80px",
        marginLeft: "auto",
      },
      boundingRect: { x: 0, y: 0, width: 120, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: false,
      childElementCount: 0,
      sourceId: "leaf-auto-margin",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="editPanel.labels.marginLeft"]',
      )?.value,
    ).toBe("auto");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps W/H sizing primary and reveals flex CSS fields in a popover", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "span",
      primitiveKind: "text",
      textContent: "Text",
      classes: [],
      computedStyles: {
        display: "inline",
        width: "120px",
        height: "80px",
        flexGrow: "2",
        flexShrink: "1",
        flexBasis: "auto",
        order: "0",
      },
      inlineStyles: { width: "120px", height: "80px" },
      boundingRect: { x: 0, y: 0, width: 120, height: 80 },
      isFlexChild: true,
      isFlexContainer: false,
      isGridContainer: false,
      childElementCount: 0,
      sourceId: "text-child",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    const section = container.querySelector("section.design-sidebar-section");
    const heading = section?.querySelector(".design-sidebar-section-title");
    expect(heading?.textContent).toBe("editPanel.sections.layout");
    expect(heading?.closest("button")).toBeNull();
    expect(section?.textContent).toContain("editPanel.labels.width");
    expect(section?.textContent).toContain("editPanel.labels.height");
    expect(section?.textContent).not.toContain("editPanel.labels.flexGrow");
    expect(section?.querySelector('button[aria-label^="W "]')).not.toBeNull();
    expect(section?.querySelector('button[aria-label^="H "]')).not.toBeNull();

    const advanced = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.layoutContext.flexChild"]',
    );
    expect(advanced).not.toBeNull();
    await act(async () => advanced?.click());
    expect(document.body.textContent).toContain("editPanel.labels.flexGrow");
    expect(document.body.textContent).toContain("editPanel.labels.flexShrink");
    expect(document.body.textContent).toContain("editPanel.labels.flexBasis");
    expect(document.body.textContent).toContain("editPanel.labels.order");
    expect(document.body.textContent).toContain("editPanel.labels.alignSelf");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the empty Layout guide section add-only", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: { display: "block" },
      inlineStyles: {},
      boundingRect: { x: 0, y: 0, width: 300, height: 200 },
      isFlexChild: false,
      isFlexContainer: true,
      isGridContainer: false,
      childElementCount: 0,
      sourceId: "empty-frame",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutGuideProperties element={element} onStyleChange={vi.fn()} />,
      );
    });

    const section = container.querySelector("section.design-sidebar-section");
    const heading = section?.querySelector(".design-sidebar-section-title");
    expect(heading?.textContent).toBe("Layout guide");
    expect(heading?.closest("button")).toBeNull();
    expect(section?.textContent).not.toContain("No layout guides");
    expect(
      section?.querySelector('button[aria-label="Add layout guide"]'),
    ).not.toBeNull();
    expect(
      section?.querySelector(".design-sidebar-section-content"),
    ).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
