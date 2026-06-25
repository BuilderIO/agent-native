// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockRenderContext } from "../types.js";
import type { QuestionFormData } from "./question-form.config.js";
import { QuestionFormRead } from "./question-form.js";

function menuSurface({
  trigger,
  children,
  open,
  onOpenChange,
}: Parameters<NonNullable<BlockRenderContext["renderEditSurface"]>>[0]) {
  return (
    <div>
      <span onClick={() => onOpenChange?.(!open)}>{trigger}</span>
      {open ? <div role="menu">{children}</div> : null}
    </div>
  );
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

function buttonContaining(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(text),
  );
  expect(button, `expected button containing "${text}"`).toBeTruthy();
  return button as HTMLButtonElement;
}

describe("QuestionFormRead handoff state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  const data: QuestionFormData = {
    submitLabel: "Send to agent",
    questions: [
      {
        id: "token-secrets",
        title: "Should MCP_TOKEN and API_TOKEN be the same value?",
        mode: "single",
        options: [
          {
            id: "different",
            label: "Different secrets",
            detail: "Limits blast radius.",
          },
          {
            id: "same",
            label: "Same token",
            detail: "Simpler setup.",
          },
        ],
      },
      {
        id: "tool-inputs",
        title: "Should the tool expose title and voice inputs?",
        mode: "single",
        options: [
          {
            id: "full",
            label: "Urls plus title and voice",
          },
          {
            id: "urls",
            label: "Urls only",
          },
        ],
      },
    ],
  };

  it("collapses answered questions after copying the prompt and can reopen them", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      root.render(
        <QuestionFormRead
          blockId="questions-1"
          title="Open questions"
          data={data}
          ctx={{ renderEditSurface: menuSurface }}
        />,
      );
    });

    click(buttonContaining(container, "Same token"));
    click(buttonContaining(container, "Urls plus title and voice"));
    expect(container.textContent).toContain("2/2 answered");

    click(buttonContaining(container, "Send to agent"));
    await act(async () => {
      buttonContaining(container, "Copy for your agent").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Same token");
    expect(writeText.mock.calls[0]?.[0]).toContain("Urls plus title and voice");
    expect(container.textContent).toContain("Answers copied for your agent");
    expect(container.textContent).toContain("2/2 answered");
    expect(container.textContent).not.toContain(
      "Should MCP_TOKEN and API_TOKEN be the same value?",
    );

    click(buttonContaining(container, "Edit answers"));

    expect(container.textContent).toContain(
      "Should MCP_TOKEN and API_TOKEN be the same value?",
    );
    expect(container.textContent).toContain("2/2 answered");
  });
});
