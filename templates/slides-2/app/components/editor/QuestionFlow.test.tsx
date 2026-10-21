// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/chat/agentkit-chat", async () => {
  const React = await import("react");
  return {
    GuidedQuestionFlow: (props: {
      className?: string;
      questions?: Array<{ submitOnSelect?: boolean }>;
    }) =>
      React.createElement("div", {
        "data-testid": "guided-question-flow",
        className: props.className,
        "data-submit-on-select": String(
          props.questions?.[0]?.submitOnSelect ?? false,
        ),
      }),
  };
});

import { QuestionFlow } from "./QuestionFlow.js";

afterEach(cleanup);

describe("QuestionFlow", () => {
  it("keeps the deck generation preview visible behind pending questions", () => {
    const { container } = render(
      <QuestionFlow questions={[]} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );

    const layer = screen.getByTestId("guided-question-flow");
    expect(layer.classList.contains("bg-background/65")).toBe(true);
    expect(layer.classList.contains("backdrop-blur-sm")).toBe(true);
    expect(
      container.firstElementChild?.classList.contains("bg-transparent"),
    ).toBe(true);
  });

  it("continues after a single-choice answer is selected", () => {
    render(
      <QuestionFlow
        questions={[
          {
            id: "visual-direction",
            type: "text-options",
            question: "Which visual direction should I use?",
            options: [{ label: "Literary classic", value: "literary-classic" }],
          },
        ]}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(
      screen
        .getByTestId("guided-question-flow")
        .getAttribute("data-submit-on-select"),
    ).toBe("true");
  });
});
