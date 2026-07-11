// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { format, parseISO } from "date-fns";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventDetailPopover } from "./EventDetailPopover";

const { updateEventMutate } = vi.hoisted(() => ({
  updateEventMutate: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | undefined | false>) =>
    values.filter(Boolean).join(" "),
  useT:
    () =>
    (key: string, _values?: Record<string, unknown>): string =>
      key,
  sendToAgentChat: vi.fn(),
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/extensions", () => ({
  ExtensionSlot: () => null,
}));

// Feature subcomponents not exercised by these tests: stub them out so the
// popover can render without their own data-fetching hooks (people search,
// Apollo enrichment, find-time availability, attendee list rendering).
vi.mock("@/components/calendar/ApolloPanel", () => ({
  ResearchMeetingButton: () => null,
}));

vi.mock("@/components/calendar/AttendeeAutocomplete", () => ({
  AttendeeAutocomplete: () => null,
}));

vi.mock("@/components/calendar/EventAttendeesSection", () => ({
  EventAttendeesSection: () => null,
}));

vi.mock("@/components/calendar/FindTimePanel", () => ({
  FindTimeTakeover: () => null,
}));

// Data hooks backed by react-query: mock so the popover doesn't need a
// QueryClientProvider in the test tree.
vi.mock("@/hooks/use-events", () => ({
  useEvent: () => ({ data: undefined, isLoading: false }),
  useUpdateEvent: () => ({ mutate: updateEventMutate, isPending: false }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-zoom-auth", () => ({
  useZoomStatus: () => ({ data: { connected: false, configured: true } }),
  useConnectZoom: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Radix-backed overlay primitives: stub as simple open-gated wrappers so
// nested popovers (e.g. TimezoneCombobox) that default to closed stay out of
// the DOM, matching how these primitives are mocked elsewhere in this repo.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <>{children}</> : null,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectGroup: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-testid="guest-notification-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function baseEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Team sync",
    description: "",
    location: "Room A",
    start: "2026-07-10T16:00:00.000Z",
    end: "2026-07-10T17:00:00.000Z",
    allDay: false,
    source: "google",
    createdAt: "2026-07-10T15:00:00.000Z",
    updatedAt: "2026-07-10T15:00:00.000Z",
    attendees: [],
    ...overrides,
  };
}

/** Mirrors the component's private `formatTimeShort` so the test can locate
 * the read-only time summary without asserting on any source string. */
function shortTimeLabel(iso: string): string {
  const d = parseISO(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findByExactText<T extends Element = Element>(
  selector: string,
  text: string,
): T | undefined {
  return Array.from(document.querySelectorAll<T>(selector)).find(
    (el) => el.textContent === text,
  );
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("EventDetailPopover characterization", () => {
  let container: HTMLDivElement;
  let root: Root;
  let unmounted = false;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    unmounted = false;
    updateEventMutate.mockClear();
  });

  afterEach(() => {
    if (!unmounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resyncs unedited fields from the event prop but preserves an in-progress edit on the actively edited field", () => {
    const event = baseEvent();

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    // Enter location edit mode by clicking the read-only location text.
    const locationText = findByExactText("span", "Room A");
    expect(locationText).toBeTruthy();
    act(() => {
      (locationText as HTMLElement).click();
    });

    const locationInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addLocation"]',
    );
    expect(locationInput).toBeTruthy();
    expect(locationInput!.value).toBe("Room A");

    // Simulate an uncommitted, in-progress edit (not yet saved/blurred).
    act(() => {
      setNativeInputValue(locationInput!, "Room A (typing)");
    });
    expect(locationInput!.value).toBe("Room A (typing)");

    // An external update (e.g. picked up by polling/another user/the agent)
    // changes the location AND the start/end time while the user is still
    // mid-edit on the location field.
    const updatedEvent = baseEvent({
      location: "Room B",
      start: "2026-07-10T18:00:00.000Z",
      end: "2026-07-10T19:15:00.000Z",
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={updatedEvent}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    // The actively-edited location field is untouched by the resync — the
    // user's uncommitted text is not yanked out from under them.
    const locationInputAfterUpdate = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addLocation"]',
    );
    expect(locationInputAfterUpdate!.value).toBe("Room A (typing)");

    // The time fields were NOT being edited during the update above, so they
    // should reflect the new event's start/end once the user opens that
    // editor — not whatever was captured at mount.
    const timeLabel = shortTimeLabel(updatedEvent.start);
    const timeSummary = findByExactText("span", timeLabel);
    expect(timeSummary).toBeTruthy();
    act(() => {
      (timeSummary as HTMLElement).click();
    });

    const timeInputs =
      document.querySelectorAll<HTMLInputElement>('input[type="time"]');
    expect(timeInputs).toHaveLength(2);
    expect(timeInputs[0].value).toBe(
      format(parseISO(updatedEvent.start), "HH:mm"),
    );
    expect(timeInputs[1].value).toBe(
      format(parseISO(updatedEvent.end), "HH:mm"),
    );
  });

  it("prompts for guest notification before saving when the event has guests, and only mutates after the user confirms", async () => {
    const event = baseEvent({
      id: "event-2",
      accountEmail: "steve@example.com",
      attendees: [
        {
          email: "guest@example.com",
          displayName: "Guest",
          responseStatus: "accepted",
        },
      ],
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const locationText = findByExactText("span", "Room A");
    act(() => {
      (locationText as HTMLElement).click();
    });

    const locationInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addLocation"]',
    )!;
    act(() => {
      setNativeInputValue(locationInput, "Room B");
    });

    await act(async () => {
      locationInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await flushMicrotasks();
    });

    // The event already has a guest, so the decision branch inside saveField
    // opens the guest-notification prompt instead of mutating immediately.
    expect(updateEventMutate).not.toHaveBeenCalled();
    const dialog = document.querySelector(
      '[data-testid="guest-notification-dialog"]',
    );
    expect(dialog).toBeTruthy();

    const sendButton = findByExactText("button", "eventForm.sendUpdate");
    expect(sendButton).toBeTruthy();

    await act(async () => {
      (sendButton as HTMLElement).click();
      await flushMicrotasks();
    });

    expect(updateEventMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "event-2",
        accountEmail: "steve@example.com",
        location: "Room B",
        sendUpdates: "all",
      }),
    );
  });

  it("saves immediately without prompting when the event has no guests to notify", async () => {
    const event = baseEvent({
      id: "event-3",
      accountEmail: "steve@example.com",
      attendees: [],
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const locationText = findByExactText("span", "Room A");
    act(() => {
      (locationText as HTMLElement).click();
    });

    const locationInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addLocation"]',
    )!;
    act(() => {
      setNativeInputValue(locationInput, "Room B");
    });

    await act(async () => {
      locationInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await flushMicrotasks();
    });

    // No guests on the event means the decision branch skips the prompt
    // entirely (resolves with sendUpdates: "none") and saves right away.
    expect(
      document.querySelector('[data-testid="guest-notification-dialog"]'),
    ).toBeNull();
    expect(updateEventMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "event-3",
        accountEmail: "steve@example.com",
        location: "Room B",
        sendUpdates: "none",
      }),
    );
  });

  it("opens the meeting link on Cmd+J while open, and removes the listener on unmount", () => {
    const event = baseEvent({
      id: "event-4",
      meetingLink: "https://zoom.us/j/1234567890",
    });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "j",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(openSpy).toHaveBeenCalledWith(
      "https://zoom.us/j/1234567890",
      "_blank",
    );

    act(() => root.unmount());
    unmounted = true;
    openSpy.mockClear();

    // No listener should remain after unmount — the same shortcut is now a
    // no-op instead of a leaked handler still calling window.open.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "j",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(openSpy).not.toHaveBeenCalled();
  });
});
