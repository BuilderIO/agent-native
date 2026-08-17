// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventHoverPreview } from "./EventHoverPreview";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({
    children,
    openDelay,
    closeDelay,
  }: {
    children: ReactNode;
    openDelay: number;
    closeDelay: number;
  }) => (
    <div data-open-delay={openDelay} data-close-delay={closeDelay}>
      {children}
    </div>
  ),
  HoverCardPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({
    children,
    side,
    align,
  }: {
    children: ReactNode;
    side: string;
    align: string;
  }) => (
    <aside data-testid="preview" data-side={side} data-align={align}>
      {children}
    </aside>
  ),
}));

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "A planning session with a deliberately long title",
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

describe("EventHoverPreview", () => {
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

  it("renders the event once beside its trigger with available details", () => {
    act(() => {
      root.render(
        <EventHoverPreview
          event={event({
            meetingLink: "https://meet.google.com/abc-defg-hij",
            attendees: [
              { email: "alice@example.com", displayName: "Alice" },
              { email: "brent@example.com" },
              { email: "sam@example.com", displayName: "Sam" },
              { email: "jules@example.com", displayName: "Jules" },
            ],
          })}
        >
          <button type="button">Source event</button>
        </EventHoverPreview>,
      );
    });

    const preview = container.querySelector('[data-testid="preview"]');
    const hoverCard = container.querySelector("[data-open-delay]");
    expect(hoverCard?.getAttribute("data-open-delay")).toBe("50");
    expect(hoverCard?.getAttribute("data-close-delay")).toBe("100");
    expect(preview?.getAttribute("data-side")).toBe("right");
    expect(preview?.getAttribute("data-align")).toBe("center");
    expect(
      container.textContent?.match(/deliberately long title/g),
    ).toHaveLength(1);
    expect(container.textContent).toContain("Room A");
    expect(container.textContent).toContain("Alice, brent@example.com, Sam +1");

    const meetingLink = container.querySelector<HTMLAnchorElement>(
      'a[href="https://meet.google.com/abc-defg-hij"]',
    );
    expect(meetingLink?.textContent).toContain("eventForm.joinMeet");
    expect(meetingLink?.target).toBe("_blank");
    expect(meetingLink?.rel).toBe("noopener noreferrer");
  });

  it("omits unavailable optional rows and avoids duplicating a meeting URL", () => {
    act(() => {
      root.render(
        <EventHoverPreview
          event={event({
            location: "Join https://zoom.us/j/123",
            attendees: [],
          })}
        >
          <button type="button">Source event</button>
        </EventHoverPreview>,
      );
    });

    expect(container.textContent).not.toContain("Join https://zoom.us/j/123");
    expect(container.textContent).toContain("eventForm.joinZoom");
    expect(container.querySelectorAll("svg")).toHaveLength(3);
  });
});
