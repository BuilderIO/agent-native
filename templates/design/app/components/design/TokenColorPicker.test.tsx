// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TokenColorPicker } from "./TokenColorPicker";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, string>) =>
    key === "designEditor.tokens.editColor"
      ? `Edit color for ${options?.name}`
      : key,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setInputValue(input: HTMLInputElement, next: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openAndCommitHex(
  onCommit: (value: string) => Promise<void>,
  nextHex: string,
) {
  await act(() =>
    root.render(
      <TooltipProvider>
        <TokenColorPicker name="Accent" value="#ff0000" onCommit={onCommit} />
      </TooltipProvider>,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Edit color for Accent"]',
  )!;
  await act(() => trigger.click());
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Hex"]',
  )!;
  await act(() => {
    input.focus();
    setInputValue(input, nextHex);
  });
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  return trigger;
}

describe("TokenColorPicker", () => {
  it("saves the picked color once and shows it until the save settles", async () => {
    let settle!: () => void;
    const onCommit = vi.fn(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    const trigger = await openAndCommitHex(onCommit, "3B82F6");

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#3b82f6");
    expect(trigger.style.backgroundColor).toBe("#3b82f6");

    await act(async () => settle());
    expect(trigger.style.backgroundColor).toBe("#ff0000");
  });

  it("falls back to the saved color and reports when the save fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onCommit = vi.fn().mockRejectedValue(new Error("write failed"));
    const trigger = await openAndCommitHex(onCommit, "00FF00");

    await act(async () => {});
    expect(onCommit).toHaveBeenCalledWith("#00ff00");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(trigger.style.backgroundColor).toBe("#ff0000");
  });

  it("does not offer the Libraries tab", async () => {
    await openAndCommitHex(vi.fn().mockResolvedValue(undefined), "3B82F6");
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });
});
