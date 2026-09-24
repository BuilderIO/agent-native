// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventDetailPanel } from "./EventDetailPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/extensions", () => ({
  ExtensionSlot: () => null,
}));

vi.mock("@/components/calendar/ApolloPanel", () => ({
  ResearchMeetingButton: () => null,
}));

vi.mock("@/components/calendar/EventAttendeesSection", () => ({
  EventAttendeesSection: () => null,
}));

vi.mock("@/components/calendar/EventCalendarSelect", () => ({
  EventCalendarSelect: () => null,
}));

vi.mock("@/components/calendar/EventDescription", () => ({
  AutoGrowTextarea: ({
    value,
    onChange,
    onBlur,
  }: {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
  }) => (
    <textarea
      data-testid="event-description-editor"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
    />
  ),
  RenderedDescription: ({
    description,
    onClick,
  }: {
    description?: string;
    onClick?: () => void;
  }) => (
    <div data-testid="event-description" onClick={onClick}>
      {description}
    </div>
  ),
}));

vi.mock("@/components/calendar/GuestNotificationDialog", () => ({
  useGuestNotificationPrompt: () => ({
    promptGuestNotification: vi.fn(),
    guestNotificationDialog: null,
  }),
}));

vi.mock("@/components/calendar/WorkingLocationEditor", () => ({
  WorkingLocationEditor: () => null,
}));

vi.mock("@/components/layout/AppLayout", () => ({
  useCalendarContext: () => ({ setEventDetailSidebar: vi.fn() }),
}));

vi.mock("@/hooks/use-events", () => ({
  useUpdateEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-view-preferences", () => ({
  useViewPreferences: () => ({ prefs: { accountColors: {} } }),
}));

function calendarEvent(
  calendarSourceKey: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: "shared-event-id",
    title: "First calendar title",
    description: "First calendar description",
    location: "Room A",
    start: "2026-07-10T16:00:00.000Z",
    end: "2026-07-10T17:00:00.000Z",
    allDay: false,
    source: "google",
    sourceId: "google-connection",
    accountEmail: "owner@example.com",
    calendarSourceKey,
    calendarId: calendarSourceKey,
    createdAt: "2026-07-10T15:00:00.000Z",
    updatedAt: "2026-07-10T15:00:00.000Z",
    attendees: [],
    ...overrides,
  };
}

function setNativeInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    input instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("EventDetailPanel source identity", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("discards a title draft when a same-ID event from another calendar is selected", () => {
    const onTitleSave = vi.fn();
    const firstEvent = calendarEvent("calendar-one");
    const secondEvent = calendarEvent("calendar-two", {
      title: "Second calendar title",
      description: "Second calendar description",
    });
    const render = (event: CalendarEvent) => (
      <EventDetailPanel
        event={event}
        onClose={() => undefined}
        onDelete={() => undefined}
        onTitleSave={onTitleSave}
      />
    );

    act(() => root.render(render(firstEvent)));
    act(() => container.querySelector("h2")?.click());

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).not.toBeNull();
    setNativeInputValue(titleInput!, "Unsaved first-calendar title");

    act(() => root.render(render(secondEvent)));

    const staleTitleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    if (staleTitleInput) {
      act(() =>
        staleTitleInput.dispatchEvent(
          new FocusEvent("blur", { bubbles: true }),
        ),
      );
    }

    expect(onTitleSave).not.toHaveBeenCalled();
    expect(container.querySelector("h2")?.textContent).toBe(
      "Second calendar title",
    );
  });

  it("replaces a description draft when a same-ID event from another calendar is selected", () => {
    const firstEvent = calendarEvent("calendar-one");
    const secondEvent = calendarEvent("calendar-two", {
      title: "Second calendar title",
      description: "Second calendar description",
    });
    const render = (event: CalendarEvent) => (
      <EventDetailPanel
        event={event}
        onClose={() => undefined}
        onDelete={() => undefined}
      />
    );

    act(() => root.render(render(firstEvent)));
    act(() =>
      container
        .querySelector<HTMLElement>('[data-testid="event-description"]')
        ?.click(),
    );

    const descriptionEditor = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="event-description-editor"]',
    );
    expect(descriptionEditor).not.toBeNull();
    setNativeInputValue(
      descriptionEditor!,
      "Unsaved first-calendar description",
    );

    act(() => root.render(render(secondEvent)));

    expect(
      container.querySelector('[data-testid="event-description-editor"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="event-description"]')?.textContent,
    ).toBe("Second calendar description");
  });

  it("traps focus, closes on Escape, and restores the trigger focus", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const event = calendarEvent("calendar-one");

    act(() =>
      root.render(
        <EventDetailPanel
          event={event}
          onClose={onClose}
          onDelete={() => undefined}
        />,
      ),
    );

    const panel = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel!.contains(document.activeElement)).toBe(true);

    const focusable = Array.from(
      panel!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);

    const lastFocusable = focusable[focusable.length - 1]!;
    lastFocusable.focus();
    act(() =>
      lastFocusable.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(focusable[0]);

    act(() =>
      panel!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() =>
      root.render(
        <EventDetailPanel
          event={null}
          onClose={onClose}
          onDelete={() => undefined}
        />,
      ),
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("keeps the panel open when Escape cancels title editing", () => {
    const onClose = vi.fn();
    const event = calendarEvent("calendar-one");

    act(() =>
      root.render(
        <EventDetailPanel
          event={event}
          onClose={onClose}
          onDelete={() => undefined}
        />,
      ),
    );
    act(() => container.querySelector("h2")?.click());

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="eventForm.addTitle"]',
    );
    expect(titleInput).not.toBeNull();
    expect(
      container
        .querySelector<HTMLElement>('[role="dialog"]')
        ?.getAttribute("aria-label"),
    ).toBe(event.title);
    act(() =>
      titleInput!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(
      container.querySelector('input[placeholder="eventForm.addTitle"]'),
    ).toBeNull();
  });

  it("restores the trigger focus when the sidebar unmounts", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    act(() =>
      root.render(
        <EventDetailPanel
          event={calendarEvent("calendar-one")}
          onClose={() => undefined}
          onDelete={() => undefined}
        />,
      ),
    );
    expect(
      container
        .querySelector<HTMLElement>('[role="dialog"]')
        ?.contains(document.activeElement),
    ).toBe(true);

    act(() => root.render(null));

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
