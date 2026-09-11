import {
  buildDeepLink,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({
      app,
      view,
      params,
    }: {
      app: string;
      view: string;
      params: Record<string, unknown>;
    }) =>
      `/_agent-native/open?app=${app}&view=${view}&eventId=${params.eventId}&date=${params.date}`,
  ),
  emailLink: (label: string, url: string) => `${label}: ${url}`,
  emailStrong: (value: string) => value,
  getAppProductionUrl: vi.fn(() => "https://calendar.example.com"),
  isEmailConfigured: vi.fn(() => true),
  renderEmail: vi.fn((input: Record<string, unknown>) => input),
  sendEmail: vi.fn(),
  toAbsoluteOpenUrl: vi.fn(
    (path: string, origin: string) => `${origin}${path}`,
  ),
}));

import {
  formatBookingWhen,
  sendBookingCancellationEmails,
  sendBookingConfirmationEmails,
} from "./booking-emails";
import {
  renderEventGuestNote,
  sendEventGuestNotificationNote,
} from "./event-guest-notifications";

describe("booking email time formatting", () => {
  it("formats booking times in the provided booking-link timezone", () => {
    expect(
      formatBookingWhen(
        "2026-05-21T19:30:00.000Z",
        "2026-05-21T20:00:00.000Z",
        "America/Los_Angeles",
      ),
    ).toBe("Thursday, May 21, 2026, 12:30 PM PDT - 1:00 PM PDT");
  });

  it("falls back to the default booking timezone when omitted", () => {
    expect(
      formatBookingWhen("2026-05-21T19:30:00.000Z", "2026-05-21T20:00:00.000Z"),
    ).toBe("Thursday, May 21, 2026, 3:30 PM EDT - 4:00 PM EDT");
  });
});

describe("booking attendee notifications", () => {
  it("sends confirmation and cancellation emails to additional guests", async () => {
    const booking = {
      id: "booking-1",
      name: "Taylor",
      email: "attendee@example.com",
      additionalGuestEmails: ["guest-one@example.com", "guest-two@example.com"],
      eventTitle: "Design review",
      start: "2026-05-21T19:30:00.000Z",
      end: "2026-05-21T20:00:00.000Z",
      slug: "design-review",
      status: "confirmed" as const,
      createdAt: "2026-05-21T18:00:00.000Z",
    };

    await sendBookingConfirmationEmails({
      booking,
      hostEmail: "host@example.com",
      manageUrl: "https://calendar.example.com/manage/booking-1",
    });
    await sendBookingCancellationEmails({
      booking,
      hostEmail: "host@example.com",
      bookAgainUrl: "https://calendar.example.com/book/design-review",
    });

    expect(vi.mocked(sendEmail).mock.calls.map(([args]) => args.to)).toEqual([
      "attendee@example.com",
      "guest-one@example.com",
      "guest-two@example.com",
      "host@example.com",
      "attendee@example.com",
      "guest-one@example.com",
      "guest-two@example.com",
      "host@example.com",
    ]);
  });
});

describe("event guest note links", () => {
  it("links update notes to Agent-Native Calendar", () => {
    renderEventGuestNote({
      title: "Design review",
      organizer: "Dana Hill",
      message: "Moving this an hour later.",
      when: "Thursday, May 21, 2026, 12:30 PM PDT - 1:00 PM PDT",
      kind: "update",
      calendarLink:
        "https://calendar.example.com/_agent-native/open?app=calendar&view=calendar&eventId=google-sample&date=2026-05-21",
    });

    expect(vi.mocked(renderEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        cta: {
          label: "Open in AN Calendar",
          url: "https://calendar.example.com/_agent-native/open?app=calendar&view=calendar&eventId=google-sample&date=2026-05-21",
        },
      }),
    );
  });

  it("builds the CTA from the Agent-Native event deep link", async () => {
    vi.clearAllMocks();

    vi.mocked(isEmailConfigured).mockResolvedValue(true);

    await sendEventGuestNotificationNote({
      event: {
        id: "google-sample",
        title: "Design review",
        description: "",
        start: "2026-05-21T19:30:00.000Z",
        end: "2026-05-21T20:00:00.000Z",
        location: "",
        allDay: false,
        source: "google",
        htmlLink: "https://calendar.google.com/event/sample",
        attendees: [{ email: "guest@example.com" }],
        organizer: { email: "dana@example.com", displayName: "Dana Hill" },
        createdAt: "2026-05-21T18:00:00.000Z",
        updatedAt: "2026-05-21T18:00:00.000Z",
      },
      organizerEmail: "dana@example.com",
      message: "Moving this an hour later.",
      kind: "update",
    });

    expect(vi.mocked(buildDeepLink)).toHaveBeenCalledWith({
      app: "calendar",
      view: "calendar",
      params: { eventId: "google-sample", date: "2026-05-21" },
    });
    expect(vi.mocked(toAbsoluteOpenUrl)).toHaveBeenCalledWith(
      "/_agent-native/open?app=calendar&view=calendar&eventId=google-sample&date=2026-05-21",
      "https://calendar.example.com",
    );
    expect(vi.mocked(renderEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        cta: {
          label: "Open in AN Calendar",
          url: "https://calendar.example.com/_agent-native/open?app=calendar&view=calendar&eventId=google-sample&date=2026-05-21",
        },
      }),
    );
  });

  it("uses the event timezone when the instant crosses a UTC date boundary", async () => {
    vi.clearAllMocks();

    vi.mocked(isEmailConfigured).mockResolvedValue(true);

    await sendEventGuestNotificationNote({
      event: {
        id: "google-midnight",
        title: "Late review",
        description: "",
        start: "2026-05-22T00:30:00.000Z",
        end: "2026-05-22T01:00:00.000Z",
        startTimeZone: "America/Los_Angeles",
        endTimeZone: "America/Los_Angeles",
        location: "",
        allDay: false,
        source: "google",
        attendees: [{ email: "guest@example.com" }],
        organizer: { email: "dana@example.com", displayName: "Dana Hill" },
        createdAt: "2026-05-21T18:00:00.000Z",
        updatedAt: "2026-05-21T18:00:00.000Z",
      },
      organizerEmail: "dana@example.com",
      message: "Moving this an hour later.",
      kind: "update",
    });

    expect(vi.mocked(buildDeepLink)).toHaveBeenCalledWith({
      app: "calendar",
      view: "calendar",
      params: { eventId: "google-midnight", date: "2026-05-21" },
    });
  });
});
