// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarDescriptionField } from "./CalendarDescriptionField";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string): string =>
      key,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderField(onSave: (description: string) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <CalendarDescriptionField value={undefined} onSave={onSave} />,
    );
  });
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Description field isn't rendered");
  return textarea;
}

async function typeText(textarea: HTMLTextAreaElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    textarea.focus();
    setValue?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(textarea: HTMLTextAreaElement, isComposing: boolean) {
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing,
      }),
    );
  });
}

describe("CalendarDescriptionField", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("saves on Enter", async () => {
    const onSave = vi.fn();
    const textarea = await renderField(onSave);

    await typeText(textarea, "Team rota");
    await pressEnter(textarea, false);

    expect(onSave).toHaveBeenCalledWith("Team rota");
  });

  it("doesn't save on the Enter that ends an input method composition", async () => {
    const onSave = vi.fn();
    const textarea = await renderField(onSave);

    await typeText(textarea, "会議");
    await pressEnter(textarea, true);

    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });
});
