// @vitest-environment happy-dom

import { Popover, PopoverAnchor } from "@agent-native/toolkit/ui/popover";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReviewMentionPicker,
  reviewMentionOptionId,
  type ReviewMentionOption,
} from "./ReviewMentionPicker.js";

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

const alice: ReviewMentionOption = {
  label: "Alice",
  email: "alice@example.com",
};
const bob: ReviewMentionOption = { label: "Bob", email: "bob@example.com" };
const carol: ReviewMentionOption = {
  label: "Carol",
  email: "carol@example.com",
  description: "Design",
};
const claude: ReviewMentionOption = {
  label: "Claude Sonnet 5.5",
  email: null,
  id: "agent:claude:claude-sonnet-5.5",
  description: "Anthropic",
};
const gpt: ReviewMentionOption = {
  label: "GPT-5.4",
  email: null,
  id: "agent:codex:gpt-5.4",
  description: "OpenAI",
};

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
    const onSelect = vi.fn<(mention: ReviewMentionOption) => void>();
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
              agentsLabel="Agents"
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

  function rowLabel(row: Element): string | undefined {
    return row.querySelector(".truncate")?.textContent ?? undefined;
  }

  function optionRow(label: string): HTMLElement | undefined {
    return options().find((row) => rowLabel(row) === label);
  }

  function rowSecondLine(label: string): string | undefined {
    return (
      optionRow(label)?.querySelectorAll(".truncate")[1]?.textContent ??
      undefined
    );
  }

  /** The listbox's children in order, each named by what it is. */
  function listboxChildren(): string[] {
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
    return Array.from(listbox?.children ?? []).map((child) => {
      if (child.hasAttribute("data-review-mention-separator")) {
        return "separator";
      }
      if (child.getAttribute("role") === "option") {
        return `option:${rowLabel(child)}`;
      }
      return `heading:${child.textContent}`;
    });
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

  it("draws initials in white on the person's own avatar color", async () => {
    await renderPicker();
    const [first] = options();
    const fallback = first?.querySelector(
      '[aria-hidden="true"]',
    )?.firstElementChild;
    expect(fallback?.textContent).toBe("A");
    expect(
      Array.from(fallback?.classList ?? []).some((name) =>
        name.startsWith("bg-[hsl(var(--review-avatar-"),
      ),
    ).toBe(true);
    expect(
      fallback?.classList.contains(
        "text-[hsl(var(--review-avatar-foreground,0_0%_100%))]",
      ),
    ).toBe(true);
    expect(fallback?.classList.contains("bg-muted")).toBe(false);
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

  it("lists people with no heading or separator when there are no agents", async () => {
    await renderPicker({ options: [alice, bob] });
    expect(listboxChildren()).toEqual(["option:Alice", "option:Bob"]);
    expect(
      document.querySelector('[role="listbox"]')?.textContent,
    ).not.toContain("Agents");
  });

  it("puts a separator and the Agents heading before the first agent", async () => {
    await renderPicker({ options: [alice, bob, claude, gpt] });
    expect(listboxChildren()).toEqual([
      "option:Alice",
      "option:Bob",
      "separator",
      "heading:Agents",
      "option:Claude Sonnet 5.5",
      "option:GPT-5.4",
    ]);
  });

  it("shows the heading without a leading separator when only agents are listed", async () => {
    await renderPicker({ options: [claude, gpt] });
    expect(listboxChildren()).toEqual([
      "heading:Agents",
      "option:Claude Sonnet 5.5",
      "option:GPT-5.4",
    ]);
  });

  it("shows the description on the second line only when there is no email", async () => {
    await renderPicker({ options: [alice, carol, claude] });
    expect(rowSecondLine("Alice")).toBe("alice@example.com");
    expect(rowSecondLine("Carol")).toBe("carol@example.com");
    expect(rowSecondLine("Claude Sonnet 5.5")).toBe("Anthropic");
  });

  it("keeps the heading out of the options and the ids on one flat index", async () => {
    await renderPicker({ options: [alice, bob, claude, gpt], activeIndex: 2 });
    const heading = document.querySelector<HTMLElement>(
      "[data-review-mention-heading]",
    );
    expect(heading?.textContent).toBe("Agents");
    expect(heading?.getAttribute("role")).toBe("presentation");
    expect(heading?.id).toBe("");
    expect(options().map((option) => option.id)).toEqual([
      reviewMentionOptionId("picker", 0),
      reviewMentionOptionId("picker", 1),
      reviewMentionOptionId("picker", 2),
      reviewMentionOptionId("picker", 3),
    ]);
    expect(
      document
        .querySelector("[data-review-mention-separator]")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      document.querySelectorAll("[data-review-mention-option][data-active]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-review-mention-option][data-active]")
        ?.textContent,
    ).toContain("Claude Sonnet 5.5");
    expect(
      options().map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["false", "false", "true", "false"]);

    await renderPicker({ options: [alice, bob, claude, gpt], activeIndex: 3 });
    expect(
      document.querySelector("[data-review-mention-option][data-active]")
        ?.textContent,
    ).toContain("GPT-5.4");
  });

  it("reports the flat row index when the pointer moves over an agent", async () => {
    const { onActiveIndexChange } = await renderPicker({
      options: [alice, bob, claude, gpt],
    });
    const gptRow = optionRow("GPT-5.4");
    expect(gptRow).toBeTruthy();
    await act(async () => {
      gptRow?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    });
    expect(onActiveIndexChange).toHaveBeenCalledWith(3);
  });

  it("selects an agent row and passes the whole option", async () => {
    const { onSelect } = await renderPicker({ options: [alice, claude, gpt] });
    await act(async () => optionRow("GPT-5.4")?.click());
    expect(onSelect).toHaveBeenCalledWith(gpt);
  });
});
