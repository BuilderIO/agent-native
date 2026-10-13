// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/chat/agentkit-chat", async () => {
  const React = await import("react");
  return {
    GuidedQuestionFlow: (props: { className?: string }) =>
      React.createElement("div", {
        "data-testid": "guided-question-flow",
        className: props.className,
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
});
