// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimeZoneGrid } from "./TimeZoneGrid";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/TimezoneCombobox", () => ({
  getTimezoneCity: (timezone: string) => timezone,
  TimezoneCombobox: () => null,
}));

describe("TimeZoneGrid", () => {
  let container: HTMLDivElement;
  let root: Root;
  const scrollBy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "scrollBy").mockImplementation(scrollBy);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("scrolls the time grid when the overflow arrow is clicked", () => {
    act(() => {
      root.render(
        <TimeZoneGrid
          slots={[
            {
              start: "2026-09-16T16:00:00.000Z",
              end: "2026-09-16T16:30:00.000Z",
            },
          ]}
          selectedSlot={null}
          onSelect={() => undefined}
          hosts={[]}
          selectedDate="2026-09-16"
          extraTimezones={[]}
          onExtraTimezonesChange={() => undefined}
        />,
      );
    });

    const next = container.querySelector<HTMLButtonElement>(
      'button[aria-label="bookingLinks.scrollToLaterTimes"]',
    );
    expect(next).not.toBeNull();

    act(() => next?.click());
    expect(scrollBy).toHaveBeenCalledWith({ left: 160, behavior: "smooth" });
  });
});
