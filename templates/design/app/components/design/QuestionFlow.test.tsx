// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { QuestionFlow } from "./QuestionFlow";

// Minimal catalog covering only the keys QuestionFlow reads. Full catalog
// coverage across all locales is verified by `guard:i18n-catalogs`, not here.
const CATALOG_MESSAGES = {
  questionFlow: {
    defaultTitle: "Quick questions before I design",
    continue: "Continue",
    skip: "Decide for me",
    textPlaceholder: "Type your answer...",
    other: "Other",
    otherDescription: "Tell me exactly what you mean.",
    customPlaceholder: "Type a custom answer...",
    recommended: "Recommended",
    selectedCount: "{{count}} selected",
    selectUseful: "Select what's useful",
    exploreLabel: "Explore a few options",
    exploreDescription: "Show me a few distinct directions.",
    decideLabel: "Decide for me",
    decideDescription: "Use your judgment.",
    dragFiles: "Drag files here or",
    browse: "browse",
    removeFile: "Remove {{name}}",
  },
};

const DEFAULT_QUESTIONS: React.ComponentProps<
  typeof QuestionFlow
>["questions"] = [
  {
    id: "form_factor",
    type: "text-options",
    question: "What form factor?",
    options: [
      { label: "Mobile", value: "mobile" },
      { label: "Desktop", value: "desktop" },
    ],
    allowOther: false,
    includeExplore: false,
    includeDecide: false,
  },
];

async function renderQuestionFlow(
  props: Omit<React.ComponentProps<typeof QuestionFlow>, "questions"> & {
    questions?: React.ComponentProps<typeof QuestionFlow>["questions"];
  },
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const renderQuestions = async (
    questions: React.ComponentProps<typeof QuestionFlow>["questions"],
  ) => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
          <QuestionFlow questions={questions} {...props} />
        </AgentNativeI18nProvider>,
      );
    });
  };
  await renderQuestions(props.questions ?? DEFAULT_QUESTIONS);
  const findButton = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.toLowerCase().includes(label.toLowerCase()),
    );
  return {
    container,
    findButton,
    renderQuestions,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("QuestionFlow option ordering", () => {
  it("puts a recommended option first without recommending the decide option", async () => {
    const { container, cleanup } = await renderQuestionFlow({
      onSubmit: vi.fn(),
      onSkip: vi.fn(),
      skipLabel: "Skip",
      questions: [
        {
          id: "form_factor",
          type: "text-options",
          question: "What form factor?",
          options: [
            { label: "Decide for me", value: "decide", recommended: true },
            { label: "Mobile", value: "mobile" },
            { label: "Desktop", value: "desktop", recommended: true },
          ],
          allowOther: false,
          includeExplore: false,
          includeDecide: false,
        },
      ],
    });

    const optionButtons = Array.from(
      container.querySelectorAll("section button"),
    );
    expect(
      optionButtons.map((button) =>
        button.textContent
          ?.replace("Recommended", "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ).toEqual(["Desktop", "Decide for me", "Mobile"]);
    expect(optionButtons[0]?.textContent).toContain("Recommended");
    expect(optionButtons[1]?.textContent).not.toContain("Recommended");

    await cleanup();
  });
});

describe("QuestionFlow Other answers", () => {
  it("offers a write-in answer by default for text options", async () => {
    const onSubmit = vi.fn();
    const { container, findButton, cleanup } = await renderQuestionFlow({
      onSubmit,
      onSkip: vi.fn(),
      questions: [
        {
          id: "direction",
          type: "text-options",
          question: "What direction should I take?",
          required: true,
          options: [{ label: "Minimal", value: "minimal" }],
          includeExplore: false,
          includeDecide: false,
        },
      ],
    });

    const otherButton = findButton("Other");
    expect(otherButton).toBeTruthy();
    await act(async () => {
      otherButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    await act(async () => {
      setTextareaValue(textarea!, "A hand-drawn editorial look");
    });

    const continueButton = findButton("Continue");
    expect(continueButton?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      continueButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmit).toHaveBeenCalledWith({
      direction: "Other: A hand-drawn editorial look",
    });
    await cleanup();
  });

  it("offers a write-in answer for color options and keeps other selections", async () => {
    const onSubmit = vi.fn();
    const { container, findButton, cleanup } = await renderQuestionFlow({
      onSubmit,
      onSkip: vi.fn(),
      questions: [
        {
          id: "palette",
          type: "color-options",
          question: "Which palettes should I explore?",
          required: true,
          multiSelect: true,
          options: [
            {
              label: "Ocean",
              value: "ocean",
              color: "var(--design-editor-accent-color)",
            },
            {
              label: "Clay",
              value: "clay",
              color: "var(--design-editor-panel-bg)",
            },
          ],
          includeExplore: false,
          includeDecide: false,
        },
      ],
    });

    await act(async () => {
      findButton("Ocean")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      findButton("Other")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    await act(async () => {
      setTextareaValue(textarea!, "a muted forest green");
    });

    await act(async () => {
      findButton("Continue")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onSubmit).toHaveBeenCalledWith({
      palette: ["ocean", "Other: a muted forest green"],
    });
    await cleanup();
  });
});

describe("QuestionFlow double-submit guard", () => {
  it("only calls onSubmit once when Continue is clicked twice in a row", async () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { findButton, cleanup } = await renderQuestionFlow({
      onSubmit,
      onSkip,
    });

    // Select an option so the required-answered gate does not block submit.
    const mobileOption = findButton("Mobile");
    expect(mobileOption).toBeTruthy();
    await act(async () => {
      mobileOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const continueButton = findButton("Continue");
    expect(continueButton).toBeTruthy();

    await act(async () => {
      continueButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      continueButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(continueButton!.hasAttribute("disabled")).toBe(true);

    await cleanup();
  });

  it("only calls onSkip once when Skip is clicked twice in a row", async () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { findButton, cleanup } = await renderQuestionFlow({
      onSubmit,
      onSkip,
    });

    const skipButton = findButton("Decide for me");
    expect(skipButton).toBeTruthy();

    await act(async () => {
      skipButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      skipButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    await cleanup();
  });

  it("re-enables submit for a fresh question set after answering a previous one", async () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    const { findButton, renderQuestions, cleanup } = await renderQuestionFlow({
      onSubmit,
      onSkip,
    });

    const mobileOption = findButton("Mobile");
    await act(async () => {
      mobileOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const continueButton = findButton("Continue");
    await act(async () => {
      continueButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(findButton("Continue")!.hasAttribute("disabled")).toBe(true);

    // A new, different question set arrives (e.g. a follow-up clarifying
    // question later in the same design session) — the fingerprint changes,
    // so the guard must reset instead of leaving Continue disabled forever.
    await renderQuestions([
      {
        id: "palette",
        type: "text-options",
        question: "Which palette?",
        options: [{ label: "Warm", value: "warm" }],
        allowOther: false,
        includeExplore: false,
        includeDecide: false,
      },
    ]);

    const warmOption = findButton("Warm");
    await act(async () => {
      warmOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(findButton("Continue")!.hasAttribute("disabled")).toBe(false);

    await cleanup();
  });
});
