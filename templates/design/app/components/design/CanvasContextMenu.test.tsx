// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/context-menu", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
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
