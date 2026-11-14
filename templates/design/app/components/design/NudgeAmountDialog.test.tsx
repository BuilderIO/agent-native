// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

function lookup(key: string): string {
  let node: unknown = enUS;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : key;
}

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => lookup(key),
}));

import { NudgeAmountDialog } from "./NudgeAmountDialog";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderDialog(
  props: Partial<React.ComponentProps<typeof NudgeAmountDialog>> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const nextRoot = createRoot(container);
  root = nextRoot;
  const onClose = vi.fn();
  const onNudgeAmountsChange = vi.fn();
  await act(async () => {
    nextRoot.render(
      <NudgeAmountDialog
        open
        onClose={onClose}
        nudgeAmounts={{ small: 1, big: 10 }}
        onNudgeAmountsChange={onNudgeAmountsChange}
        {...props}
      />,
    );
  });
  return { onClose, onNudgeAmountsChange };
}

describe("NudgeAmountDialog", () => {
  it("focuses the small nudge field on open", async () => {
    await renderDialog();
    expect(document.activeElement).toBe(
      document.querySelector('[data-nudge-amount="small"]'),
    );
  });

  it("reports edited amounts", async () => {
    const { onNudgeAmountsChange } = await renderDialog();
    const field = document.querySelector<HTMLInputElement>(
      '[data-nudge-amount="big"]',
    );
    if (!field) throw new Error("big nudge field not rendered");
    expect(field.value).toBe("10");
    // React tracks the value setter, so assign through the prototype.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("input value setter unavailable");
    await act(async () => {
      setter.call(field, "25");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onNudgeAmountsChange).toHaveBeenCalledWith({ small: 1, big: 25 });
  });

  it("closes from the Done button", async () => {
    const { onClose } = await renderDialog();
    const done = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Done",
    );
    if (!done) throw new Error("Done button not rendered");
    await act(async () => done.click());
    expect(onClose).toHaveBeenCalled();
  });
});
