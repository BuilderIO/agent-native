// @vitest-environment happy-dom

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReviewMentionPicker,
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

type PickerProps = Pick<
  ComponentProps<typeof ReviewMentionPicker>,
  "options" | "activeIndex" | "onSelect" | "onActiveIndexChange"
>;

function Picker({
  options,
  activeIndex = 0,
  onSelect = () => {},
  onActiveIndexChange = () => {},
}: Partial<PickerProps> & Pick<PickerProps, "options">) {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button">Open</button>
      </DropdownMenuTrigger>
      <ReviewMentionPicker
        options={options}
        activeIndex={activeIndex}
        onActiveIndexChange={onActiveIndexChange}
        onSelect={onSelect}
        label="Mention someone"
        agentsLabel="Agents"
        emptyLabel="No people found"
      />
    </DropdownMenu>
  );
}

function menuChildren(): string[] {
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  return Array.from(menu?.children ?? []).map((child) => {
    if (child.getAttribute("role") === "separator") return "separator";
    if (child.getAttribute("role") === "menuitem") {
      return `option:${rowLabel(child)}`;
    }
    return `heading:${child.textContent}`;
  });
}

function rowLabel(row: Element): string | undefined {
  return row.querySelector(".truncate")?.textContent ?? undefined;
}

function rowSecondLine(label: string): string | undefined {
  const row = optionRow(label);
  return row?.querySelectorAll(".truncate")[1]?.textContent ?? undefined;
}

function optionRow(label: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-review-mention-option]"),
  ).find((row) => rowLabel(row) === label);
}

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

  async function render(node: React.ReactNode) {
    await act(async () => root.render(node));
    await act(async () => {});
  }

  it("lists people with no heading or separator when there are no agents", async () => {
    await render(<Picker options={[alice, bob]} />);
    expect(menuChildren()).toEqual(["option:Alice", "option:Bob"]);
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
      "Agents",
    );
  });

  it("puts a separator and the Agents heading before the first agent", async () => {
    await render(<Picker options={[alice, bob, claude, gpt]} />);
    expect(menuChildren()).toEqual([
      "option:Alice",
      "option:Bob",
      "separator",
      "heading:Agents",
      "option:Claude Sonnet 5.5",
      "option:GPT-5.4",
    ]);
  });

  it("shows the heading without a leading separator when only agents are listed", async () => {
    await render(<Picker options={[claude, gpt]} />);
    expect(menuChildren()).toEqual([
      "heading:Agents",
      "option:Claude Sonnet 5.5",
      "option:GPT-5.4",
    ]);
  });

  it("shows the description on the second line only when there is no email", async () => {
    await render(<Picker options={[alice, carol, claude]} />);
    expect(rowSecondLine("Alice")).toBe("alice@example.com");
    expect(rowSecondLine("Carol")).toBe("carol@example.com");
    expect(rowSecondLine("Claude Sonnet 5.5")).toBe("Anthropic");
  });

  it("keeps the heading out of the option list and moves the highlight across it", async () => {
    await render(
      <Picker options={[alice, bob, claude, gpt]} activeIndex={2} />,
    );
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    expect(
      document.querySelectorAll("[data-review-mention-option][data-active]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-review-mention-option][data-active]")
        ?.textContent,
    ).toContain("Claude Sonnet 5.5");

    await render(
      <Picker options={[alice, bob, claude, gpt]} activeIndex={3} />,
    );
    expect(
      document.querySelector("[data-review-mention-option][data-active]")
        ?.textContent,
    ).toContain("GPT-5.4");
  });

  it("reports the flat row index when the pointer moves over an agent", async () => {
    const onActiveIndexChange = vi.fn();
    await render(
      <Picker
        options={[alice, bob, claude, gpt]}
        onActiveIndexChange={onActiveIndexChange}
      />,
    );
    const gptRow = optionRow("GPT-5.4");
    expect(gptRow).toBeTruthy();
    await act(async () => {
      gptRow?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    });
    expect(onActiveIndexChange).toHaveBeenCalledWith(3);
  });

  it("selects an agent row and passes the whole option", async () => {
    const onSelect = vi.fn();
    await render(<Picker options={[alice, claude, gpt]} onSelect={onSelect} />);
    await act(async () => optionRow("GPT-5.4")?.click());
    expect(onSelect).toHaveBeenCalledWith(gpt);
  });
});
