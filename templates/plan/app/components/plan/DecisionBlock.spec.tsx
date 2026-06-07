// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionData } from "@shared/blocks/decision.config";
import { DecisionEdit } from "./planBlocks";

function setInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("DecisionEdit", () => {
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

  it("keeps authored text inline and moves option metadata into the settings popover", () => {
    const changes: DecisionData[] = [];

    act(() => {
      root.render(
        <DecisionEdit
          blockId="decision-1"
          ctx={{}}
          data={{
            question: "Which path should we ship?",
            options: [
              {
                id: "fast",
                label: "Fast path",
                detail: "Small scoped update.",
                recommended: true,
              },
              {
                id: "broad",
                label: "Broad pass",
                detail: "Touch every related block.",
              },
            ],
          }}
          editable
          onChange={(next) => changes.push(next)}
        />,
      );
    });

    const textareas =
      container.querySelectorAll<HTMLTextAreaElement>("textarea");
    const question = textareas[0];
    const optionLabel = container.querySelector<HTMLInputElement>(
      'input[value="Fast path"]',
    );

    expect(question?.value).toBe("Which path should we ship?");
    expect(optionLabel?.value).toBe("Fast path");
    expect(container.textContent).not.toContain("Recommended");
    expect(container.textContent).not.toContain("Add option");

    setInputValue(question!, "Which path should we keep?");
    expect(changes[changes.length - 1]?.question).toBe(
      "Which path should we keep?",
    );

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit decision options"]',
    );
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Decision settings");
    expect(document.body.textContent).toContain("Recommended");
    expect(document.body.textContent).toContain("Add option");

    const broadRecommendedButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Mark recommended");
    expect(broadRecommendedButton).toBeTruthy();

    act(() => {
      broadRecommendedButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(changes[changes.length - 1]?.options[1]?.recommended).toBe(true);
  });
});
