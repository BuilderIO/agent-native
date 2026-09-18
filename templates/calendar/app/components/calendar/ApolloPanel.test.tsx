// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchMeetingButton } from "./ApolloPanel";

const send = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useSendToAgentChat: () => ({ send, codeRequiredDialog: null }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { count?: number }) =>
    key === "apollo.attendeeCount" ? `${key}:${values?.count}` : key,
}));

vi.mock("@/hooks/use-apollo", () => ({
  useApolloConnect: () => ({ isPending: false, mutate: vi.fn() }),
  useApolloStatus: () => ({ connected: true }),
}));

vi.mock("./IntegrationsSidebar", () => ({
  IntegrationsSidebar: (_props: Record<string, unknown>): ReactNode => null,
}));

const event = (attendees: CalendarEvent["attendees"]): CalendarEvent => ({
  id: "event-research",
  title: "Planning",
  description: "",
  location: "",
  start: "2026-07-10T16:00:00.000Z",
  end: "2026-07-10T17:00:00.000Z",
  allDay: false,
  source: "google",
  createdAt: "2026-07-10T15:00:00.000Z",
  updatedAt: "2026-07-10T15:00:00.000Z",
  attendees,
});

describe("ResearchMeetingButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    send.mockReset();
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

  it("does not offer research for self-only grouped guests", () => {
    act(() => {
      root.render(
        <ResearchMeetingButton
          event={event([
            {
              email: "me@example.com",
              self: true,
              additionalGuests: 3,
            },
          ])}
        />,
      );
    });

    expect(container.querySelector("button")).toBeNull();
  });

  it("offers research when a non-self identity is available", () => {
    act(() => {
      root.render(
        <ResearchMeetingButton
          event={event([{ email: "guest@example.com" }])}
        />,
      );
    });

    expect(container.querySelector("button")).toBeTruthy();
  });

  it("counts only attendee identities included in the research request", () => {
    act(() => {
      root.render(
        <ResearchMeetingButton
          event={event([
            {
              email: "me@example.com",
              self: true,
              additionalGuests: 3,
            },
            { email: "guest@example.com", additionalGuests: 1 },
          ])}
        />,
      );
    });

    expect(container.textContent).toContain("apollo.attendeeCount:1");
  });
});
