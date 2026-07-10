// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client";
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
