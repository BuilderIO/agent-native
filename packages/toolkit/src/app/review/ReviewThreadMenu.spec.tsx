// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewThreadMenu } from "./ReviewThreadMenu.js";

describe("ReviewThreadMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function open() {
    await act(async () => {
      container
        .querySelector('button[aria-label="More actions"]')
        ?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
  }

  const menuLabels = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="separator"]',
      ),
    ).map((item) =>
      item.getAttribute("role") === "separator"
        ? "---"
        : (item.textContent?.trim() ?? ""),
    );

  it("lists Edit, read toggle, a separator, Copy link, then Delete thread", async () => {
    act(() =>
      root.render(
        <ReviewThreadMenu
          canEdit
          onEdit={vi.fn()}
          onToggleUnread={vi.fn()}
          onCopyLink={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    await open();
    expect(menuLabels()).toEqual([
      "Edit",
      "Mark as unread",
      "---",
      "Copy link",
      "Delete thread",
    ]);
    const destructive = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Delete thread");
    expect(destructive?.className).toContain("text-destructive");
  });

  it("lists the agent items, a separator, Apply, a separator, then Copy link and Delete thread", async () => {
    act(() =>
      root.render(
        <ReviewThreadMenu
          onSendToAgent={vi.fn()}
          onSuggestChanges={vi.fn()}
          onReplyInThread={vi.fn()}
          onApplyAndResolve={vi.fn()}
          onCopyLink={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    await open();
    expect(menuLabels()).toEqual([
      "Send to agent",
      "Suggest changes",
      "Reply in thread",
      "---",
      "Apply changes and resolve",
      "---",
      "Copy link",
      "Delete thread",
    ]);
  });

  it("puts the agent groups before Edit, the read toggle, Copy link and Delete", async () => {
    act(() =>
      root.render(
        <ReviewThreadMenu
          onSendToAgent={vi.fn()}
          onApplyAndResolve={vi.fn()}
          canEdit
          onEdit={vi.fn()}
          onToggleUnread={vi.fn()}
          onCopyLink={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    await open();
    expect(menuLabels()).toEqual([
      "Send to agent",
      "---",
      "Apply changes and resolve",
      "---",
      "Edit",
      "Mark as unread",
      "---",
      "Copy link",
      "Delete thread",
    ]);
  });

  it("renders only the agent items whose handler is passed, with no stray separators", async () => {
    act(() =>
      root.render(
        <ReviewThreadMenu
          onSuggestChanges={vi.fn()}
          onApplyAndResolve={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    await open();
    expect(menuLabels()).toEqual([
      "Suggest changes",
      "---",
      "Apply changes and resolve",
      "---",
      "Delete thread",
    ]);
  });

  it("renders a menu when only an agent handler is passed", async () => {
    act(() => root.render(<ReviewThreadMenu onReplyInThread={vi.fn()} />));
    await open();
    expect(menuLabels()).toEqual(["Reply in thread"]);
  });

  it("calls the handler of the chosen agent item", async () => {
    const handlers = {
      onSendToAgent: vi.fn(),
      onSuggestChanges: vi.fn(),
      onReplyInThread: vi.fn(),
      onApplyAndResolve: vi.fn(),
    };
    const choose = async (label: string) => {
      act(() => root.render(<ReviewThreadMenu {...handlers} />));
      await open();
      const item = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((candidate) => candidate.textContent?.trim() === label);
      await act(async () => item?.click());
    };
    await choose("Send to agent");
    await choose("Suggest changes");
    await choose("Reply in thread");
    await choose("Apply changes and resolve");
    expect(handlers.onSendToAgent).toHaveBeenCalledTimes(1);
    expect(handlers.onSuggestChanges).toHaveBeenCalledTimes(1);
    expect(handlers.onReplyInThread).toHaveBeenCalledTimes(1);
    expect(handlers.onApplyAndResolve).toHaveBeenCalledTimes(1);
  });

  it("disables the agent items but not Copy link while an agent action is in flight", async () => {
    const onSendToAgent = vi.fn();
    act(() =>
      root.render(
        <ReviewThreadMenu
          agentActionsDisabled
          onSendToAgent={onSendToAgent}
          onApplyAndResolve={vi.fn()}
          onCopyLink={vi.fn()}
        />,
      ),
    );
    await open();
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(
      items.map((item) => item.getAttribute("aria-disabled") === "true"),
    ).toEqual([true, true, false]);
    await act(async () => items[0]?.click());
    expect(onSendToAgent).not.toHaveBeenCalled();
  });

  it("uses custom labels for the agent items", async () => {
    act(() =>
      root.render(
        <ReviewThreadMenu
          onSendToAgent={vi.fn()}
          sendToAgentLabel="Enviar al agente"
        />,
      ),
    );
    await open();
    expect(menuLabels()).toEqual(["Enviar al agente"]);
  });

  it("hides Edit when the viewer cannot edit", async () => {
    act(() =>
      root.render(
        <ReviewThreadMenu
          canEdit={false}
          onEdit={vi.fn()}
          unread
          onToggleUnread={vi.fn()}
          onCopyLink={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    await open();
    expect(menuLabels()).toEqual([
      "Mark as read",
      "---",
      "Copy link",
      "Delete thread",
    ]);
  });

  it("omits the separator when only one group is present", async () => {
    act(() => root.render(<ReviewThreadMenu onCopyLink={vi.fn()} />));
    await open();
    expect(menuLabels()).toEqual(["Copy link"]);
  });

  it("renders nothing when there are no actions", () => {
    act(() => root.render(<ReviewThreadMenu canEdit />));
    expect(container.querySelector("button")).toBeNull();
  });

  it("runs the chosen handler", async () => {
    const onDelete = vi.fn();
    act(() => root.render(<ReviewThreadMenu onDelete={onDelete} />));
    await open();
    const item = document.querySelector<HTMLElement>('[role="menuitem"]');
    await act(async () => item?.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("marks the portaled menu as review UI", async () => {
    act(() => root.render(<ReviewThreadMenu onCopyLink={vi.fn()} />));
    await open();
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.hasAttribute("data-review-popover")).toBe(true);
    expect(
      document
        .querySelector('[role="menuitem"]')
        ?.closest("[data-review-popover]"),
    ).toBe(menu);
    // The menu is portaled, so it is not inside the trigger's container.
    expect(container.contains(menu)).toBe(false);
  });
});
