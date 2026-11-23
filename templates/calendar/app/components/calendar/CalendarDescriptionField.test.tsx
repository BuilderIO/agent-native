// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  CalendarDescriptionField,
  keepEscapeWhileComposing,
} from "./CalendarDescriptionField";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string): string =>
      key,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderField(
  onSave: (description: string) => void,
  { inPopover = false } = {},
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const field = <CalendarDescriptionField value={undefined} onSave={onSave} />;
  await act(async () => {
    root?.render(
      inPopover ? (
        <Popover defaultOpen>
          <PopoverTrigger>Color</PopoverTrigger>
          <PopoverContent onEscapeKeyDown={keepEscapeWhileComposing}>
            {field}
          </PopoverContent>
        </Popover>
      ) : (
        field
      ),
    );
  });
  const textarea = document.querySelector("textarea");
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

async function pressKey(
  textarea: HTMLTextAreaElement,
  key: string,
  { isComposing = false, keyCode = key === "Enter" ? 13 : 27 } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    isComposing,
  });
  Object.defineProperty(event, "keyCode", { value: keyCode });
  await act(async () => {
    textarea.dispatchEvent(event);
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
    await pressKey(textarea, "Enter");

    expect(onSave).toHaveBeenCalledWith("Team rota");
  });

  it("doesn't save on the Enter that ends an input method composition", async () => {
    const onSave = vi.fn();
    const textarea = await renderField(onSave);

    await typeText(textarea, "会議");
    await pressKey(textarea, "Enter", { isComposing: true });

    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it("doesn't save on a composition Enter reported only by its key code", async () => {
    const onSave = vi.fn();
    const textarea = await renderField(onSave);

    await typeText(textarea, "会議");
    await pressKey(textarea, "Enter", { keyCode: 229 });

    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it("keeps its popover open on the Escape that cancels a composition", async () => {
    const onSave = vi.fn();
    const textarea = await renderField(onSave, { inPopover: true });

    await typeText(textarea, "会議");
    await pressKey(textarea, "Escape", { keyCode: 229 });

    expect(document.querySelector("textarea")).toBe(textarea);
    expect(onSave).not.toHaveBeenCalled();

    await pressKey(textarea, "Escape");

    expect(document.querySelector("textarea")).toBeNull();
  });
});
