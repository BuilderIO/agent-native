// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolbarBreadcrumb } from "./DocumentToolbar";

describe("breadcrumb menu interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  async function render() {
    const onOpen = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(ToolbarBreadcrumb, {
          items: [
            {
              id: "parent",
              title: "Research",
              menuItems: [
                { id: "parent", title: "Research" },
                { id: "sibling", title: "Planning" },
              ],
            },
            { id: "current", title: "Notes" },
          ],
          currentDocumentId: "current",
          ariaLabel: "Page breadcrumb",
          untitledLabel: "Untitled",
          onOpen,
        }),
      );
    });
    return { trigger: container.querySelector("button")!, onOpen };
  }

  async function pointer(
    target: HTMLElement,
    type: string,
    pointerType = "mouse",
  ) {
    await act(async () => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType,
          button: 0,
        }),
      );
    });
  }

  it("keeps the menu open when a pointer clicks after hovering", async () => {
    const { trigger, onOpen } = await render();
    await pointer(trigger, "pointerover");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await pointer(trigger, "pointerdown");
    await pointer(trigger, "pointerup");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
      items[1].click();
    });
    expect(onOpen).toHaveBeenCalledWith("sibling");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens with a touch press without treating touch entry as hover", async () => {
    const { trigger } = await render();
    await pointer(trigger, "pointerover", "touch");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await pointer(trigger, "pointerdown", "touch");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("still opens with Enter and dismisses with Escape", async () => {
    const { trigger } = await render();
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      document.querySelector('[role="menu"]')!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
