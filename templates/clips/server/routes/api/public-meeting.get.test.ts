import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    meetingParticipants: {
      email: "participants.email",
      name: "participants.name",
      isOrganizer: "participants.isOrganizer",
      meetingId: "participants.meetingId",
    },
    meetingActionItems: {
      id: "actionItems.id",
      text: "actionItems.text",
      assigneeEmail: "actionItems.assigneeEmail",
      completedAt: "actionItems.completedAt",
      meetingId: "actionItems.meetingId",
    },
    recordingTranscripts: {
      status: "transcripts.status",
      language: "transcripts.language",
      fullText: "transcripts.fullText",
      failureReason: "transcripts.failureReason",
      segmentsJson: "transcripts.segmentsJson",
      updatedAt: "transcripts.updatedAt",
      recordingId: "transcripts.recordingId",
    },
  },
}));

import handler from "./public-meeting.get";

function createDbWithSelectResults(results: unknown[][]) {
  let index = 0;
  return {
    select: vi.fn(() => {
      const rows = results[index++] ?? [];
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => rows),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    }),
  };
}

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    title: "Weekly sync",
    scheduledStart: "2026-07-20T17:00:00.000Z",
    actualStart: "2026-07-20T17:01:00.000Z",
    actualEnd: "2026-07-20T17:30:00.000Z",
    transcriptStatus: "ready",
    summaryMd: "The team agreed on the launch plan.",
    bulletsJson: JSON.stringify([{ text: "Ship on Tuesday" }]),
    recordingId: "recording-1",
    shareTranscript: false,
    trashedAt: null,
    ...overrides,
  };
}

describe("/api/public-meeting route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({ id: "meeting-1" });
    mockGetSession.mockResolvedValue(null);
    mockRunWithRequestContext.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: makeMeeting(),
    });
  });

  it("rejects requests without a meeting id", async () => {
    mockGetQuery.mockReturnValue({});

    await expect(handler({} as any)).resolves.toEqual({
      error: "id is required",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it("returns not found before loading child data when access is denied", async () => {
    mockResolveAccess.mockResolvedValue(null);

    await expect(handler({} as any)).resolves.toEqual({ error: "Not found" });

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("omits the transcript by default", async () => {
    const db = createDbWithSelectResults([
      [{ email: "guest@example.com", name: "Guest", isOrganizer: false }],
      [
        {
          id: "item-1",
          text: "Prepare launch",
          assigneeEmail: null,
          completedAt: null,
        },
      ],
    ]);
    mockGetDb.mockReturnValue(db);

    const result = await handler({} as any);

    expect(result).toMatchObject({
      meeting: {
        id: "meeting-1",
        summaryMd: "The team agreed on the launch plan.",
        bullets: [{ text: "Ship on Tuesday" }],
        participants: [
          { email: "guest@example.com", name: "Guest", isOrganizer: false },
        ],
        actionItems: [
          {
            id: "item-1",
            text: "Prepare launch",
            assigneeEmail: null,
            completedAt: null,
          },
        ],
      },
      viewer: null,
    });
    expect("transcript" in (result as any).meeting).toBe(false);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      {},
      "Cache-Control",
      "private, max-age=0, no-store",
    );
  });

  it("includes a normalized transcript only after the owner opts in", async () => {
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: makeMeeting({ shareTranscript: true }),
    });
    const db = createDbWithSelectResults([]);
    db.select = vi
      .fn()
      .mockImplementationOnce(() => selectBuilder([]))
      .mockImplementationOnce(() => selectBuilder([]))
      .mockImplementationOnce(() =>
        selectBuilder([
          {
            status: "ready",
            language: "en",
            fullText: "Hello team. We are ready.",
            failureReason: null,
            segmentsJson: JSON.stringify([
              {
                startMs: 0,
                endMs: 1_200,
                text: "Hello team.",
                source: "mic",
              },
            ]),
            updatedAt: "2026-07-20T17:31:00.000Z",
          },
        ]),
      );
    mockGetDb.mockReturnValue(db);

    const result = await handler({} as any);

    expect(result).toMatchObject({
      meeting: {
        transcript: {
          status: "ready",
          language: "en",
          fullText: "Hello team. We are ready.",
          segments: [
            {
              startMs: 0,
              endMs: 1_200,
              text: "Hello team.",
              source: "mic",
            },
          ],
        },
      },
    });
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it("passes the signed-in viewer context to meeting access resolution", async () => {
    mockGetSession.mockResolvedValue({
      email: "shared@example.com",
      orgId: "org-1",
    });
    mockResolveAccess.mockResolvedValue({
      role: "editor",
      resource: makeMeeting(),
    });
    mockGetDb.mockReturnValue(createDbWithSelectResults([[], []]));

    const result = await handler({} as any);

    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "shared@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mockResolveAccess).toHaveBeenCalledWith("meeting", "meeting-1", {
      userEmail: "shared@example.com",
      orgId: "org-1",
    });
    expect(result).toMatchObject({
      viewer: { role: "editor", canEdit: true, isOwner: false },
    });
  });

  it("returns not found for trashed meetings", async () => {
    mockResolveAccess.mockResolvedValue({
      role: "owner",
      resource: makeMeeting({ trashedAt: "2026-07-20T18:00:00.000Z" }),
    });

    await expect(handler({} as any)).resolves.toEqual({ error: "Not found" });

    expect(mockGetDb).not.toHaveBeenCalled();
  });
});

function selectBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}
