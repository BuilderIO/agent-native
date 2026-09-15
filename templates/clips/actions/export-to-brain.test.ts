import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessFilter: vi.fn(),
  assertAccess: vi.fn(),
  getActiveOrganizationId: vi.fn(),
  getAppProductionUrl: vi.fn(),
  getCredentialContext: vi.fn(),
  getCurrentOwnerEmail: vi.fn(),
  meetings: {
    recordingId: "meetings.recordingId",
  },
  meetingShares: {},
  ownerEmailMatches: vi.fn(),
  resolveCredential: vi.fn(),
  select: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: mocks.getAppProductionUrl,
  getCredentialContext: mocks.getCredentialContext,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    meetings: mocks.meetings,
    meetingShares: mocks.meetingShares,
    meetingParticipants: {
      meetingId: "meetingParticipants.meetingId",
      createdAt: "meetingParticipants.createdAt",
    },
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      organizationId: "recordings.organizationId",
      trashedAt: "recordings.trashedAt",
      createdAt: "recordings.createdAt",
    },
    recordingShares: {},
    recordingTags: {
      tag: "recordingTags.tag",
      recordingId: "recordingTags.recordingId",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      status: "recordingTranscripts.status",
      fullText: "recordingTranscripts.fullText",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getActiveOrganizationId: mocks.getActiveOrganizationId,
  getCurrentOwnerEmail: mocks.getCurrentOwnerEmail,
  ownerEmailMatches: mocks.ownerEmailMatches,
}));

vi.mock("../shared/transcript-segments.js", () => ({
  normalizeTranscriptSegments: ({ segments }: { segments: unknown[] }) =>
    segments,
  parseTranscriptSegments: () => [
    { startMs: 0, endMs: 1000, text: "Transcript text" },
  ],
}));

import action, { interpretBrainResponse } from "./export-to-brain.js";

const recording = {
  id: "recording-1",
  organizationId: "org-example",
  title: "Weekly product review",
  description: "",
  durationMs: 1000,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:01:00.000Z",
  sourceAppName: "Clips",
  sourceWindowTitle: null,
  spaceIds: "[]",
  chaptersJson: "[]",
};

const transcript = {
  recordingId: recording.id,
  ownerEmail: "person@example.com",
  language: "en",
  segmentsJson: "[]",
  fullText: "Transcript text",
  status: "ready",
  failureReason: null,
  retryCount: 0,
  createdAt: recording.createdAt,
  updatedAt: recording.updatedAt,
};

const secondRecording = {
  ...recording,
  id: "recording-2",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:01:00.000Z",
};

const secondTranscript = {
  ...transcript,
  recordingId: secondRecording.id,
  createdAt: secondRecording.createdAt,
  updatedAt: secondRecording.updatedAt,
};

function queryResult(result: unknown) {
  const promise = Promise.resolve(result);
  const query: Record<string, unknown> = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => promise,
    then: promise.then.bind(promise),
  };
  return query;
}

function queueSelectResults(results: unknown[]) {
  for (const result of results) {
    mocks.select.mockReturnValueOnce(queryResult(result));
  }
}

function configureDestination() {
  mocks.getCredentialContext.mockReturnValue({
    userEmail: "person@example.com",
    orgId: "org-example",
  });
  mocks.resolveCredential.mockImplementation(async (key: string) =>
    key === "BRAIN_INGEST_URL"
      ? "https://brain.example.test/api/_agent-native/brain/ingest"
      : "example-ingest-token",
  );
}

describe("export-to-brain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessFilter.mockReturnValue(undefined);
    mocks.assertAccess.mockResolvedValue({ resource: recording });
    mocks.getActiveOrganizationId.mockResolvedValue("org-example");
    mocks.getAppProductionUrl.mockReturnValue("https://clips.example.test");
    mocks.getCurrentOwnerEmail.mockReturnValue("person@example.com");
    mocks.ownerEmailMatches.mockReturnValue(undefined);
  });

  it("requires both scoped destination credentials", async () => {
    mocks.getCredentialContext.mockReturnValue({
      userEmail: "person@example.com",
      orgId: "org-example",
    });
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "BRAIN_INGEST_URL"
        ? "https://brain.example.test/api/_agent-native/brain/ingest"
        : undefined,
    );

    await expect(
      action.run({
        recordingId: recording.id,
        lookbackDays: 28,
        limit: 100,
        concurrency: 4,
      }),
    ).resolves.toEqual({
      recordingId: recording.id,
      status: "skipped",
      reason: "missing-ingest-token",
    });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "clips-brain-export-recording-1",
      expect.objectContaining({
        recordingId: "recording-1",
        status: "failed",
        attempts: 1,
        reason: "missing-ingest-token",
        nextAttemptAt: expect.any(String),
      }),
    );
  });

  it("preserves the retry attempt when credentials are still missing", async () => {
    mocks.getCredentialContext.mockReturnValue({
      userEmail: "person@example.com",
      orgId: "org-example",
    });
    mocks.resolveCredential.mockResolvedValue(undefined);

    await action.run({
      recordingId: recording.id,
      lookbackDays: 28,
      limit: 100,
      concurrency: 4,
      retryAttempt: 4,
    });

    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "clips-brain-export-recording-1",
      expect.objectContaining({
        status: "failed",
        attempts: 4,
        reason: "missing-ingest-url",
      }),
    );
  });

  it("exports one recording with an absolute source URL and proof of capture", async () => {
    configureDestination();
    queueSelectResults([[transcript], [], []]);
    mocks.ssrfSafeFetch.mockResolvedValue(
      Response.json({
        ok: true,
        capture: { id: "capture-example" },
      }),
    );

    await expect(
      action.run({
        recordingId: recording.id,
        lookbackDays: 28,
        limit: 100,
        concurrency: 4,
      }),
    ).resolves.toEqual({
      recordingId: recording.id,
      status: "exported",
      captureId: "capture-example",
    });

    const [, request, options] = mocks.ssrfSafeFetch.mock.calls[0]!;
    expect(options).toEqual({ maxRedirects: 0 });
    expect(request.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer example-ingest-token",
    });
    expect(JSON.parse(request.body)).toMatchObject({
      externalId: "clips:recording:recording-1",
      sourceUrl: "https://clips.example.test/r/recording-1",
    });
    expect(mocks.accessFilter).toHaveBeenCalledWith(
      mocks.meetings,
      mocks.meetingShares,
    );
  });

  it("sends a canonical meeting summary before the transcript", async () => {
    configureDestination();
    queueSelectResults([
      [transcript],
      [
        {
          id: "meeting-1",
          recordingId: recording.id,
          title: "Weekly product review",
          summaryMd: "The team committed to the new launch sequence.",
          actualStart: null,
          scheduledStart: recording.createdAt,
        },
      ],
      [],
      [],
    ]);
    mocks.ssrfSafeFetch.mockResolvedValue(
      Response.json({ ok: true, capture: { id: "capture-example" } }),
    );

    await action.run({
      recordingId: recording.id,
      lookbackDays: 28,
      limit: 100,
      concurrency: 4,
    });

    const [, request] = mocks.ssrfSafeFetch.mock.calls[0]!;
    expect(JSON.parse(request.body)).toMatchObject({
      transcript:
        "Summary\nThe team committed to the new launch sequence.\n\nTranscript\nTranscript text",
    });
  });

  it("reports privacy quarantine instead of claiming export success", async () => {
    await expect(
      interpretBrainResponse(
        recording.id,
        Response.json({
          ok: true,
          capture: null,
          sensitivityReceipt: {
            id: "receipt-example",
            disposition: "quarantined",
          },
        }),
      ),
    ).resolves.toEqual({
      recordingId: recording.id,
      status: "quarantined",
      sensitivityReceiptId: "receipt-example",
      sensitivityDisposition: "quarantined",
    });
  });

  it("backfills only the bounded cohort returned by the active-org query", async () => {
    configureDestination();
    queueSelectResults([[{ recording, transcript }], [], []]);
    mocks.ssrfSafeFetch.mockResolvedValue(
      Response.json({ ok: true, capture: { id: "capture-example" } }),
    );

    const result = await action.run({
      lookbackDays: 28,
      limit: 25,
      concurrency: 2,
    });

    expect(mocks.getActiveOrganizationId).toHaveBeenCalledOnce();
    expect(mocks.getCurrentOwnerEmail).toHaveBeenCalledOnce();
    expect(mocks.ownerEmailMatches).toHaveBeenCalledWith(
      "recordings.ownerEmail",
      "person@example.com",
    );
    expect(result).toMatchObject({
      mode: "backfill",
      organizationId: "org-example",
      ownerEmail: "person@example.com",
      lookbackDays: 28,
      limit: 25,
      truncated: false,
      candidateCount: 1,
      attempted: 1,
      exported: 1,
      quarantined: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("returns a stable cursor that advances a second page", async () => {
    configureDestination();
    queueSelectResults([
      [
        { recording, transcript },
        { recording: secondRecording, transcript: secondTranscript },
      ],
      [],
      [],
      [{ recording: secondRecording, transcript: secondTranscript }],
      [],
      [],
    ]);
    mocks.ssrfSafeFetch.mockImplementation(async (_url, request) => {
      const payload = JSON.parse(String(request.body)) as {
        externalId: string;
      };
      return Response.json({
        ok: true,
        capture: {
          id: `capture-${payload.externalId.split(":").pop()}`,
        },
      });
    });

    const firstPage = await action.run({
      lookbackDays: 28,
      limit: 1,
      concurrency: 1,
    });
    expect(firstPage).toMatchObject({
      truncated: true,
      candidateCount: 1,
      exported: 1,
      results: [
        {
          recordingId: "recording-1",
          captureId: "capture-recording-1",
        },
      ],
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await action.run({
      lookbackDays: 7,
      limit: 1,
      concurrency: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage).toMatchObject({
      since: firstPage.since,
      until: firstPage.until,
      lookbackDays: 28,
      truncated: false,
      nextCursor: null,
      candidateCount: 1,
      exported: 1,
      results: [
        {
          recordingId: "recording-2",
          captureId: "capture-recording-2",
        },
      ],
    });
  });
});
