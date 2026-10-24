// @vitest-environment happy-dom

import type { ShareButtonController } from "@agent-native/core/client/sharing/useShareButtonController";
import {
  useShareVisibilityTransition,
  type ShareVisibilityTransition,
} from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareGeneralAccessRow } from "./ShareButton.js";

type Visibility = "private" | "org" | "public";

// The real picker (Radix Select) and the real confirmation (AlertDialog) over
// the real transition; only the save is replaced by a spy.
describe("organization confirmation from the keyboard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let transition: ShareVisibilityTransition;
  let saved: ReturnType<
    typeof vi.fn<(next: Visibility) => void | Promise<void>>
  >;

  function Harness() {
    const [visibility, setVisibility] = useState<Visibility>("private");
    transition = useShareVisibilityTransition({
      resourceType: "document",
      resourceId: "doc-1",
      current: visibility,
      orgId: null,
      canManage: true,
      active: true,
      apply: async (next) => {
        await saved(next);
        setVisibility(next);
      },
      onDirectError: () => undefined,
    });
    const controller = {
      visibility,
      canManage: true,
      policy: { allowPublic: true },
      handleVisibility: (next: Visibility) => void transition.request(next),
      visibilityTransition: transition,
    } as unknown as ShareButtonController;
    return <ShareGeneralAccessRow controller={controller} />;
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    saved = vi.fn();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  const trigger = () =>
    container.querySelector<HTMLButtonElement>(
      '[aria-label="General access"]',
    )!;
  const alertDialog = () =>
    document.body.querySelector<HTMLElement>('[role="alertdialog"]');
  const alertButton = (label: string) =>
    Array.from(
      alertDialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === label)!;
  const option = (label: string) =>
    Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((candidate) => candidate.textContent?.includes(label))!;

  /**
   * One keystroke the way a browser delivers it: keydown, then (for keys that
   * were not prevented) a keypress on whatever is focused by then, whose
   * default action presses a focused button, then keyup where focus is now.
   */
  function press(key: string, target: Element) {
    const code = key === " " ? "Space" : key;
    const down = new KeyboardEvent("keydown", {
      key,
      code,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(down);
    });
    const afterDown = document.activeElement ?? document.body;
    if (!down.defaultPrevented && key === "Enter") {
      const keypress = new KeyboardEvent("keypress", {
        key,
        code,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        afterDown.dispatchEvent(keypress);
      });
      if (
        !keypress.defaultPrevented &&
        afterDown instanceof HTMLButtonElement
      ) {
        act(() => afterDown.click());
      }
    }
    const up = new KeyboardEvent("keyup", {
      key,
      code,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(up);
    });
  }

  async function chooseOrganizationWith(key: "Enter" | " ") {
    trigger().focus();
    press("ArrowDown", trigger());
    const content = document.body.querySelector('[role="listbox"]')!;
    expect(content).not.toBeNull();
    const organization = option("Organization");
    (document.activeElement as HTMLElement | null)?.blur?.();
    organization.focus();
    press(key, organization);
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("disables the existing picker for a physical direct save and enables it after settlement", async () => {
    let finish!: () => void;
    saved.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let applying!: Promise<void>;
    act(() => {
      applying = transition.request("public");
    });
    expect(trigger().disabled).toBe(true);
    expect(transition.submitting).toBe(true);
    await act(async () => {
      finish();
      await applying;
    });
    expect(trigger().disabled).toBe(false);
    expect(transition.submitting).toBe(false);
  });

  it("keeps Enter on the picker: Enter on Organization holds the change and opens the confirmation with Cancel focused", async () => {
    await chooseOrganizationWith("Enter");

    expect(saved).not.toHaveBeenCalled();
    expect(transition.pending).toEqual({ from: "private", to: "org" });
    expect(alertDialog()).not.toBeNull();
    expect(document.activeElement).toBe(alertButton("Cancel"));
  });

  it("keeps Space working the same way", async () => {
    await chooseOrganizationWith(" ");

    expect(saved).not.toHaveBeenCalled();
    expect(transition.pending).toEqual({ from: "private", to: "org" });
    expect(alertDialog()).not.toBeNull();
    expect(document.activeElement).toBe(alertButton("Cancel"));
  });

  it("cancels only on a deliberate press of Cancel", async () => {
    await chooseOrganizationWith("Enter");

    press("Enter", alertButton("Cancel"));

    expect(saved).not.toHaveBeenCalled();
    expect(transition.pending).toBeNull();
    expect(alertDialog()).toBeNull();
  });

  it("saves only on a deliberate press of the confirm button", async () => {
    await chooseOrganizationWith("Enter");
    expect(saved).not.toHaveBeenCalled();

    const dialogBefore = alertDialog();
    const cancel = alertButton("Cancel");
    press("Tab", cancel);
    // The browser's default action for Tab: the next control in the dialog.
    const confirm = alertButton("Share with organization");
    act(() => confirm.focus());
    expect(alertDialog()).toBe(dialogBefore);
    expect(document.activeElement).toBe(confirm);
    expect(saved).not.toHaveBeenCalled();

    press("Enter", confirm);
    await act(async () => {
      await Promise.resolve();
    });

    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith("org");
    expect(transition.pending).toBeNull();
  });

  it("closes on Escape without saving and hands focus back to the picker", async () => {
    await chooseOrganizationWith("Enter");

    press("Escape", alertButton("Cancel"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(saved).not.toHaveBeenCalled();
    expect(transition.pending).toBeNull();
    expect(alertDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
