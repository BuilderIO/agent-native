// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const contextMenuMock = vi.hoisted(() => ({
  onCloseAutoFocus: undefined as
    | ((event: { preventDefault: () => void }) => void)
    | undefined,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/context-menu", () => {
  const Container = ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  const Content = ({
    children,
    className,
    onCloseAutoFocus,
  }: {
    children?: React.ReactNode;
    className?: string;
    onCloseAutoFocus?: (event: { preventDefault: () => void }) => void;
  }) => {
    contextMenuMock.onCloseAutoFocus = onCloseAutoFocus;
    return <div className={className}>{children}</div>;
  };
  const Item = ({
    children,
    className,
    disabled,
    onSelect,
  }: {
    children?: React.ReactNode;
    className?: string;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
  }) => (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={(event) => onSelect?.(event.nativeEvent)}
    >
      {children}
    </button>
  );
  const SubTrigger = ({
    children,
    className,
    onClick,
  }: {
    children?: React.ReactNode;
    className?: string;
    onClick?: (event: { nativeEvent: Event }) => void;
  }) => (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
  return {
    ContextMenu: Container,
    ContextMenuContent: Content,
    ContextMenuGroup: Container,
    ContextMenuItem: Item,
    ContextMenuLabel: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    ContextMenuSeparator: () => <hr />,
    ContextMenuShortcut: Container,
    ContextMenuSub: Container,
    ContextMenuSubContent: Container,
    ContextMenuSubTrigger: SubTrigger,
    ContextMenuTrigger: Container,
  };
});

import { CanvasContextMenu, dispatchContextMenuAt } from "./CanvasContextMenu";

async function renderContextMenu(
  props: Omit<React.ComponentProps<typeof CanvasContextMenu>, "children">,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CanvasContextMenu {...props}>
        <div>Canvas</div>
      </CanvasContextMenu>,
    );
  });
  const findButton = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.toLowerCase().includes(label.toLowerCase()),
    );
  return {
    container,
    findButton,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("CanvasContextMenu imperative placement", () => {
  it("dispatches the pointer location through the Radix trigger", () => {
    const target = document.createElement("div");
    const onContextMenu = vi.fn();
    target.addEventListener("contextmenu", onContextMenu);

    dispatchContextMenuAt(target, { clientX: 40, clientY: 580 });

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ clientX: 40, clientY: 580 }),
    );
  });
});

describe("CanvasContextMenu Copy as PNG", () => {
  it("routes the existing item to the dedicated PNG callback", async () => {
    const onCopy = vi.fn();
    const onCopyAsPng = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      canCopy: true,
      canCopyAsPng: true,
      onCopy,
      onCopyAsPng,
    });

    const button = view.findButton("Copy as PNG");
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(onCopyAsPng).toHaveBeenCalledTimes(1);
    expect(onCopyAsPng).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copy-as-png",
        selectedCount: 1,
      }),
    );
    expect(onCopy).not.toHaveBeenCalled();
    await view.cleanup();
  });

  it("leaves Copy as PNG disabled when no real handler is wired", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      canCopyAsPng: true,
    });

    const button = view.findButton("Copy as PNG");
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(true);
    await view.cleanup();
  });
});

describe("CanvasContextMenu Select layer", () => {
  it("renders the ordered hit stack and selects the exact candidate", async () => {
    const onSelectLayer = vi.fn();
    const candidates = [
      {
        key: "front",
        label: "Front card",
        info: {
          tagName: "div",
          sourceId: "front",
          selector: '[data-agent-native-node-id="front"]',
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 100, height: 100 },
          isFlexChild: false,
          isFlexContainer: false,
        },
      },
      {
        key: "parent",
        label: "Parent frame",
        info: {
          tagName: "section",
          sourceId: "parent",
          selector: '[data-agent-native-node-id="parent"]',
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 200, height: 200 },
          isFlexChild: false,
          isFlexContainer: false,
        },
      },
    ];
    const view = await renderContextMenu({
      selectedCount: 1,
      layerCandidates: candidates,
      onSelectLayer,
    });

    expect(view.container.textContent).toContain("Select layer");
    const buttons = Array.from(view.container.querySelectorAll("button"));
    const front = buttons.find((button) =>
      button.textContent?.includes("Front card"),
    );
    const parent = buttons.find((button) =>
      button.textContent?.includes("Parent frame"),
    );
    expect(front).toBeDefined();
    expect(parent).toBeDefined();
    expect(buttons.indexOf(front!)).toBeLessThan(buttons.indexOf(parent!));

    await act(async () => parent?.click());
    expect(onSelectLayer).toHaveBeenCalledWith(candidates[1]);
    await view.cleanup();
  });
});

describe("CanvasContextMenu edit with agent", () => {
  it("sends the chosen preset for the selection", async () => {
    const onAgentPreset = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      onAgentPreset,
    });

    await act(async () => view.findButton("Polish")?.click());
    expect(onAgentPreset).toHaveBeenCalledWith(
      "polish",
      expect.objectContaining({ action: "edit-with-agent", selectedCount: 1 }),
    );
    const closeEvent = { preventDefault: vi.fn() };
    contextMenuMock.onCloseAutoFocus?.(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });

  it("lists every preset with its description", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      onAgentPreset: vi.fn(),
    });

    for (const text of [
      "Inspiration",
      "Explore multiple variants",
      "Debug",
      "Generate states",
      "Make responsive",
      "Adapt to narrow widths",
    ]) {
      expect(view.container.textContent).toContain(text);
    }
    await view.cleanup();
  });

  it("disables presets when no preset handler is wired", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
    });

    expect(view.findButton("Polish")?.disabled).toBe(true);
    await view.cleanup();
  });

  it("opens the agent panel when the Edit with Agent row itself is clicked", async () => {
    const onExploreWithAgent = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      onExploreWithAgent,
    });

    await act(async () => view.findButton("Edit with Agent")?.click());
    expect(onExploreWithAgent).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });

  it("uses the theme-aware layer hover token for items and submenu triggers", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      onAgentPreset: vi.fn(),
    });
    const submenuTrigger = view.findButton("Edit with Agent");
    expect(submenuTrigger?.className).toContain(
      "focus:bg-[var(--design-editor-layer-hover-color)]",
    );
    expect(submenuTrigger?.className).toContain(
      "data-[state=open]:bg-[var(--design-editor-layer-hover-color)]",
    );
    expect(submenuTrigger?.className).not.toContain("focus:bg-accent");
    await view.cleanup();
  });
});

describe("CanvasContextMenu rename focus", () => {
  it("does not hand focus back to the canvas after Rename moves it to the layer input", async () => {
    const onRename = vi.fn();
    const view = await renderContextMenu({ selectedCount: 1, onRename });

    await act(async () => view.findButton("Rename")?.click());
    expect(onRename).toHaveBeenCalledTimes(1);
    const closeEvent = { preventDefault: vi.fn() };
    contextMenuMock.onCloseAutoFocus?.(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });
});

describe("CanvasContextMenu multiple layers layout", () => {
  it("shows Group selection and Boolean operations instead of Rename and Create component", async () => {
    const onGroup = vi.fn();
    const onBooleanSubtract = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      selectedLayerCount: 2,
      onGroup,
      onBooleanSubtract,
      onAction: vi.fn(),
    });
    const text = view.container.textContent ?? "";
    const order = [
      "Edit with Agent",
      "Copy link",
      "Copy",
      "Paste to replace",
      "Copy/Paste as",
      "Group selection",
      "Frame selection",
      "Add auto layout",
      "Boolean operations",
      "Hide",
      "Lock",
      "Arrange",
      "Transform",
    ].map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain("Rename");
    expect(text).not.toContain("Create component");

    await act(async () => view.findButton("Group selection")?.click());
    await act(async () => view.findButton("Subtract")?.click());
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onBooleanSubtract).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });

  it("leaves Group selection and Boolean operations off the single layer menu", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      selectedLayerCount: 1,
      onGroup: vi.fn(),
      onBooleanSubtract: vi.fn(),
    });
    expect(view.container.textContent).not.toContain("Group selection");
    expect(view.container.textContent).not.toContain("Boolean operations");
    await view.cleanup();
  });
});

describe("CanvasContextMenu component instance layout", () => {
  it("replaces the creation actions with the instance actions", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      selectedLayerCount: 1,
      isComponentInstance: true,
      onAction: vi.fn(),
    });
    const text = view.container.textContent ?? "";
    const order = [
      "Edit with Agent",
      "Copy link",
      "Copy",
      "Paste to replace",
      "Go to main component",
      "Swap instance",
      "Detach instance",
      "Frame selection",
      "Hide",
      "Lock",
      "Arrange",
      "Transform",
    ].map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const removed of [
      "Copy/Paste as",
      "Rename",
      "Add auto layout",
      "Create component",
    ]) {
      expect(text).not.toContain(removed);
    }
    await view.cleanup();
  });
});

describe("CanvasContextMenu single layer layout", () => {
  it("follows the Figma order with Arrange and Transform submenus", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      onAction: vi.fn(),
    });
    const text = view.container.textContent ?? "";
    const order = [
      "Edit with Agent",
      "Copy link",
      "Copy",
      "Paste to replace",
      "Copy/Paste as",
      "Rename",
      "Frame selection",
      "Add auto layout",
      "Create component",
      "Hide",
      "Lock",
      "Arrange",
      "Transform",
    ].map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const removed of ["Paste here", "Copy as code"]) {
      expect(text).not.toContain(removed);
    }
    await view.cleanup();
  });
});

describe("CanvasContextMenu rotation", () => {
  it("moves the visible rotation affordance into the context menu", async () => {
    const onRotateClockwise = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      canRotateClockwise: true,
      onRotateClockwise,
    });

    const rotate = view.findButton("Rotate 90° clockwise");
    expect(rotate).toBeDefined();
    await act(async () => rotate?.click());
    expect(onRotateClockwise).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rotate-clockwise",
        selectedCount: 1,
      }),
    );
    await view.cleanup();
  });
});

describe("CanvasContextMenu motion", () => {
  it("disables the Radix entrance and exit animation", async () => {
    const view = await renderContextMenu({ selectedCount: 0 });
    const menu = Array.from(view.container.querySelectorAll("div")).find(
      (element) =>
        element.className.includes("data-[state=open]:!animate-none") &&
        element.className.includes("data-[state=closed]:!animate-none"),
    );
    expect(menu).toBeDefined();
    await view.cleanup();
  });
});

describe("CanvasContextMenu auto-layout suggestion", () => {
  it("progressively discloses the suggestion beside Add auto layout", async () => {
    const onAddAutoLayout = vi.fn();
    const onSuggestAutoLayout = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      canAddAutoLayout: true,
      canSuggestAutoLayout: true,
      onAddAutoLayout,
      onSuggestAutoLayout,
    });
    const add = view.findButton("Add auto layout");
    const suggest = view.findButton("Suggest auto layout");
    expect(add).toBeDefined();
    expect(suggest).toBeDefined();
    const buttons = Array.from(view.container.querySelectorAll("button"));
    expect(buttons.indexOf(suggest!)).toBe(buttons.indexOf(add!) + 1);
    await act(async () => suggest?.click());
    expect(onSuggestAutoLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "suggest-auto-layout",
        selectedCount: 1,
      }),
    );
    await view.cleanup();
  });

  it("renders no suggestion command when the caller has no eligible container", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      canAddAutoLayout: true,
      onAddAutoLayout: vi.fn(),
    });
    expect(view.findButton("Suggest auto layout")).toBeUndefined();
    await view.cleanup();
  });
});

describe("CanvasContextMenu instance cluster (Go to main / Swap / Detach)", () => {
  it("renders nothing for a non-instance selection (backward compatible default)", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      canCreateComponent: true,
    });

    expect(view.findButton("Go to main component")).toBeUndefined();
    expect(view.findButton("Swap instance")).toBeUndefined();
    expect(view.findButton("Detach instance")).toBeUndefined();
    await view.cleanup();
  });

  it("renders and wires all three items when isComponentInstance is true", async () => {
    const onGoToMainComponent = vi.fn();
    const onSwapInstance = vi.fn();
    const onDetachInstance = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      isComponentInstance: true,
      onGoToMainComponent,
      onSwapInstance,
      onDetachInstance,
    });

    const detachButton = view.findButton("Detach instance");
    expect(detachButton).toBeDefined();
    expect(detachButton?.disabled).toBe(false);
    await act(async () => detachButton?.click());
    expect(onDetachInstance).toHaveBeenCalledTimes(1);
    expect(onDetachInstance).toHaveBeenCalledWith(
      expect.objectContaining({ action: "detach-instance", selectedCount: 1 }),
    );

    const swapButton = view.findButton("Swap instance");
    await act(async () => swapButton?.click());
    expect(onSwapInstance).toHaveBeenCalledTimes(1);

    const mainButton = view.findButton("Go to main component");
    await act(async () => mainButton?.click());
    expect(onGoToMainComponent).toHaveBeenCalledTimes(1);

    await view.cleanup();
  });

  it("disables items whose capability flag is explicitly false", async () => {
    const onDetachInstance = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      isComponentInstance: true,
      canDetachInstance: false,
      onDetachInstance,
    });

    const detachButton = view.findButton("Detach instance");
    expect(detachButton?.disabled).toBe(true);
    await view.cleanup();
  });
});

describe("CanvasContextMenu shortcut hints", () => {
  it("spells shortcut hints in the viewer's own modifier words", async () => {
    const view = await renderContextMenu({
      selectedCount: 1,
      onBringToFront: vi.fn(),
      onSendToBack: vi.fn(),
      onFrameSelection: vi.fn(),
    });

    expect(view.findButton("Frame selection")?.textContent).toContain(
      "Ctrl+Alt+G",
    );
    expect(view.container.textContent).not.toContain("⌘");
    expect(view.container.textContent).not.toContain("⇧");

    await view.cleanup();
  });
});

describe("CanvasContextMenu empty canvas", () => {
  const canvasChild = (view: { container: HTMLElement }) =>
    Array.from(view.container.querySelectorAll("div")).find(
      (el) => el.textContent === "Canvas" && el.children.length === 0,
    )!;
  async function rightClick(target: Element) {
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
  }

  it("shows the agent and sharing menu on empty canvas even though the open screen counts as selected", async () => {
    const onExploreWithAgent = vi.fn();
    const onCopyLink = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      onExploreWithAgent,
      onCopyLink,
      onToggleUi: vi.fn(),
      onToggleComments: vi.fn(),
    });
    await rightClick(canvasChild(view));

    expect(view.findButton("Explore with Agent")?.disabled).toBe(false);
    expect(view.findButton("Copy link")?.disabled).toBe(false);
    expect(view.findButton("Hide UI")).toBeDefined();
    expect(view.findButton("Bring to front")).toBeUndefined();

    view.findButton("Explore with Agent")?.click();
    view.findButton("Copy link")?.click();
    expect(onExploreWithAgent).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });

  it("keeps the selection menu when the right-click lands on a screen", async () => {
    const view = await renderContextMenu({ selectedCount: 1 });
    const screen = document.createElement("div");
    screen.setAttribute("data-frame-shell", "");
    canvasChild(view).append(screen);
    await rightClick(screen);

    expect(view.findButton("Bring to front")).toBeDefined();
    expect(view.findButton("Explore with Agent")).toBeUndefined();
    await view.cleanup();
  });
});

describe("CanvasContextMenu send to", () => {
  it("sends to an agent or copies the prompt", async () => {
    const onSendTo = vi.fn();
    const view = await renderContextMenu({ selectedCount: 1, onSendTo });

    await act(async () => view.findButton("Claude Code")?.click());
    await act(async () => view.findButton("Copy agent prompt")?.click());
    expect(onSendTo.mock.calls).toEqual([["claude-code"], ["prompt"]]);
    await view.cleanup();
  });

  it("hides Send to when no handler is wired", async () => {
    const view = await renderContextMenu({ selectedCount: 1 });

    expect(view.container.textContent).not.toContain("Copy agent prompt");
    await view.cleanup();
  });
});
