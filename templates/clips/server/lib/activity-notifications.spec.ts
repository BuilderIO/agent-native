import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyActivity: vi.fn(),
  select: vi.fn(),
  sendClipsTransactionalEmail: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("@agent-native/core/server", () => ({
  notifyActivity: (...args: unknown[]) => mocks.notifyActivity(...args),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: (...args: unknown[]) => mocks.select(...args) }),
  schema: {
    recordings: { id: "id", title: "title", ownerEmail: "owner_email" },
    recordingComments: {
      recordingId: "recording_id",
      threadId: "thread_id",
      authorEmail: "author_email",
    },
  },
}));

vi.mock("./transactional-email-templates.js", () => ({
  sendClipsTransactionalEmail: (...args: unknown[]) =>
    mocks.sendClipsTransactionalEmail(...args),
}));

import { CLIPS_USER_PREFS_KEY } from "../../shared/clips-ai-prefs.js";
import {
  notifyRecordingComment,
  notifyRecordingReaction,
} from "./activity-notifications.js";

const RECORDING = {
  id: "rec_1",
  title: "Sprint demo",
  ownerEmail: "owner@example.com",
};

/**
 * `select().from().where().limit()` reads the recording;
 * `select().from().where()` (no limit) reads thread participants.
 */
function stubDb(options: {
  recording: typeof RECORDING | null;
  participants?: string[];
}) {
  const participants = (options.participants ?? []).map((authorEmail) => ({
    authorEmail,
  }));
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => {
        const rows = options.recording ? [options.recording] : [];
        return Object.assign(Promise.resolve(participants), {
          limit: async () => rows,
        });
      },
    }),
  });
}

function notifyArgs() {
  return mocks.notifyActivity.mock.calls[0]?.[0] as {
    candidates: (string | null | undefined)[];
    actorEmail?: string | null;
    preferenceKey: string;
    send: (to: string) => Promise<unknown>;
  };
}

describe("clips activity notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyActivity.mockResolvedValue({
      status: "delivered",
      sent: [],
      failed: [],
    });
    stubDb({ recording: RECORDING });
  });

  it("notifies the recording owner against the Clips preference key", async () => {
    await notifyRecordingComment({
      recordingId: "rec_1",
      threadId: "thread_1",
      authorEmail: "Viewer@Example.com",
      content: "Nice work",
    });

    const args = notifyArgs();
    expect(args.candidates).toEqual(["owner@example.com"]);
    expect(args.actorEmail).toBe("Viewer@Example.com");
    expect(args.preferenceKey).toBe(CLIPS_USER_PREFS_KEY);
  });

  it("adds thread participants on a reply", async () => {
    stubDb({
      recording: RECORDING,
      participants: ["first@example.com", "second@example.com"],
    });

    await notifyRecordingComment({
      recordingId: "rec_1",
      threadId: "thread_1",
      authorEmail: "second@example.com",
      content: "Agreed",
      isReply: true,
    });

    expect(notifyArgs().candidates).toEqual([
      "owner@example.com",
      "first@example.com",
      "second@example.com",
    ]);
  });

  it("builds the reaction email for each recipient", async () => {
    await notifyRecordingReaction({
      recordingId: "rec_1",
      emoji: "🎉",
      viewerEmail: "viewer@example.com",
      videoTimestampMs: 4200,
    });

    await notifyArgs().send("owner@example.com");

    expect(mocks.sendClipsTransactionalEmail).toHaveBeenCalledWith({
      kind: "activity-reaction",
      to: "owner@example.com",
      recordingId: "rec_1",
      title: "Sprint demo",
      emoji: "🎉",
      authorEmail: "viewer@example.com",
      authorName: null,
      videoTimestampMs: 4200,
    });
  });

  it("passes the email-not-configured status through to the caller", async () => {
    mocks.notifyActivity.mockResolvedValue({
      status: "email-not-configured",
      sent: [],
      failed: [],
    });

    const result = await notifyRecordingReaction({
      recordingId: "rec_1",
      emoji: "🎉",
      viewerEmail: "viewer@example.com",
    });

    expect(mocks.sendClipsTransactionalEmail).not.toHaveBeenCalled();
    expect(result.status).toBe("email-not-configured");
  });

  it("reports a missing recording instead of a clean empty result", async () => {
    stubDb({ recording: null });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyRecordingComment({
      recordingId: "missing",
      threadId: "thread_1",
      authorEmail: "viewer@example.com",
      content: "Nice work",
    });

    expect(mocks.notifyActivity).not.toHaveBeenCalled();
    expect(result.status).toBe("recording-missing");
  });
});
