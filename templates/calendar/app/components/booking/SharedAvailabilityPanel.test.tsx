// @vitest-environment happy-dom

import type { HostOverlayStatusResult, OverlayPerson } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedAvailabilityPanel } from "./SharedAvailabilityPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, _values?: Record<string, unknown>): string =>
      key,
  useLocale: () => ({ locale: "en" }),
}));

vi.mock("@/components/calendar/AddCalendarDialog", () => ({
  AddCalendarDialog: () => null,
}));

const people = vi.fn<() => OverlayPerson[]>(() => []);
const overlayPeopleLoading = vi.fn<() => boolean>(() => false);
const overlayPeopleFailed = vi.fn<() => boolean>(() => false);
const refetchOverlayPeople = vi.fn();
const statuses = vi.fn<() => HostOverlayStatusResult[] | undefined>(
  () => undefined,
);
const removeMutate = vi.fn();

vi.mock("@/hooks/use-overlay-people", () => ({
  useOverlayPeople: () => ({
    data:
      overlayPeopleLoading() || overlayPeopleFailed() ? undefined : people(),
    isPending: overlayPeopleLoading(),
    isError: overlayPeopleFailed(),
    refetch: refetchOverlayPeople,
  }),
  useAddOverlayPerson: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
  useRemoveOverlayPerson: () => ({
    mutate: removeMutate,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock("@/hooks/use-host-overlay-status", () => ({
  useHostOverlayStatus: () => ({ data: statuses() }),
  useSendOverlayRequest: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
    data: undefined,
  }),
}));

function status(
  overrides: Partial<HostOverlayStatusResult> = {},
): HostOverlayStatusResult {
  return {
    email: "peer@example.com",
    reciprocal: true,
    hasWorkingHours: true,
    ...overrides,
  };
}

describe("SharedAvailabilityPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    people.mockReturnValue([]);
    overlayPeopleLoading.mockReturnValue(false);
    overlayPeopleFailed.mockReturnValue(false);
    statuses.mockReturnValue(undefined);
    removeMutate.mockClear();
    refetchOverlayPeople.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render() {
    act(() => {
      root.render(<SharedAvailabilityPanel />);
    });
  }

  it("shows the empty state with no peers", () => {
    render();

    expect(container.textContent).toContain(
      "bookingLinks.sharedAvailabilityEmpty",
    );
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("shows a loading skeleton instead of the empty state while pending", () => {
    overlayPeopleLoading.mockReturnValue(true);
    render();

    expect(container.textContent).not.toContain(
      "bookingLinks.sharedAvailabilityEmpty",
    );
    expect(
      container.querySelectorAll(".skeleton-shimmer").length,
    ).toBeGreaterThan(0);
  });

  it("shows a retry option instead of the empty state on error", () => {
    overlayPeopleFailed.mockReturnValue(true);
    render();

    expect(container.textContent).not.toContain(
      "bookingLinks.sharedAvailabilityEmpty",
    );
    expect(container.textContent).toContain("common.loadFailed");

    const retry = container.querySelector<HTMLButtonElement>("button");
    act(() => {
      retry?.click();
    });
    expect(refetchOverlayPeople).toHaveBeenCalled();
  });

  it("renders one row per peer", () => {
    people.mockReturnValue([
      { email: "peer@example.com", name: "Peer One", color: "#111" },
      { email: "other@example.com", color: "#222" },
    ]);
    render();

    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Peer One");
    expect(rows[1].textContent).toContain("other@example.com");
  });

  it("labels each working-hours state from the server status", () => {
    people.mockReturnValue([
      { email: "applied@example.com", color: "#111" },
      { email: "noschedule@example.com", color: "#222" },
      { email: "notback@example.com", color: "#333" },
    ]);
    statuses.mockReturnValue([
      status({ email: "applied@example.com" }),
      status({ email: "noschedule@example.com", hasWorkingHours: false }),
      status({
        email: "notback@example.com",
        reciprocal: false,
        hasWorkingHours: false,
      }),
    ]);
    render();

    const rows = container.querySelectorAll("li");
    expect(rows[0].textContent).toContain(
      "bookingLinks.workingHoursAppliedLabel",
    );
    expect(rows[1].textContent).toContain(
      "bookingLinks.workingHoursPendingScheduleLabel",
    );
    expect(rows[2].textContent).toContain(
      "bookingLinks.workingHoursNotAppliedLabel",
    );
  });

  it("renders no status label until the status query answers", () => {
    people.mockReturnValue([{ email: "peer@example.com", color: "#111" }]);
    render();

    expect(container.textContent).not.toContain("workingHours");
  });

  it("does not remove a peer on the first click", () => {
    people.mockReturnValue([{ email: "peer@example.com", color: "#111" }]);
    render();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="bookingLinks.removePeerAriaLabel"]',
    );
    expect(trigger).toBeTruthy();

    act(() => {
      trigger?.click();
    });

    expect(removeMutate).not.toHaveBeenCalled();
  });
});
