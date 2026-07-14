// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatAttendeeLocalTime } from "../../lib/attendee-local-time";
import { EventAttendeesSection } from "./EventAttendeesSection";

const rsvpMutate = vi.hoisted(() => vi.fn());

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

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({
    children,
    onKeyDown,
  }: {
    children: ReactNode;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  }) => <div onKeyDown={onKeyDown}>{children}</div>,
}));

vi.mock("@/hooks/use-attendee-photos", () => ({
  useAttendeePhotos: () => ({ data: {} }),
}));

vi.mock("@/hooks/use-attendee-timezones", () => ({
  useAttendeeTimezones: () => ({ data: {} }),
  useSetAttendeeTimezone: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-events", () => ({
  useRsvpEvent: () => ({ isPending: false, mutate: rsvpMutate }),
}));

describe("EventAttendeesSection attendee controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    rsvpMutate.mockReset();
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

  it("shows the event zone for the organizer and the browser zone for self", () => {
    const event: CalendarEvent = {
      id: "event-timezones",
      title: "Timezone check",
      description: "",
      location: "",
      start: "2024-06-15T18:30:00.000Z",
      end: "2024-06-15T19:00:00.000Z",
      startTimeZone: "America/Halifax",
      allDay: false,
      source: "google",
      accountEmail: "saee@example.com",
      responseStatus: "accepted",
      createdAt: "2024-06-15T17:00:00.000Z",
      updatedAt: "2024-06-15T17:00:00.000Z",
      attendees: [
        {
          email: "sami@example.com",
          displayName: "Sami",
          organizer: true,
          responseStatus: "accepted",
        },
        {
          email: "saee@example.com",
          displayName: "Saee",
          self: true,
          responseStatus: "accepted",
        },
      ],
    };
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserLabel = formatAttendeeLocalTime(event.start, browserTimeZone);
    const organizerLabel = formatAttendeeLocalTime(
      event.start,
      "America/Halifax",
    );

    act(() => {
      root.render(<EventAttendeesSection event={event} />);
    });

    const attendeeRows = Array.from(
      document.querySelectorAll('[data-testid="attendee-details"]'),
    );
    const organizerRow = attendeeRows.find((row) =>
      row.textContent?.includes("sami@example.com"),
    );
    const selfRow = attendeeRows.find((row) =>
      row.textContent?.includes("saee@example.com"),
    );

    expect(organizerRow?.textContent).toContain(organizerLabel);
    expect(selfRow?.textContent).toContain(browserLabel);
  });

  it("submits a recurring response with Cmd+Enter from the note", () => {
    const event: CalendarEvent = {
      id: "event-2",
      title: "Planning",
      description: "",
      location: "",
      start: "2026-07-10T16:00:00.000Z",
      end: "2026-07-10T17:00:00.000Z",
      allDay: false,
      source: "google",
      recurringEventId: "recurring-1",
      createdAt: "2026-07-10T15:00:00.000Z",
      updatedAt: "2026-07-10T15:00:00.000Z",
      responseStatus: "accepted",
      attendees: [
        {
          email: "me@example.com",
          displayName: "Me",
          responseStatus: "accepted",
          self: true,
        },
      ],
    };

    act(() => {
      root.render(<EventAttendeesSection event={event} />);
    });

    const maybeButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "eventForm.rsvpMaybe",
    );
    expect(maybeButton).toBeTruthy();

    act(() => {
      maybeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = document.querySelector("textarea");
    expect(textarea).toBeTruthy();
    const setTextareaValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;

    act(() => {
      setTextareaValue?.call(textarea, "Let's catch up async instead");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      textarea!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(rsvpMutate).toHaveBeenCalledWith(
      {
        id: "event-2",
        status: "tentative",
        accountEmail: undefined,
        scope: "single",
        note: "Let's catch up async instead",
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(document.querySelector("textarea")).toBeNull();
  });
});
