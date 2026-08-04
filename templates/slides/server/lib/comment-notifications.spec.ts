import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyActivity: vi.fn(),
  sendEmail: vi.fn(),
  select: vi.fn(),
  filterRecipients: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("@agent-native/core/server", () => ({
  emailStrong: (value: string) => value,
  notifyActivity: (...args: unknown[]) => mocks.notifyActivity(...args),
  renderEmail: (args: {
    heading: string;
    paragraphs: string[];
    cta?: { url: string };
  }) => ({
    html: `<h1>${args.heading}</h1>`,
    text: [args.heading, ...args.paragraphs, args.cta?.url ?? ""].join("\n"),
  }),
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
  runActivityNotification: async (
    logLabel: string,
    resolve: () => Promise<unknown>,
  ) => {
    try {
      return await resolve();
    } catch (error) {
      return {
        status: "notification-error",
        error: error instanceof Error ? error.message : String(error),
        sent: [],
        failed: [],
      };
    }
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  filterRecipientsByResourceAccess: (...args: unknown[]) =>
    mocks.filterRecipients(...args),
}));

vi.mock("../../actions/_app-url.js", () => ({
  getDeckUrl: (deckId: string) => `https://slides.test/deck/${deckId}`,
  getSettingsUrl: () => "https://slides.test/settings",
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: (...args: unknown[]) => mocks.select(...args) }),
  schema: {
    decks: {
      id: "id",
      title: "title",
      ownerEmail: "owner_email",
      orgId: "org_id",
      data: "data",
    },
    slideComments: {
      deckId: "deck_id",
      threadId: "thread_id",
      authorEmail: "author_email",
    },
  },
}));

import { SLIDES_USER_PREFS_KEY } from "../../shared/slides-user-prefs.js";
import { notifyDeckComment } from "./comment-notifications.js";

const DECK = {
  id: "deck_1",
  title: "Q3 review",
  ownerEmail: "owner@example.com",
  orgId: null,
  data: JSON.stringify({
    slides: [{ id: "slide_1" }, { id: "slide_2" }, { id: "slide_3" }],
  }),
};

function stubDb(options: {
  deck: typeof DECK | null;
  participants?: string[];
}) {
  const participants = (options.participants ?? []).map((authorEmail) => ({
    authorEmail,
  }));
  mocks.select.mockReturnValue({
    from: () => ({
      where: () =>
        Object.assign(Promise.resolve(participants), {
          limit: async () => (options.deck ? [options.deck] : []),
        }),
    }),
  });
}

function notifyArgs() {
  return mocks.notifyActivity.mock.calls[0]?.[0] as {
    candidates: string[];
    actorEmail?: string | null;
    preferenceKey: string;
    send: (to: string) => Promise<unknown>;
  };
}

describe("slides comment notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyActivity.mockResolvedValue({
      status: "delivered",
      sent: [],
      failed: [],
    });
    stubDb({ deck: DECK });
    // Access filtering has its own tests; these assert who is offered.
    mocks.filterRecipients.mockImplementation(
      async ({ emails }: { emails: string[] }) => [...emails],
    );
  });

  it("notifies the deck owner against the Slides preference key", async () => {
    await notifyDeckComment({
      deckId: "deck_1",
      slideId: "slide_2",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      authorName: "Viewer",
      content: "Slide 2 needs a source",
      isReply: false,
    });

    const args = notifyArgs();
    expect(args.candidates).toEqual(["owner@example.com"]);
    expect(args.actorEmail).toBe("viewer@example.com");
    expect(args.preferenceKey).toBe(SLIDES_USER_PREFS_KEY);
  });

  it("adds thread participants on a reply", async () => {
    stubDb({
      deck: DECK,
      participants: ["first@example.com", "viewer@example.com"],
    });

    await notifyDeckComment({
      deckId: "deck_1",
      slideId: "slide_2",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      content: "Agreed",
      isReply: true,
    });

    expect(notifyArgs().candidates).toEqual([
      "owner@example.com",
      "first@example.com",
      "viewer@example.com",
    ]);
  });

  it("sends a deep-linked email per recipient", async () => {
    await notifyDeckComment({
      deckId: "deck_1",
      slideId: "slide_2",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      authorName: "Viewer",
      content: "Slide 2 needs a source",
      isReply: false,
    });

    await notifyArgs().send("owner@example.com");

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendEmail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(email.to).toBe("owner@example.com");
    expect(email.subject).toBe('Viewer commented on "Q3 review"');
    expect(email.text).toContain("Slide 2 needs a source");
  });

  it("links to the slide by its one-based position, not its id", async () => {
    await notifyDeckComment({
      deckId: "deck_1",
      slideId: "slide_3",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      content: "Third slide",
      isReply: false,
    });
    await notifyArgs().send("owner@example.com");

    const email = mocks.sendEmail.mock.calls[0][0] as { text: string };
    expect(email.text).toContain("https://slides.test/deck/deck_1?slide=3");
    expect(email.text).not.toContain("slide=slide_3");
  });

  it("drops a participant who can no longer open the deck", async () => {
    stubDb({
      deck: DECK,
      participants: ["revoked@example.com", "still@example.com"],
    });
    mocks.filterRecipients.mockResolvedValue([
      "owner@example.com",
      "still@example.com",
    ]);

    await notifyDeckComment({
      deckId: "deck_1",
      slideId: "slide_2",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      content: "Agreed",
      isReply: true,
    });

    expect(notifyArgs().candidates).toEqual([
      "owner@example.com",
      "still@example.com",
    ]);
    expect(
      (mocks.filterRecipients.mock.calls[0][0] as { emails: string[] }).emails,
    ).toContain("revoked@example.com");
  });

  it("returns notification-error instead of throwing when the deck read fails", async () => {
    mocks.select.mockImplementation(() => {
      throw new Error("db down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyDeckComment({
      deckId: "deck_1",
      slideId: "slide_2",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      content: "Hello",
      isReply: false,
    });

    expect(result.status).toBe("notification-error");
  });

  it("reports a missing deck instead of a clean empty result", async () => {
    stubDb({ deck: null });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyDeckComment({
      deckId: "missing",
      slideId: "slide_2",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      content: "Hello",
      isReply: false,
    });

    expect(mocks.notifyActivity).not.toHaveBeenCalled();
    expect(result.status).toBe("deck-missing");
  });
});
