// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MessageQueueDrawer,
  type MessageQueueDrawerLabels,
  type MessageQueueItem,
} from "./MessageQueueDrawer.js";

const labels: MessageQueueDrawerLabels = {
  region: "2 queued",
  steer: "Send now",
  steerHint: "Sends this message at the agent's next step.",
  remove: "Remove from queue",
  moreActions: "More actions",
};

const items: MessageQueueItem[] = [
  { id: "first", text: "Inspect the workspace" },
  { id: "second", text: "Summarize the changes" },
];

describe("MessageQueueDrawer", () => {
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
    document.body
      .querySelectorAll("[data-radix-popper-content-wrapper]")
      .forEach((element) => element.remove());
    vi.unstubAllGlobals();
  });

  it("shows a Send now row's delivery state in place of its button", () => {
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={[
            { ...items[0]!, status: "sending" },
            { ...items[1]!, status: "after-reply" },
            { id: "third", text: "Draft the summary" },
          ]}
          labels={labels}
          onSteer={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
    });

    const rows = container.querySelectorAll("li");
    expect(
      rows[0]?.querySelector("[data-agent-message-queue-status]")?.textContent,
    ).toBe("Sending…");
    expect(
      rows[1]?.querySelector("[data-agent-message-queue-status]")?.textContent,
    ).toBe("Sends after this reply");
    const sendNow = (row: Element | undefined) =>
      Array.from(row?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Send now"),
      );
    expect(sendNow(rows[0])).toBeUndefined();
    expect(sendNow(rows[1])).toBeUndefined();
    expect(sendNow(rows[2])).toBeDefined();
  });

  it("offers Stop and send in the row menu, even for a single message", async () => {
    const onStopAndSend = vi.fn();
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={[{ ...items[0]!, status: "sending" }]}
          labels={labels}
          onSteer={vi.fn()}
          onStopAndSend={onStopAndSend}
          onRemove={vi.fn()}
        />,
      );
    });

    const moreButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions"]',
    );
    expect(moreButton).not.toBeNull();
    await act(async () => {
      moreButton?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });
    const menuItems = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "Stop and send",
    ]);
    act(() => menuItems[0]?.click());
    expect(onStopAndSend).toHaveBeenCalledWith({
      ...items[0],
      status: "sending",
    });
  });

  it("renders compact queue rows and routes row actions to the host", async () => {
    const onSteer = vi.fn();
    const onRemove = vi.fn();
    const onMoveToTop = vi.fn();

    act(() => {
      root.render(
        <MessageQueueDrawer
          items={items}
          labels={labels}
          variant="recessed"
          onSteer={onSteer}
          onRemove={onRemove}
          getItemActions={(item) => [
            {
              id: "send-next",
              label: "Send next",
              hint: "Send after the current response finishes",
              onSelect: () => onMoveToTop(item),
            },
          ]}
        />,
      );
    });

    const drawer = container.querySelector<HTMLElement>(
      '[data-agent-message-queue="true"]',
    );
    expect(drawer).not.toBe(null);
    expect(drawer?.dataset.agentMessageQueueVariant).toBe("recessed");
    // The AgentKit composer stack owns the recessed surface styling.
    expect(drawer?.className).not.toContain("bg-muted/55");
    expect(
      container
        .querySelector<HTMLElement>('[data-agent-message-queue="true"]')
        ?.style.getPropertyValue("--agent-message-queue-height"),
    ).toBe("min(84px, 10rem)");
    expect(container.textContent).toContain("Inspect the workspace");
    expect(container.querySelectorAll("li")).toHaveLength(2);

    const steerButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Send now"),
    );
    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove from queue"]',
    );
    const moreButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions"]',
    );

    expect(steerButton).toBeDefined();
    expect(removeButton).not.toBeNull();
    expect(moreButton).not.toBeNull();

    act(() => steerButton?.click());
    act(() => removeButton?.click());
    expect(onSteer).toHaveBeenCalledWith(items[0]);
    expect(onRemove).toHaveBeenCalledWith(items[0]);

    await act(async () => {
      moreButton?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });
    const menuItem = document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(menuItem?.textContent).toContain("Send next");
    await act(async () => {
      menuItem?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(document.body.textContent).toContain(
      "Send after the current response finishes",
    );
    act(() => menuItem?.click());
    expect(onMoveToTop).toHaveBeenCalledWith(items[0]);
  });

  it("keeps only the last queue-row action menu open", async () => {
    const multipleItems = [
      ...items,
      { id: "third", text: "Write the follow-up" },
    ];

    act(() => {
      root.render(
        <MessageQueueDrawer
          items={multipleItems}
          labels={labels}
          onRemove={() => undefined}
          getItemActions={(item) => [
            {
              id: "move-to-top",
              label: `Move ${item.id} to top`,
              onSelect: () => undefined,
            },
          ]}
        />,
      );
    });

    const moreButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="More actions"]',
      ),
    );

    await act(async () => {
      for (const button of moreButtons) {
        button.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
      }
      await Promise.resolve();
    });

    const openMenus = document.querySelectorAll('[role="menu"]');
    expect(openMenus).toHaveLength(1);
    expect(openMenus[0]?.textContent).toContain("Move third to top");
  });

  it("does not reopen a queue-row menu after its row or actions disappear", async () => {
    const getItemActions = (item: MessageQueueItem) => [
      {
        id: "move-to-top",
        label: `Move ${item.id} to top`,
        onSelect: () => undefined,
      },
    ];

    const renderQueue = (
      queueItems: readonly MessageQueueItem[] = items,
      actions: typeof getItemActions | (() => []) = getItemActions,
    ) => {
      act(() => {
        root.render(
          <MessageQueueDrawer
            items={queueItems}
            labels={labels}
            onRemove={() => undefined}
            getItemActions={actions}
          />,
        );
      });
    };
    const openFirstMenu = async () => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="More actions"]',
      );
      await act(async () => {
        button?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
    };

    renderQueue();
    await openFirstMenu();
    renderQueue(items.slice(0, 1));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    renderQueue();
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await openFirstMenu();
    renderQueue(items.slice(1));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    renderQueue();
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await openFirstMenu();
    renderQueue(items, () => []);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    renderQueue();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("collapses the recessed queue into the composer workflow", () => {
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={items.slice(0, 1)}
          labels={labels}
          variant="recessed"
          onRemove={() => undefined}
          getItemActions={() => [
            { id: "send-next", label: "Send next", onSelect: () => {} },
          ]}
        />,
      );
    });

    const drawer = container.querySelector<HTMLElement>(
      '[data-agent-message-queue="true"]',
    );
    expect(drawer?.dataset.empty).toBe("false");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="More actions"]',
      ),
    ).toBeNull();
    expect(drawer?.style.getPropertyValue("--agent-message-queue-height")).toBe(
      "min(44px, 10rem)",
    );

    act(() => {
      root.render(
        <MessageQueueDrawer
          items={[]}
          labels={labels}
          variant="recessed"
          onRemove={() => undefined}
        />,
      );
    });

    expect(drawer?.dataset.empty).toBe("true");
    expect(drawer?.getAttribute("aria-hidden")).toBe("true");
    expect(drawer?.style.getPropertyValue("--agent-message-queue-height")).toBe(
      "0px",
    );
  });

  it("keeps Send now aligned when only some rows have more actions", () => {
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={items}
          labels={labels}
          variant="recessed"
          onSteer={() => undefined}
          onRemove={() => undefined}
          getItemActions={(item) =>
            item.id === "first"
              ? [{ id: "send-next", label: "Send next", onSelect: () => {} }]
              : []
          }
        />,
      );
    });

    const actionColumns = Array.from(container.querySelectorAll("li")).map(
      (row) => row.lastElementChild!,
    );
    expect(actionColumns.map((column) => column.childElementCount)).toEqual([
      3, 3,
    ]);
    expect(
      actionColumns[1]!.lastElementChild?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("disables every queue mutation while the host command is pending", () => {
    act(() => {
      root.render(
        <MessageQueueDrawer
          disabled
          items={items.slice(0, 1)}
          labels={labels}
          onSteer={() => undefined}
          onRemove={() => undefined}
          getItemActions={() => [
            { id: "move", label: "Move", onSelect: () => undefined },
          ]}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll("button")).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });
  it("keeps rows a fixed 36px with concentric corners from the composer radius", () => {
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={[...items, { id: "third", text: "x", images: ["/a.png"] }]}
          labels={labels}
          variant="recessed"
          onRemove={() => undefined}
        />,
      );
    });

    const drawer = container.querySelector<HTMLElement>(
      '[data-agent-message-queue="true"]',
    )!;
    expect(drawer.style.getPropertyValue("--agent-message-queue-radius")).toBe(
      "var(--agentkit-composer-radius, var(--radius-xl, 0.75rem))",
    );
    expect(drawer.style.getPropertyValue("--agent-message-queue-inset")).toBe(
      "0.25rem",
    );
    expect(drawer.className).toContain(
      "rounded-t-[var(--agent-message-queue-radius)]",
    );
    expect(drawer.className).toContain("p-[var(--agent-message-queue-inset)]");
    // 32 + 32 + 64 rows plus the 4px inset above and below.
    expect(drawer.style.getPropertyValue("--agent-message-queue-height")).toBe(
      "min(152px, 10rem)",
    );
    const rows = Array.from(container.querySelectorAll("li"));
    for (const row of rows) {
      expect(row.className).toContain(
        "rounded-[calc(var(--agent-message-queue-radius)-var(--agent-message-queue-inset))]",
      );
      expect(row.className).toContain("min-h-0");
      expect(row.className).toContain("leading-5");
      // Rows fade in; a slide would fight the drawer's height transition.
      expect(row.className).not.toContain("slide-in");
    }
    expect(rows[0]!.className).toContain("h-9");
    expect(rows[2]!.className).toContain("h-16");
    expect(container.querySelector("ul")?.className).toContain(
      "overflow-y-hidden",
    );
  });

  it("reserves the overflow column before a second message arrives", () => {
    const renderQueue = (queueItems: readonly MessageQueueItem[]) =>
      act(() => {
        root.render(
          <MessageQueueDrawer
            items={queueItems}
            labels={labels}
            variant="recessed"
            onSteer={() => undefined}
            onRemove={() => undefined}
            onReorder={() => undefined}
          />,
        );
      });

    renderQueue(items.slice(0, 1));
    const firstRowColumns = () =>
      container.querySelector("li")!.lastElementChild!.childElementCount;
    expect(firstRowColumns()).toBe(3);
    expect(container.querySelector("[data-agent-message-queue-handle]")).toBe(
      null,
    );
    renderQueue(items);
    expect(firstRowColumns()).toBe(3);
    expect(
      container.querySelectorAll('[data-agent-message-queue-handle="true"]'),
    ).toHaveLength(2);
  });

  it("reorders with the keyboard, announces the move, and keeps the new order while it saves", async () => {
    let resolveReorder: () => void = () => undefined;
    const onReorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReorder = resolve;
        }),
    );
    const renderQueue = (queueItems: readonly MessageQueueItem[]) =>
      act(() => {
        root.render(
          <MessageQueueDrawer
            items={queueItems}
            labels={labels}
            variant="recessed"
            onRemove={() => undefined}
            onReorder={onReorder}
          />,
        );
      });
    renderQueue(items);

    const handle = container.querySelectorAll<HTMLButtonElement>(
      '[data-agent-message-queue-handle="true"]',
    )[1]!;
    expect(handle.getAttribute("aria-label")).toBe("Drag to reorder");
    handle.focus();
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onReorder).toHaveBeenCalledWith(["second", "first"]);
    const rowText = () =>
      Array.from(container.querySelectorAll("li")).map((row) =>
        row.textContent?.trim(),
      );
    expect(rowText()[0]).toContain("Summarize the changes");
    expect(
      container.querySelector("[data-agent-message-queue-announcement]")
        ?.textContent,
    ).toBe("Moved to position 1 of 2");
    expect(document.activeElement?.closest("li")?.textContent).toContain(
      "Summarize the changes",
    );

    await act(async () => {
      resolveReorder();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The host has not caught up yet; the confirmed order stays on screen.
    expect(rowText()[0]).toContain("Summarize the changes");
    renderQueue([items[1]!, items[0]!]);
    expect(rowText()[0]).toContain("Summarize the changes");
  });

  it("rolls the order back and shows a notice when the reorder fails", async () => {
    const onReorder = vi.fn(async () => {
      throw new Error("conflict");
    });
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={items}
          labels={labels}
          variant="recessed"
          onRemove={() => undefined}
          onReorder={onReorder}
        />,
      );
    });

    const firstRow = container.querySelector("li")!;
    await act(async () => {
      firstRow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onReorder).toHaveBeenCalledWith(["second", "first"]);
    expect(container.querySelector("li")?.textContent).toContain(
      "Inspect the workspace",
    );
    const notice = container.querySelector(
      '[data-notice="message-queue-reorder-failed"]',
    );
    expect(notice?.textContent).toContain(
      "Couldn't reorder the queue. Try again.",
    );
    expect(notice?.getAttribute("data-tone")).toBe("warning");
  });

  it("offers Move up and Move down in the row menu", async () => {
    const onReorder = vi.fn();
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={[...items, { id: "third", text: "Write the follow-up" }]}
          labels={labels}
          onRemove={() => undefined}
          onReorder={onReorder}
        />,
      );
    });

    const middleMore = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="More actions"]',
    )[1]!;
    await act(async () => {
      middleMore.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });
    const menuItems = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Move up",
      "Move down",
    ]);
    await act(async () => {
      menuItems[1]!.click();
      await Promise.resolve();
    });
    expect(onReorder).toHaveBeenCalledWith(["first", "third", "second"]);
  });

  it("drags a row by its handle and commits the drop position", async () => {
    const onReorder = vi.fn();
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={[...items, { id: "third", text: "Write the follow-up" }]}
          labels={labels}
          variant="recessed"
          onRemove={() => undefined}
          onReorder={onReorder}
        />,
      );
    });
    const rows = Array.from(container.querySelectorAll("li"));
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () =>
        ({ top: index * 32, height: 32 }) as DOMRect;
    });
    const handle = container.querySelector<HTMLButtonElement>(
      '[data-agent-message-queue-handle="true"]',
    )!;
    const pointer = (type: string, clientY: number) =>
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientY,
      });

    act(() => {
      handle.dispatchEvent(pointer("pointerdown", 16));
    });
    act(() => {
      handle.dispatchEvent(pointer("pointermove", 60));
    });
    const dragged = container.querySelector<HTMLElement>(
      'li[data-dragging="true"]',
    );
    expect(dragged?.style.transform).toBe("translateY(44px)");
    expect(
      container.querySelectorAll<HTMLElement>("li")[1]!.style.transform,
    ).toBe("translateY(-36px)");
    await act(async () => {
      handle.dispatchEvent(pointer("pointerup", 60));
      await Promise.resolve();
    });
    expect(onReorder).toHaveBeenCalledWith(["second", "first", "third"]);

    // Dragged past the end, the row clamps to the last slot.
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", 16));
    });
    act(() => {
      handle.dispatchEvent(pointer("pointermove", 400));
    });
    await act(async () => {
      handle.dispatchEvent(pointer("pointerup", 400));
      await Promise.resolve();
    });
    expect(onReorder).toHaveBeenLastCalledWith(["second", "third", "first"]);
    expect(container.querySelector('li[data-dragging="true"]')).toBe(null);
  });
});
