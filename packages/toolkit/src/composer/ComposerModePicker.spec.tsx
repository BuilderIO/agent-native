// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerModePicker } from "./ComposerModePicker.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="menu"]').forEach((element) => {
    if (!container.contains(element)) element.remove();
  });
});

function ModePickerHarness({
  onChange,
}: {
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState("ask");
  return (
    <ComposerModePicker
      ariaLabel="Ask mode"
      options={[
        { value: "ask", label: "Ask", description: "Answer with context." },
        { value: "default", label: "Default" },
      ]}
      value={value}
      onValueChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe("ComposerModePicker", () => {
  it("shows the selected host option and updates it through the shared menu", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(<ModePickerHarness onChange={onChange} />),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="mode-picker"]',
    )!;
    expect(trigger.getAttribute("aria-label")).toBe("Ask mode: Ask");

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const defaultOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((option) => option.textContent?.trim() === "Default");
    expect(defaultOption).toBeDefined();
    await act(async () => defaultOption!.click());

    expect(onChange).toHaveBeenCalledWith("default");
    expect(trigger.textContent).toContain("Default");
    expect(trigger.getAttribute("aria-label")).toBe("Ask mode: Default");
  });

  it("keeps an unavailable selected value visible instead of choosing another mode", async () => {
    await act(async () =>
      root.render(
        <ComposerModePicker
          ariaLabel="Ask mode"
          options={[{ value: "ask", label: "Ask" }]}
          value="custom"
          onValueChange={() => {}}
        />,
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="mode-picker"]',
    );
    expect(trigger?.textContent).toContain("custom");
    expect(trigger?.getAttribute("aria-label")).toBe("Ask mode: custom");
  });
});
