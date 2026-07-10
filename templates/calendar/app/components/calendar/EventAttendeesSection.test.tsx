// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventAttendeesSection } from "./EventAttendeesSection";

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | undefined | false>) =>
    values.filter(Boolean).join(" "),
  useT:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("@/components/calendar/ApolloPanel", () => ({
  AttendeeApolloPopover: ({ children }: { children: ReactNode }) => (
    <button type="button" data-testid="attendee-details">
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/use-attendee-photos", () => ({
  useAttendeePhotos: () => ({ data: {} }),
}));

vi.mock("@/hooks/use-attendee-timezones", () => ({
  useAttendeeTimezones: () => ({ data: {} }),
  useSetAttendeeTimezone: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-events", () => ({
  useRsvpEvent: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe("EventAttendeesSection attendee controls", () => {
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

  it("renders guest options beside the attendee details button", () => {
    const event: CalendarEvent = {
      id: "event-1",
      title: "Planning",
      description: "",
      location: "",
      start: "2026-07-10T16:00:00.000Z",
      end: "2026-07-10T17:00:00.000Z",
      allDay: false,
      source: "google",
      createdAt: "2026-07-10T15:00:00.000Z",
      updatedAt: "2026-07-10T15:00:00.000Z",
      attendees: [
        {
          email: "guest@example.com",
          displayName: "Guest",
          responseStatus: "accepted",
        },
      ],
    };

    act(() => {
      root.render(
        <EventAttendeesSection
          event={event}
          canEditOptional
          onToggleOptional={() => undefined}
        />,
      );
    });

    const attendeeDetails = document.querySelector(
      '[data-testid="attendee-details"]',
    );
    const guestOptions = document.querySelector(
      'button[aria-label="attendees.guestOptions"]',
    );

    expect(attendeeDetails).toBeTruthy();
    expect(guestOptions).toBeTruthy();
    expect(attendeeDetails!.contains(guestOptions)).toBe(false);
    expect(document.querySelector("button button")).toBeNull();
  });
});
