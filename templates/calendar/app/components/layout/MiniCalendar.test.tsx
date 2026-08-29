// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiniCalendar } from "./MiniCalendar";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ data: { weekStart: "sunday" } }),
}));

describe("MiniCalendar month navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  const monthLabel = () =>
    container.querySelector("button")?.textContent?.trim() ?? "";

  const clickNav = (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`no ${label} button rendered`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

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

  const render = (selectedDate: Date) => {
    act(() => {
      root.render(
        <MiniCalendar
          selectedDate={selectedDate}
          onDateSelect={() => undefined}
        />,
      );
    });
  };

  it("moves to the previous month when the up chevron is clicked", () => {
    render(new Date(2026, 7, 9));
    expect(monthLabel()).toBe("August 2026");

    clickNav("sidebar.previousMonth");
    expect(monthLabel()).toBe("July 2026");
  });

  it("moves to the next month when the down chevron is clicked", () => {
    render(new Date(2026, 7, 9));

    clickNav("sidebar.nextMonth");
    expect(monthLabel()).toBe("September 2026");
  });

  it("keeps advancing across repeated clicks and over a year boundary", () => {
    render(new Date(2026, 11, 15));
    expect(monthLabel()).toBe("December 2026");

    clickNav("sidebar.nextMonth");
    clickNav("sidebar.nextMonth");
    expect(monthLabel()).toBe("February 2027");
  });

  /**
   * Two clicks landing in one React batch must still advance two months. A
   * user who clicks and sees nothing happen clicks again immediately, so this
   * is the path the report actually exercised.
   */
  it("advances one month per click when two clicks land in the same batch", () => {
    render(new Date(2026, 7, 9));

    const next = container.querySelector<HTMLButtonElement>(
      'button[aria-label="sidebar.nextMonth"]',
    );
    if (!next) throw new Error("no next-month button rendered");
    act(() => {
      next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(monthLabel()).toBe("October 2026");
  });

  /**
   * The reported no-op: the mini calendar shares `selectedDate` with the rest of
   * the app, and a re-render from any unrelated source (settings refetch, agent
   * navigation writing an equal-but-new Date) must not snap the browsed month
   * back to the selected date's month.
   */
  it("keeps the browsed month when a re-render supplies an equal selectedDate", () => {
    render(new Date(2026, 7, 9));
    clickNav("sidebar.previousMonth");
    expect(monthLabel()).toBe("July 2026");

    render(new Date(2026, 7, 9));
    expect(monthLabel()).toBe("July 2026");
  });

  it("follows selectedDate when it actually moves to a different month", () => {
    render(new Date(2026, 7, 9));
    clickNav("sidebar.previousMonth");
    expect(monthLabel()).toBe("July 2026");

    render(new Date(2026, 9, 3));
    expect(monthLabel()).toBe("October 2026");
  });
});
