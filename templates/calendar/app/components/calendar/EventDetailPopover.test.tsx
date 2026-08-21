// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventDetailPopover } from "./EventDetailPopover";

const { updateEventMutate } = vi.hoisted(() => ({
  updateEventMutate: vi.fn(),
}));

const { calendarContext } = vi.hoisted(() => ({
  calendarContext: {
    eventDetailSidebar: false,
    sidebarEvent: null as CalendarEvent | null,
    setEventDetailSidebar: vi.fn(),
    setSidebarEvent: vi.fn(),
    setFocusedEvent: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, _values?: Record<string, unknown>): string =>
      key,
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

vi.mock("@/components/layout/AppLayout", () => ({
  useCalendarContext: () => calendarContext,
}));

// Data hooks backed by react-query: mock so the popover doesn't need a
// QueryClientProvider in the test tree.
vi.mock("@/hooks/use-events", () => ({
  useEvent: () => ({ data: undefined, isLoading: false }),
  useUpdateEvent: () => ({ mutate: updateEventMutate, isPending: false }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({ data: { accounts: [] } }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-view-preferences", () => ({
  useViewPreferences: () => ({
    prefs: { accountColors: {}, singleColor: undefined },
  }),
}));

vi.mock("@/hooks/use-zoom-auth", () => ({
  useZoomStatus: () => ({ data: { connected: false, configured: true } }),
  useConnectZoom: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Radix-backed overlay primitives: stub as simple open-gated wrappers so
// nested popovers (e.g. TimezoneCombobox) that default to closed stay out of
// the DOM, matching how these primitives are mocked elsewhere in this repo.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenChange?.(true)}>
        Mock open popover
      </button>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        Mock close popover
      </button>
      {open ? children : null}
    </div>
  ),
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    className,
    side,
  }: {
    children?: ReactNode;
    className?: string;
    side?: string;
  }) => (
    <div className={className} data-popover-side={side}>
      {children}
    </div>
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
    calendarContext.eventDetailSidebar = false;
    calendarContext.sidebarEvent = null;
    calendarContext.setEventDetailSidebar.mockClear();
    calendarContext.setSidebarEvent.mockClear();
    calendarContext.setFocusedEvent.mockClear();
  });

  afterEach(() => {
    if (!unmounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows the add-title placeholder instead of editable fallback text for a new unnamed event", () => {
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent({
            title: "(No title)",
            titleIsGenerated: true,
          })}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const titleInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).toBeTruthy();
    expect(titleInput!.value).toBe("");
  });

  it("bounds the detail panel to the available viewport space", () => {
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent()}
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const content = document.querySelector<HTMLElement>(
      'div[class*="radix-popover-content-available-height"]',
    );
    expect(content).toBeTruthy();
    expect(content?.className).toContain("w-[min(420px,calc(100vw-2rem))]");
  });

  it("keeps the fallback label out of the input when renaming an unnamed event", () => {
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent({
            title: "(No title)",
            titleIsGenerated: true,
          })}
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const openButton = findByExactText("button", "Mock open popover");
    act(() => {
      (openButton as HTMLElement).click();
    });

    const fallbackTitle = findByExactText("h2", "(No title)");
    expect(fallbackTitle).toBeTruthy();
    act(() => {
      (fallbackTitle as HTMLElement).click();
    });

    const titleInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).toBeTruthy();
    expect(titleInput!.value).toBe("");
  });

  it("preserves a literal fallback label typed by the user", () => {
    const onTitleSave = vi.fn();
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent({ title: "(No title)" })}
          defaultOpen
          onDelete={() => undefined}
          onTitleSave={onTitleSave}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const titleInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).toBeTruthy();

    act(() => {
      setNativeInputValue(titleInput!, "(No title)");
      titleInput!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onTitleSave).toHaveBeenCalledWith(
      "event-1",
      "(No title)",
      undefined,
    );
  });

  it("dismisses a blank out-of-office draft without saving its generated title", () => {
    const onTitleSave = vi.fn();
    const onDismissNew = vi.fn();
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent({
            title: "Out of office",
            titleIsGenerated: true,
            eventType: "outOfOffice",
          })}
          isDraft
          defaultOpen
          onDelete={() => undefined}
          onTitleSave={onTitleSave}
          onDismissNew={onDismissNew}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const titleInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).toBeTruthy();
    expect(titleInput!.value).toBe("");

    const closeButton = findByExactText("button", "Mock close popover");
    act(() => {
      (closeButton as HTMLElement).click();
    });

    expect(onTitleSave).not.toHaveBeenCalled();
    expect(onDismissNew).toHaveBeenCalledWith("event-1", undefined);
  });

  it("preserves an explicit Out of office title on a draft", () => {
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent({
            title: "Out of office",
            eventType: "outOfOffice",
          })}
          isDraft
          defaultOpen
          onDelete={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const titleInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).toBeTruthy();
    expect(titleInput!.value).toBe("Out of office");
  });

  it("does not show the full event timezone label on the default detail surface", () => {
    const event = baseEvent({ startTimeZone: "America/Halifax" });

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

    expect(document.body.textContent).not.toContain(
      "Halifax (America/Halifax)",
    );
  });

  it("notifies parents when the visible popover opens and closes", () => {
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent()}
          onDelete={() => undefined}
          onOpenChange={onOpenChange}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const openButton = findByExactText("button", "Mock open popover");
    act(() => {
      (openButton as HTMLElement).click();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    const closeButton = findByExactText("button", "Mock close popover");
    act(() => {
      (closeButton as HTMLElement).click();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("notifies parents when default-open makes the popover visible", () => {
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent()}
          defaultOpen
          onDelete={() => undefined}
          onOpenChange={onOpenChange}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("does not notify a popover open request suppressed by sidebar mode", () => {
    calendarContext.eventDetailSidebar = true;
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent()}
          onDelete={() => undefined}
          onOpenChange={onOpenChange}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const openButton = findByExactText("button", "Mock open popover");
    act(() => {
      (openButton as HTMLElement).click();
    });

    // Sidebar mode consumes this interaction, so the popover never becomes
    // visible and parents must not receive a misleading open notification.
    expect(onOpenChange).not.toHaveBeenCalled();

    calendarContext.eventDetailSidebar = false;
    act(() => {
      root.render(
        <EventDetailPopover
          event={baseEvent()}
          onDelete={() => undefined}
          onOpenChange={onOpenChange}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    // Disabling sidebar mode later must not reveal a popover that was never
    // visibly opened.
    expect(findByExactText("button", "Open")).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("notifies parents when sidebar details open and close", () => {
    const event = baseEvent();
    const onOpenChange = vi.fn();
    calendarContext.eventDetailSidebar = true;
    calendarContext.sidebarEvent = event;

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          onDelete={() => undefined}
          onOpenChange={onOpenChange}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    calendarContext.sidebarEvent = null;
    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          onDelete={() => undefined}
          onOpenChange={onOpenChange}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
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
  });

  it("uses the event timezone when seeding the time editor", () => {
    // Keep the assertion independent from the machine running Vitest. Without
    // the explicit event timezone conversion, UTC would render these values
    // as 4:00 PM and 5:00 PM.
    vi.stubEnv("TZ", "UTC");
    const event = baseEvent({
      start: "2026-07-10T16:00:00.000Z",
      end: "2026-07-10T17:00:00.000Z",
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
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

    const openPopoverButtons = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
        (button) => button.textContent === "Mock open popover",
      );

    // The outer detail popover is first; the start and end time pickers are
    // the next two nested popovers in the rendered event form.
    const startTimePopoverButton = openPopoverButtons()[1];
    const endTimePopoverButton = openPopoverButtons()[2];
    expect(startTimePopoverButton).toBeTruthy();
    expect(endTimePopoverButton).toBeTruthy();
    act(() => {
      startTimePopoverButton!.click();
      endTimePopoverButton!.click();
    });

    const startTimeTrigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="eventForm.start"]',
    );
    const endTimeTrigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="eventForm.end"]',
    );
    expect(startTimeTrigger?.textContent).toBe("12:00 PM");
    expect(endTimeTrigger?.textContent).toBe("1:00 PM");
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

  it("keeps working-location drafts all-day by default and converts them to timed bounds in the calendar timezone", () => {
    const onDraftUpdate = vi.fn();
    const event = baseEvent({
      id: "working-location-draft",
      title: "",
      source: "local",
      start: "2026-08-14",
      end: "2026-08-15",
      allDay: true,
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "homeOffice",
        homeOffice: {},
      },
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          timezone="America/Los_Angeles"
          isDraft
          defaultOpen
          onDelete={() => undefined}
          onDraftUpdate={onDraftUpdate}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    expect(findByExactText("span", "→")).toBeTruthy();

    const allDaySwitch =
      document.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(allDaySwitch?.getAttribute("aria-checked")).toBe("true");

    act(() => {
      allDaySwitch?.click();
    });

    expect(onDraftUpdate).toHaveBeenCalledWith(
      "working-location-draft",
      expect.objectContaining({
        allDay: false,
        start: "2026-08-14T16:00:00.000Z",
        end: "2026-08-15T00:00:00.000Z",
        startTimeZone: "America/Los_Angeles",
        endTimeZone: "America/Los_Angeles",
      }),
    );
  });

  it("does not add an extra day when converting a midnight-ending timed location to all-day", () => {
    const onDraftUpdate = vi.fn();
    const event = baseEvent({
      id: "working-location-draft",
      title: "",
      source: "local",
      start: "2026-08-14T16:00:00.000Z",
      end: "2026-08-15T00:00:00.000Z",
      startTimeZone: "America/Los_Angeles",
      endTimeZone: "America/Los_Angeles",
      allDay: false,
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "homeOffice",
        homeOffice: {},
      },
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          timezone="America/Los_Angeles"
          isDraft
          defaultOpen
          onDelete={() => undefined}
          onDraftUpdate={onDraftUpdate}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const allDaySwitch =
      document.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(allDaySwitch?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      allDaySwitch?.click();
    });

    expect(onDraftUpdate).toHaveBeenCalledWith(
      "working-location-draft",
      expect.objectContaining({
        allDay: true,
        start: "2026-08-14",
        end: "2026-08-15",
      }),
    );
  });

  it("applies Home/Office/Other on a draft immediately and hides Save", () => {
    const onDraftUpdate = vi.fn();
    const event = baseEvent({
      id: "working-location-draft",
      title: "",
      source: "local",
      start: "2026-08-14",
      end: "2026-08-15",
      allDay: true,
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "homeOffice",
        homeOffice: {},
      },
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          timezone="America/Chicago"
          isDraft
          defaultOpen
          onDelete={() => undefined}
          onDraftUpdate={onDraftUpdate}
          onDraftCreate={() => undefined}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    expect(findByExactText("button", "eventForm.save")).toBeUndefined();

    const office = document.querySelector<HTMLInputElement>(
      "#working-location-working-location-draft-officeLocation",
    );
    expect(office).toBeTruthy();
    act(() => {
      office?.click();
    });

    expect(onDraftUpdate).toHaveBeenCalledWith(
      "working-location-draft",
      expect.objectContaining({
        workingLocationType: "officeLocation",
      }),
    );
  });

  it("blocks creating an Other working location until it has a name", () => {
    const onDraftCreate = vi.fn();
    const event = baseEvent({
      id: "working-location-draft",
      title: "",
      location: "",
      source: "local",
      start: "2026-08-14",
      end: "2026-08-15",
      allDay: true,
      eventType: "workingLocation",
      workingLocationProperties: {
        type: "customLocation",
        customLocation: {},
      },
    });

    act(() => {
      root.render(
        <EventDetailPopover
          event={event}
          timezone="America/Chicago"
          isDraft
          defaultOpen
          onDelete={() => undefined}
          onDraftCreate={onDraftCreate}
        >
          <button type="button">Open</button>
        </EventDetailPopover>,
      );
    });

    const createButton = findByExactText("button", "eventForm.createEvent");
    expect(createButton).toBeTruthy();
    expect((createButton as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      (createButton as HTMLButtonElement).click();
    });
    expect(onDraftCreate).not.toHaveBeenCalled();
  });
});
