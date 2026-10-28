// @vitest-environment happy-dom

import type { ReviewMention } from "@agent-native/core/review/types";
import { Popover, PopoverAnchor } from "@agent-native/toolkit/ui/popover";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReviewMentionPicker,
  reviewMentionOptionId,
} from "./ReviewMentionPicker.js";

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

const alice = { label: "Alice", email: "alice@example.com" };
const bob = { label: "Bob", email: "bob@example.com" };
const claude = { label: "Claude", id: "agent:claude" };

describe("ReviewMentionPicker", () => {
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

  async function renderPicker(
    props: Partial<Parameters<typeof ReviewMentionPicker>[0]> = {},
    open = true,
  ) {
    const onSelect = vi.fn<(mention: ReviewMention) => void>();
    const onActiveIndexChange = vi.fn<(index: number) => void>();
    await act(async () =>
      root.render(
        <>
          <input data-testid="editor" />
          <Popover open={open}>
            <PopoverAnchor asChild>
              <div />
            </PopoverAnchor>
            <ReviewMentionPicker
              options={[alice, bob, claude]}
              activeIndex={1}
              onActiveIndexChange={onActiveIndexChange}
              onSelect={onSelect}
              label="Mention someone"
              emptyLabel="No people found"
              listboxId="picker"
              {...props}
            />
          </Popover>
        </>,
      ),
    );
    await act(async () => {});
    return { onSelect, onActiveIndexChange };
  }

  function options() {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
  }

  it("is a named listbox of options with stable ids and one selected", async () => {
    await renderPicker();
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(listbox?.id).toBe("picker");
    expect(listbox?.getAttribute("aria-label")).toBe("Mention someone");
    expect(listbox?.hasAttribute("data-review-popover")).toBe(true);
    expect(listbox?.getAttribute("data-side")).toBe("top");
    expect(listbox?.className).toContain("w-[296px]");

    const items = options();
    expect(items.map((item) => item.id)).toEqual([
      reviewMentionOptionId("picker", 0),
      reviewMentionOptionId("picker", 1),
      reviewMentionOptionId("picker", 2),
    ]);
    expect(items.map((item) => item.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(items.every((item) => listbox?.contains(item))).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
  });

  it("keeps the avatar out of each option's name", async () => {
    await renderPicker();
    const [first] = options();
    const hidden = first?.querySelector('[aria-hidden="true"]');
    expect(hidden?.textContent).toBe("A");
    expect(first?.textContent).toBe("AAlicealice@example.com");
  });

  it("draws initials in the foreground token on the muted avatar fallback", async () => {
    await renderPicker();
    const [first] = options();
    const fallback = first?.querySelector(
      '[aria-hidden="true"]',
    )?.firstElementChild;
    expect(fallback?.textContent).toBe("A");
    expect(fallback?.classList.contains("bg-muted")).toBe(true);
    expect(fallback?.classList.contains("text-foreground")).toBe(true);
    expect(fallback?.classList.contains("text-muted-foreground")).toBe(false);
  });

  it("selects on click, highlights on hover and never takes a press's focus", async () => {
    const { onSelect, onActiveIndexChange } = await renderPicker();
    const [first, second] = options();

    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    second?.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);

    act(() => {
      first?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });
    expect(onActiveIndexChange).toHaveBeenCalledWith(0);

    await act(async () => second?.click());
    expect(onSelect).toHaveBeenCalledWith(bob);
  });

  it("leaves focus in the field when it opens", async () => {
    await renderPicker({}, false);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    const editor = container.querySelector<HTMLInputElement>("input");
    editor?.focus();
    expect(document.activeElement).toBe(editor);

    await renderPicker();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  it("shows the empty copy without a listbox", async () => {
    await renderPicker({ options: [] });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(options()).toHaveLength(0);
    const empty = document.body.textContent;
    expect(empty).toContain("No people found");
    // The composer's live region announces it, so the visible copy is hidden
    // from assistive technology.
    const copy = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ).find((element) => element.textContent === "No people found");
    expect(copy).toBeTruthy();
  });
});
