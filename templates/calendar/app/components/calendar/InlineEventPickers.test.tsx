// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimePickerPopover, TimezonePickerPopover } from "./InlineEventPickers";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("TimePickerPopover", () => {
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

  it("keeps whole-hour labels consistent and reserves the checkmark slot", () => {
    act(() => {
      root.render(
        <TimePickerPopover
          value="22:00"
          label="End"
          onChange={() => undefined}
          getOptionMeta={(option) => (option === "22:00" ? "1h" : undefined)}
        />,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="End"]',
    );
    expect(trigger?.textContent).toBe("10:00 PM");

    const optionButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button !== trigger);
    const selected = optionButtons.find((button) =>
      button.textContent?.includes("10:00 PM"),
    );
    const unselected = optionButtons.find((button) =>
      button.textContent?.includes("10:15 PM"),
    );

    expect(selected?.querySelector("svg")).toBeTruthy();
    expect(unselected?.querySelector("svg")).toBeNull();
    expect(selected?.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(unselected?.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("keeps the timezone picker compact and accessible when requested", () => {
    act(() => {
      root.render(
        <TimezonePickerPopover
          compact
          value="America/Halifax"
          label="Timezone"
          onChange={() => undefined}
        />,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Timezone"]',
    );
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toBe("");
    expect(trigger?.getAttribute("title")).toBe("Timezone");
  });
});
