// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { default: messages } = await import("../../../app/i18n/en-US");
  const translate = (key: string, options?: Record<string, unknown>) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        messages,
      );
    if (typeof value !== "string") return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    );
  };
  return { useT: () => translate };
});

import { LookbackRow, type LookbackRowProps } from "./LookbackRow";

// Radix measures with ResizeObserver, which jsdom does not provide.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as typeof ResizeObserver;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DOCS_URL =
  "https://www.agent-native.com/docs/template-clips-features#earlier-screen-time";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<LookbackRowProps> = {}) {
  const handlers = {
    onSecondsChange: vi.fn(),
    onTurnOnRewind: vi.fn(),
  };
  act(() => {
    root.render(
      <LookbackRow
        seconds={0}
        recentSeconds={[]}
        rewindOn
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

function trigger(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>("button.row-button");
  if (!button) throw new Error("Include last trigger is missing");
  return button;
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

function openMenu() {
  act(() => {
    trigger().dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
}

function menuItemTexts(): string[] {
  return Array.from(
    document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'),
  ).map((item) => item.textContent?.trim() ?? "");
}

function menuItemWithText(text: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((item) => item.textContent?.trim() === text);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LookbackRow with Rewind off", () => {
  it("stays enabled and reads Off without offering any preset", () => {
    const handlers = render({ seconds: 30, rewindOn: false });

    expect(trigger().disabled).toBe(false);
    expect(trigger().textContent).toContain("Off");
    expect(trigger().textContent).not.toContain("30 s");
    expect(buttonWithText("Turn on Rewind")).toBeUndefined();
    expect(handlers.onSecondsChange).not.toHaveBeenCalled();
  });

  it("opens the explanation popover instead of the dropdown", () => {
    const handlers = render({ seconds: 30, rewindOn: false });

    act(() => trigger().click());

    expect(menuItemTexts()).toEqual([]);
    expect(document.body.textContent).toContain("Turn on Rewind");
    expect(document.body.textContent).toContain(
      "Rewind keeps a local history of your screen",
    );

    const turnOn = buttonWithText("Turn on Rewind");
    expect(turnOn).toBeDefined();
    act(() => turnOn?.click());
    expect(handlers.onTurnOnRewind).toHaveBeenCalledTimes(1);
    expect(handlers.onSecondsChange).not.toHaveBeenCalled();
  });

  it("links to the guide from the popover and closes the popover", () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const handlers = render({ seconds: 30, rewindOn: false, openUrl });

    act(() => trigger().click());
    act(() => buttonWithText("What is this?")?.click());

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(DOCS_URL);
    expect(handlers.onTurnOnRewind).not.toHaveBeenCalled();
    expect(handlers.onSecondsChange).not.toHaveBeenCalled();
  });
});

describe("LookbackRow with Rewind on", () => {
  it("shows the chosen length and the menu presets, remembered values, Custom, and What is this?", () => {
    render({ seconds: 300, recentSeconds: [45, 120], rewindOn: true });

    expect(trigger().disabled).toBe(false);
    expect(trigger().textContent).toContain("5 min");
    expect(buttonWithText("Turn on Rewind")).toBeUndefined();

    openMenu();
    expect(menuItemTexts()).toEqual([
      "Off",
      "30 s",
      "5 min",
      "45 s",
      "2 min",
      "Custom…",
      "What is this?",
    ]);
  });

  it("refuses a custom length over five minutes and accepts a valid one", async () => {
    const handlers = render({ seconds: 0, rewindOn: true });

    openMenu();
    const custom = menuItemWithText("Custom…");
    expect(custom).toBeDefined();
    act(() => custom?.click());
    // Radix releases the menu's focus on a timer before the custom input opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Length"]',
    );
    expect(input).not.toBeNull();
    const form = input?.closest("form") as HTMLFormElement;

    act(() => setInputValue(input as HTMLInputElement, "301"));
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(handlers.onSecondsChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Keep it to 5 min or less.",
    );

    act(() => setInputValue(input as HTMLInputElement, "120"));
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(handlers.onSecondsChange).toHaveBeenCalledWith(120);
  });

  it("opens the guide from What is this? without changing the value", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const handlers = render({ seconds: 300, rewindOn: true, openUrl });

    openMenu();
    const whatIsThis = menuItemWithText("What is this?");
    expect(whatIsThis).toBeDefined();
    act(() => whatIsThis?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(DOCS_URL);
    expect(handlers.onSecondsChange).not.toHaveBeenCalled();
    expect(handlers.onTurnOnRewind).not.toHaveBeenCalled();
  });

  it("logs a rejected open and does not throw", async () => {
    const failure = new Error("shell open denied");
    const openUrl = vi.fn().mockRejectedValue(failure);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render({ rewindOn: true, openUrl });

    openMenu();
    const whatIsThis = menuItemWithText("What is this?");
    expect(() => act(() => whatIsThis?.click())).not.toThrow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(consoleError).toHaveBeenCalledWith(
      "[clips-lookback] open help failed:",
      failure,
    );
    consoleError.mockRestore();
  });

  it("has no separate help button beside the row", () => {
    render({ rewindOn: true });

    expect(
      host.querySelector('button[aria-label="About earlier screen time"]'),
    ).toBeNull();
  });
});
