// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

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
  const Item = ({
    children,
    disabled,
    onSelect,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => onSelect?.(event.nativeEvent)}
    >
      {children}
    </button>
  );
  return {
    ContextMenu: Container,
    ContextMenuContent: Container,
    ContextMenuGroup: Container,
    ContextMenuItem: Item,
    ContextMenuSeparator: () => <hr />,
    ContextMenuShortcut: Container,
    ContextMenuSub: Container,
    ContextMenuSubContent: Container,
    ContextMenuSubTrigger: Container,
    ContextMenuTrigger: Container,
  };
});

import { CanvasContextMenu } from "./CanvasContextMenu";

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

describe("CanvasContextMenu regenerate", () => {
  const candidate = {
    key: "hero",
    label: "Hero",
    screenId: "screen-1",
    info: {
      tagName: "section",
      sourceId: "hero",
      selector: '[data-agent-native-node-id="hero"]',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 400, height: 240 },
      isFlexChild: false,
      isFlexContainer: false,
    },
  };

  it("routes an active selection through the reprompt action", async () => {
    const onReprompt = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      canReprompt: true,
      onReprompt,
    });

    await act(async () => view.findButton("Regenerate")?.click());
    expect(onReprompt).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reprompt", selectedCount: 1 }),
    );
    await view.cleanup();
  });

  it("keeps stacked-layer candidates explicit for reprompting", async () => {
    const parent = {
      ...candidate,
      key: "parent",
      label: "Parent frame",
      info: { ...candidate.info, sourceId: "parent" },
    };
    const onRepromptLayer = vi.fn();
    const view = await renderContextMenu({
      selectedCount: 1,
      layerCandidates: [candidate, parent],
      canReprompt: true,
      onRepromptLayer,
    });

    const parentButtons = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.includes("Parent frame"));
    await act(async () => parentButtons[parentButtons.length - 1]?.click());
    expect(onRepromptLayer).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({ action: "reprompt" }),
    );
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
