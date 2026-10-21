// @vitest-environment happy-dom

import type { ShareVisibilityTransition } from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareVisibilityConfirmDialog } from "./ShareVisibilityConfirmDialog.js";

function makeTransition(
  overrides: Partial<ShareVisibilityTransition> = {},
): ShareVisibilityTransition {
  return {
    pending: { from: "private", to: "org" },
    organizationName: null,
    submitting: false,
    error: null,
    request: vi.fn(),
    confirm: vi.fn(async () => undefined),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe("ShareVisibilityConfirmDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(
    transition: ShareVisibilityTransition,
    props: { detail?: React.ReactNode } = {},
  ) {
    await act(async () => {
      root.render(
        <ShareVisibilityConfirmDialog transition={transition} {...props} />,
      );
    });
  }

  const dialog = () =>
    document.body.querySelector<HTMLElement>('[role="alertdialog"]');
  const button = (label: string) =>
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ).find((candidate) => candidate.textContent?.trim() === label);

  it("renders nothing until a broadening change is pending", async () => {
    await render(makeTransition({ pending: null }));

    expect(dialog()).toBeNull();
  });

  it("names the organization only when it is known", async () => {
    await render(makeTransition());
    expect(dialog()?.textContent).toContain("Share with your organization?");
    expect(dialog()?.textContent).toContain("Everyone in your organization");

    await render(makeTransition({ organizationName: "Acme Co" }));
    expect(dialog()?.textContent).toContain("Share with Acme Co?");
    expect(dialog()?.textContent).toContain("Everyone in Acme Co");
  });

  it("covers every kind of content and adds resource-specific detail", async () => {
    await render(makeTransition(), { detail: "This also shares the chat." });

    expect(dialog()?.textContent).toContain(
      "including any messages, files, and other content",
    );
    expect(dialog()?.textContent).toContain("This also shares the chat.");
  });

  it("opens with Cancel focused so Enter cannot widen access by accident", async () => {
    await render(makeTransition());

    expect(document.activeElement).toBe(button("Cancel"));
  });

  it("confirms only from the confirm button and cancels from Cancel and Escape", async () => {
    const transition = makeTransition();
    await render(transition);

    act(() => button("Cancel")?.click());
    expect(transition.cancel).toHaveBeenCalledOnce();
    expect(transition.confirm).not.toHaveBeenCalled();

    act(() => {
      dialog()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(transition.cancel).toHaveBeenCalledTimes(2);

    act(() => button("Share with organization")?.click());
    expect(transition.confirm).toHaveBeenCalledOnce();
  });

  it("shows progress, keeps the confirm button focusable, and blocks cancel", async () => {
    await render(makeTransition({ submitting: true }));

    const confirm = button("Sharing...");
    expect(confirm?.getAttribute("aria-disabled")).toBe("true");
    expect(confirm?.hasAttribute("disabled")).toBe(false);
    expect(
      (
        document.body.querySelector(
          '[role="alertdialog"] button',
        ) as HTMLButtonElement | null
      )?.disabled,
    ).toBe(true);
  });

  it("shows the failure in the dialog and offers a retry", async () => {
    const transition = makeTransition({ error: "Could not update sharing" });
    await render(transition);

    expect(
      document.body.querySelector('[role="alertdialog"] [role="alert"]')
        ?.textContent,
    ).toBe("Could not update sharing");
    act(() => button("Retry")?.click());
    expect(transition.confirm).toHaveBeenCalledOnce();
  });
});
