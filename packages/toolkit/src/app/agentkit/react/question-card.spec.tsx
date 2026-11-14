// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionCard, type AgentKitQuestion } from "./question-card.js";

const questions: AgentKitQuestion[] = [
  {
    id: "cuisine",
    question: "Which cuisine?",
    options: [
      { value: "italian", label: "Italian" },
      { value: "thai", label: "Thai", recommended: true },
      { value: "mexican", label: "Mexican" },
    ],
  },
  {
    id: "courses",
    question: "Which courses?",
    multiSelect: true,
    options: [
      { value: "starter", label: "Starter" },
      { value: "main", label: "Main" },
      { value: "dessert", label: "Dessert" },
    ],
  },
];

describe("QuestionCard", () => {
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

  const options = () =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".agentkit-question-option",
      ),
    );
  const button = (name: string) => {
    const match = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === name,
    );
    if (!match) throw new Error(`No ${name} button`);
    return match;
  };
  const press = (target: Element | null, key: string) =>
    act(() => {
      target?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });

  it("picks with number keys and arrows, and focuses the next question", async () => {
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <QuestionCard
          questions={questions}
          onSubmit={onSubmit}
          onDismiss={vi.fn()}
        />,
      ),
    );

    // The recommended option comes first and holds the group's one tab stop.
    expect(options().map((option) => option.textContent)).toEqual([
      "1ThaiRecommended",
      "2Italian",
      "3Mexican",
    ]);
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
    expect(
      container
        .querySelector('[role="radiogroup"]')
        ?.getAttribute("aria-labelledby"),
    ).toBe(container.querySelector(".agentkit-question-text")?.id);

    const [first] = options();
    act(() => first?.focus());
    await press(first, "3");
    expect(options()[2]?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(options()[2]);
    await press(document.activeElement, "ArrowDown");
    expect(options()[0]?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(options()[0]);

    await act(async () => button("Next").click());
    // Focus moves to the new question instead of dropping to the page.
    expect(
      container.querySelector(".agentkit-question-text")?.textContent,
    ).toBe("Which courses?");
    expect(document.activeElement).toBe(options()[0]);
    expect(container.querySelector('[role="group"]')).not.toBeNull();

    await press(document.activeElement, "1");
    await press(document.activeElement, "3");
    expect(
      options().map((option) => option.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "true"]);
    await act(async () => button("Send").click());

    expect(onSubmit).toHaveBeenCalledWith({
      cuisine: { values: ["thai"] },
      courses: { values: ["starter", "dessert"] },
    });
  });

  it("lets a written answer replace a single choice", async () => {
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <QuestionCard
          questions={[questions[0] as AgentKitQuestion]}
          onSubmit={onSubmit}
          onDismiss={vi.fn()}
        />,
      ),
    );
    await act(async () => options()[1]?.click());
    const input = container.querySelector<HTMLInputElement>(
      ".agentkit-question-other input",
    );
    if (!input) throw new Error("No written answer");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "Korean");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options()[1]?.getAttribute("aria-checked")).toBe("false");
    // Number keys belong to the text while it has focus.
    await press(input, "2");
    expect(options()[1]?.getAttribute("aria-checked")).toBe("false");
    await press(input, "Enter");

    expect(onSubmit).toHaveBeenCalledWith({
      cuisine: { values: [], other: "Korean" },
    });
  });

  it("keeps a required question from being skipped, and dismisses on close", async () => {
    const onDismiss = vi.fn();
    await act(async () =>
      root.render(
        <QuestionCard
          questions={[
            { ...(questions[0] as AgentKitQuestion), required: true },
          ]}
          onSubmit={vi.fn()}
          onDismiss={onDismiss}
        />,
      ),
    );

    expect(button("Skip").disabled).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss questions"]',
        )
        ?.click(),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("answers a color, a slider and files", async () => {
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <QuestionCard
          questions={[
            {
              id: "accent",
              question: "Which accent?",
              allowOther: false,
              options: [
                { value: "teal", label: "Teal", color: "teal" },
                { value: "plum", label: "Plum", color: "#8e4585" },
              ],
            },
            {
              id: "volume",
              question: "How loud?",
              options: [],
              allowOther: false,
              range: { min: 0, max: 10, step: 1, initial: 5 },
            },
            {
              id: "brief",
              question: "Any brief to read?",
              options: [],
              allowOther: false,
              files: true,
            },
          ]}
          onSubmit={onSubmit}
          onDismiss={vi.fn()}
        />,
      ),
    );

    expect(
      container.querySelectorAll(".agentkit-question-swatch"),
    ).toHaveLength(2);
    expect(container.querySelector(".agentkit-question-other")).toBeNull();
    await act(async () => options()[1]?.click());
    await act(async () => button("Next").click());

    // The slider's shown value is already the answer.
    const slider = container.querySelector<HTMLInputElement>(
      '.agentkit-question-range input[type="range"]',
    );
    expect(slider?.value).toBe("5");
    expect(slider?.getAttribute("aria-labelledby")).toBe(
      container.querySelector(".agentkit-question-text")?.id,
    );
    expect(button("Next").disabled).toBe(false);
    await act(async () => {
      if (!slider) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(slider, "8");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      container.querySelector(".agentkit-question-range-value")?.textContent,
    ).toBe("8");
    await act(async () => button("Next").click());

    const brief = new File(["notes"], "brief.md", { type: "text/markdown" });
    const picker = container.querySelector<HTMLInputElement>(
      '.agentkit-question-files input[type="file"]',
    );
    expect(button("Send").disabled).toBe(true);
    await act(async () => {
      if (!picker) return;
      Object.defineProperty(picker, "files", {
        configurable: true,
        value: [brief],
      });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      container.querySelector(".agentkit-question-file-name")?.textContent,
    ).toBe("brief.md");
    expect(
      container
        .querySelector(".agentkit-question-file-remove")
        ?.getAttribute("aria-label"),
    ).toBe("Remove brief.md");
    await act(async () => button("Send").click());

    expect(onSubmit).toHaveBeenCalledWith({
      accent: { values: ["plum"] },
      volume: { values: ["8"] },
      brief: { values: [], files: [brief] },
    });
  });
});
