// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const callAction = vi.fn();
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("@agent-native/core/client/i18n", async () => {
  const messages = (await import("../../i18n/en-US")).default as Record<
    string,
    unknown
  >;
  const lookup = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : key;
  };
  return { useT: () => (key: string) => lookup(key) };
});

import { NewCollectionDialog } from "./NewCollectionDialog";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  document.body.innerHTML = "";
  callAction.mockReset();
});

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(element, value);
  act(() => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("marks Create as unavailable with an explanation while an email is typed but not added", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<NewCollectionDialog onClose={() => {}} />));
  const inputs = [...document.querySelectorAll("input")] as HTMLInputElement[];
  setValue(inputs[0] as HTMLInputElement, "QA pending");
  const create = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Create collection",
  ) as HTMLButtonElement;
  expect(create.getAttribute("aria-disabled")).toBeNull();
  expect(create.title).toBe("");

  const email = document.querySelector(
    'input[type="email"]',
  ) as HTMLInputElement;
  setValue(email, "qa-a@example.test");
  expect(create.getAttribute("aria-disabled")).toBe("true");
  expect(create.title).toBe("Add or clear the email address before creating.");
  expect(callAction).not.toHaveBeenCalled();

  setValue(email, "");
  expect(create.getAttribute("aria-disabled")).toBeNull();
  act(() => root.unmount());
});
