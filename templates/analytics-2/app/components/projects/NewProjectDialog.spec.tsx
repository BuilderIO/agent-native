// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { NewProjectDialog } from "./NewProjectDialog";

describe("NewProjectDialog", () => {
  it("renders its fields and a create failure", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <NewProjectDialog
            pending={false}
            error="That name is not allowed."
            onCancel={() => {}}
            onCreate={() => {}}
          />,
        ),
      );
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain("New project");
      expect(dialog?.textContent).toContain("Name");
      expect(dialog?.textContent).toContain("Description");
      expect(dialog?.textContent).toContain("Create project");
      expect(dialog?.textContent).toContain("Cancel");
      expect(dialog?.textContent).toContain("That name is not allowed.");
      expect(dialog?.querySelector("textarea")?.placeholder).toBe(
        "Add description...",
      );
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

it("keeps focus inside the project dialog when background content requests focus", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <>
          <input aria-label="Background composer" />
          <NewProjectDialog
            pending={false}
            error={null}
            onCancel={() => {}}
            onCreate={() => {}}
          />
        </>,
      ),
    );
    const name = document.querySelector<HTMLInputElement>(
      '[role="dialog"] input',
    );
    const background = container.querySelector<HTMLInputElement>(
      'input[aria-label="Background composer"]',
    );
    if (!name || !background)
      throw new Error("Expected project and background inputs");
    expect(document.activeElement).toBe(name);
    await act(async () => background.focus());
    expect(document.activeElement).toBe(name);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("report QA-1795061526.533909 rejects blank submissions and creates a trimmed name", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onCreate = vi.fn();
  try {
    await act(async () =>
      root.render(
        <NewProjectDialog
          pending={false}
          error={null}
          onCancel={() => {}}
          onCreate={onCreate}
        />,
      ),
    );
    const form = document.querySelector("[role=dialog] form");
    const input = document.querySelector<HTMLInputElement>(
      '[role=dialog] input[type="text"]',
    );
    const button = document.querySelector<HTMLButtonElement>(
      '[role=dialog] button[type="submit"]',
    );
    if (!form || !input || !button)
      throw new Error("Project form is missing controls");
    expect(button.disabled).toBe(true);
    await act(async () => {
      button.click();
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onCreate).not.toHaveBeenCalled();
    const change = async (value: string) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (!setter) throw new Error("Input value setter is missing");
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await change("   ");
    expect(button.disabled).toBe(true);
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onCreate).not.toHaveBeenCalled();
    await change("  Example project  ");
    expect(button.disabled).toBe(false);
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(onCreate).toHaveBeenCalledWith({
      title: "Example project",
      description: "",
    });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
