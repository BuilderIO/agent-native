import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerActionChatRenderer: vi.fn(),
}));

vi.mock("@agent-native/core/client/agentkit-chat", () => ({
  registerActionChatRenderer: mocks.registerActionChatRenderer,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? key,
  useFormatters: () => ({
    formatDate: (
      value: Date | number | string,
      options?: Intl.DateTimeFormatOptions,
    ) =>
      new Intl.DateTimeFormat("en-US", options).format(
        value instanceof Date ? value : new Date(value),
      ),
  }),
}));

import { buildOpenRouteLink } from "@agent-native/core/client/navigation";

import { CalendarEventCreatedCard } from "./register-chat-renderers";

describe("Calendar create-event chat renderer", () => {
  it("registers and renders a safe event confirmation with the action link", () => {
    expect(mocks.registerActionChatRenderer).toHaveBeenCalledWith({
      id: "calendar.event-created",
      renderer: "calendar.event-created",
      Component: CalendarEventCreatedCard,
    });

    const markup = renderToStaticMarkup(
      <CalendarEventCreatedCard
        context={{
          toolName: "create-event",
          args: {},
          isRunning: false,
          resultJson: {
            id: "google-event-1",
            title: "Planning",
            start: "2026-10-03T16:00:00.000Z",
            end: "2026-10-03T16:30:00.000Z",
            startTimeZone: "America/Los_Angeles",
            endTimeZone: "America/Los_Angeles",
            location: "Conference room",
            hangoutLink: "https://meet.google.com/abc-defg-hij",
            description: "Private agenda",
            attendees: [{ email: "guest@example.test" }],
          },
        }}
      />,
    );
    const expectedOpenUrl = buildOpenRouteLink({
      app: "calendar",
      view: "calendar",
      params: { eventId: "google-event-1", date: "2026-10-03" },
    })
      .url.split("&")
      .join("&amp;");

    expect(markup).toContain('class="flex min-w-0 items-center gap-3"');
    expect(markup).toContain('class="grid size-9 shrink-0 place-items-center');
    expect(markup).toContain(
      'class="truncate text-sm font-medium text-foreground"',
    );
    expect(markup).toContain("text-xs text-muted-foreground");
    expect(markup).toContain("Event created");
    expect(markup).toContain("Planning");
    expect(markup).toContain("Oct 3, 2026 · 9:00 AM – 9:30 AM");
    expect(markup).toContain("Conference room");
    expect(markup).toContain("Join meeting");
    expect(markup).toContain("https://meet.google.com/abc-defg-hij");
    expect(markup).toContain("Open event in Calendar");
    expect(markup).toContain(expectedOpenUrl);
    expect(markup).not.toContain("Private agenda");
    expect(markup).not.toContain("guest@example.test");
  });

  it("formats all-day date ranges without showing times", () => {
    const markup = renderToStaticMarkup(
      <CalendarEventCreatedCard
        context={{
          toolName: "create-event",
          args: {},
          isRunning: false,
          resultJson: {
            id: "google-event-2",
            title: "Offsite",
            start: "2026-10-31",
            end: "2026-11-02",
            allDay: true,
          },
        }}
      />,
    );

    expect(markup).toContain("All day · Oct 31, 2026 – Nov 1, 2026");
    expect(markup).not.toContain("AM");
    expect(markup).not.toContain("PM");
  });

  it("opens an event on its local calendar date near UTC midnight", () => {
    const markup = renderToStaticMarkup(
      <CalendarEventCreatedCard
        context={{
          toolName: "create-event",
          args: {},
          isRunning: false,
          resultJson: {
            id: "google-event-local-day",
            title: "Late planning",
            start: "2026-10-03T06:30:00.000Z",
            end: "2026-10-03T06:50:00.000Z",
            startTimeZone: "America/Los_Angeles",
            endTimeZone: "America/Los_Angeles",
          },
        }}
      />,
    );
    const expectedOpenUrl = buildOpenRouteLink({
      app: "calendar",
      view: "calendar",
      params: { eventId: "google-event-local-day", date: "2026-10-02" },
    })
      .url.split("&")
      .join("&amp;");

    expect(markup).toContain("Oct 2, 2026 · 11:30 PM – 11:50 PM");
    expect(markup).toContain(expectedOpenUrl);
  });

  it("keeps the event card when a provider time zone is invalid", () => {
    const markup = renderToStaticMarkup(
      <CalendarEventCreatedCard
        context={{
          toolName: "create-event",
          args: {},
          isRunning: false,
          resultJson: {
            title: "Planning",
            start: "2026-10-03T16:00:00.000Z",
            end: "2026-10-03T16:30:00.000Z",
            startTimeZone: "Invalid/Zone",
          },
        }}
      />,
    );

    expect(markup).toContain("Planning");
    expect(markup).not.toContain("9:00 AM");
  });

  it("uses the inclusive input dates for full-day out-of-office events", () => {
    const markup = renderToStaticMarkup(
      <CalendarEventCreatedCard
        context={{
          toolName: "create-event",
          args: {
            eventType: "outOfOffice",
            fullDay: true,
            start: "2026-10-31",
            end: "2026-11-01",
            startTimeZone: "Asia/Kolkata",
          },
          isRunning: false,
          resultJson: {
            id: "google-event-ooo",
            title: "Out of office",
            start: "2026-10-30T18:30:00.000Z",
            end: "2026-11-01T18:30:00.000Z",
            startTimeZone: "Asia/Kolkata",
            endTimeZone: "Asia/Kolkata",
            allDay: false,
          },
        }}
      />,
    );

    expect(markup).toContain("All day · Oct 31, 2026 – Nov 1, 2026");
    expect(markup).toContain(
      buildOpenRouteLink({
        app: "calendar",
        view: "calendar",
        params: { eventId: "google-event-ooo", date: "2026-10-31" },
      })
        .url.split("&")
        .join("&amp;"),
    );
    expect(markup).not.toContain("AM");
    expect(markup).not.toContain("PM");
  });

  it("confirms the event when Zoom provisioning failed", () => {
    const markup = renderToStaticMarkup(
      <CalendarEventCreatedCard
        context={{
          toolName: "create-event",
          args: {},
          isRunning: false,
          resultJson: {
            id: "google-event-3",
            title: "Review",
            start: "2026-10-03T16:00:00.000Z",
            end: "2026-10-03T16:30:00.000Z",
            videoConferenceError: "zoom",
          },
        }}
      />,
    );

    expect(markup).toContain("Event created");
    expect(markup).toContain(
      "The event was created, but Zoom could not be added.",
    );
    expect(markup).not.toContain("Event failed");
  });

  it("does not render unrelated or incomplete tool results", () => {
    const context = {
      toolName: "create-event",
      args: {},
      isRunning: false,
      resultJson: { error: "provider unavailable" },
    };

    expect(
      renderToStaticMarkup(<CalendarEventCreatedCard context={context} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CalendarEventCreatedCard
          context={{ ...context, toolName: "list-events" }}
        />,
      ),
    ).toBe("");
  });
});
