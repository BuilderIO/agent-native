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
  steer: "Steer",
  steerHint: "Send this message next",
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
              id: "move-to-top",
              label: "Move to top",
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
    expect(drawer?.className).toContain("bg-muted/55");
    expect(drawer?.className).toContain("shadow-none");
    expect(drawer?.className).toContain("rounded-xl");
    expect(drawer?.className).not.toContain("rounded-2xl");
    expect(
      container
        .querySelector<HTMLElement>('[data-agent-message-queue="true"]')
        ?.style.getPropertyValue("--agent-message-queue-height"),
    ).toBe("82px");
    expect(container.textContent).toContain("Inspect the workspace");
    expect(container.querySelectorAll("li")).toHaveLength(2);

    const steerButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Steer"),
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
    expect(menuItem?.textContent).toContain("Move to top");
    act(() => menuItem?.click());
    expect(onMoveToTop).toHaveBeenCalledWith(items[0]);
  });

  it("collapses the recessed queue into the composer workflow", () => {
    act(() => {
      root.render(
        <MessageQueueDrawer
          items={items.slice(0, 1)}
          labels={labels}
          variant="recessed"
          onRemove={() => undefined}
        />,
      );
    });

    const drawer = container.querySelector<HTMLElement>(
      '[data-agent-message-queue="true"]',
    );
    expect(drawer?.dataset.empty).toBe("false");
    expect(drawer?.style.getPropertyValue("--agent-message-queue-height")).toBe(
      "46px",
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
});
