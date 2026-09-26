import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockFinalizeRun = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockCompareAndSetManyAppState = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn((_context: unknown, fn: () => unknown) => fn()),
);
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockRecordingRows = vi.hoisted(() => ({
  rows: [] as Array<{
    ownerEmail: string;
    authUserId?: string | null;
    orgId: string | null;
    videoUrl?: string | null;
    uploadAttemptId?: string | null;
    uploadGenerationId?: string | null;
  }>,
}));
const mockLimit = vi.hoisted(() => vi.fn(async () => mockRecordingRows.rows));
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  compareAndSetManyAppState: (...args: unknown[]) =>
    mockCompareAndSetManyAppState(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, fn: () => unknown) =>
    mockRunWithRequestContext(context, fn),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNull: vi.fn((column: unknown) => ({ column, kind: "isNull" })),
  sql: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mockSelect }),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      authUserId: "recordings.authUserId",
      orgId: "recordings.orgId",
      status: "recordings.status",
      trashedAt: "recordings.trashedAt",
      videoUrl: "recordings.videoUrl",
      uploadAttemptId: "recordings.uploadAttemptId",
      uploadGenerationId: "recordings.uploadGenerationId",
    },
  },
}));

vi.mock("../lib/recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
}));

vi.mock("../../actions/finalize-recording.js", () => ({
  default: { run: (...args: unknown[]) => mockFinalizeRun(...args) },
}));

import { runMediaVerificationSweepOnce } from "./media-verification";

function marker(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    recordingId: "rec-1",
    status: "pending",
    completedAttempts: 2,
    nextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    leaseUntil: null,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    uploadAttemptId: "attempt-1",
    uploadGenerationId: "generation-1",
    ...overrides,
  });
}

function legacyMarker(overrides: Record<string, unknown> = {}) {
  return marker({
    uploadAttemptId: undefined,
    uploadGenerationId: undefined,
    ...overrides,
  });
}

function queueMarker(value: string) {
  mockExecute.mockResolvedValue({
    rows: [
      {
        session_id: "owner@example.com",
        key: "recording-media-verification-rec-1",
        value,
      },
    ],
  });
}

function legacyUploadState(overrides: Record<string, unknown> = {}) {
  return {
    recordingId: "rec-1",
    status: "processing",
    pendingMediaVerification: true,
    mediaVerificationAttempt: 2,
    videoUrl: "https://cdn.example.com/rec-1.webm",
    ...overrides,
  };
}

describe("media verification recovery sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFinalizeRun.mockResolvedValue({ status: "processing" });
    mockReadAppState.mockResolvedValue(null);
    mockCompareAndSetManyAppState.mockResolvedValue(true);
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockRecordingRows.rows = [
      {
        ownerEmail: "owner@example.com",
        authUserId: "auth-user-1",
        orgId: "org-1",
        videoUrl: "https://cdn.example.com/rec-1.webm",
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      },
    ];
  });

  it("re-drives an overdue marker using only SQL-backed ownership context", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            ownerEmail: "spoofed@example.com",
            orgId: "spoofed-org",
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockOwnerEmailMatches).toHaveBeenCalledWith(
      "recordings.ownerEmail",
      "owner@example.com",
    );
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      {
        userEmail: "owner@example.com",
        authUserId: "auth-user-1",
        orgId: "org-1",
      },
      expect.any(Function),
    );
    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 3,
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    });
  });

  it("does not invoke recovery when the session does not own the recording", async () => {
    mockRecordingRows.rows = [];
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "attacker@example.com",
          key: "recording-media-verification-rec-1",
          value: marker(),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("leaves a newly dispatched verification alone", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            completedAttempts: 1,
            nextAttemptAt: new Date(Date.now() + 5_000).toISOString(),
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("reclaims a worker lease after it expires", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            status: "leased",
            leaseUntil: new Date(Date.now() - 1_000).toISOString(),
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 3,
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    });
  });

  it("does not re-drive a marker owned by a replaced upload attempt", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            uploadAttemptId: "attempt-old",
            uploadGenerationId: "generation-old",
          }),
        },
      ],
    });
    mockRecordingRows.rows = [
      {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        uploadAttemptId: "attempt-new",
        uploadGenerationId: "generation-new",
      },
    ];

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("does not attach an unfenced legacy marker to a replacement attempt", async () => {
    queueMarker(legacyMarker());

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("adopts a due legacy marker when upload state confirms the recording", async () => {
    const legacyMarkerValue = legacyMarker();
    queueMarker(legacyMarkerValue);
    mockReadAppState.mockResolvedValue(legacyUploadState());

    await runMediaVerificationSweepOnce();

    expect(mockCompareAndSetManyAppState).toHaveBeenCalledTimes(1);
    const [operations] = mockCompareAndSetManyAppState.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      key: "recording-media-verification-rec-1",
      expectedValue: JSON.parse(legacyMarkerValue),
      nextValue: {
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      },
    });
    expect(operations[1]).toMatchObject({
      key: "recording-upload-rec-1",
      expectedValue: legacyUploadState(),
      nextValue: {
        uploadAttemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      },
    });
    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 3,
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    });
  });

  it.each([
    ["different recording", { recordingId: "rec-2" }],
    ["non-processing upload", { status: "failed" }],
    ["non-pending media", { pendingMediaVerification: false }],
    ["different verification attempt", { mediaVerificationAttempt: 1 }],
    ["empty video URL", { videoUrl: " " }],
    ["different video URL", { videoUrl: "https://cdn.example.com/other.webm" }],
    ["partial upload identity", { uploadAttemptId: "attempt-1" }],
    [
      "mismatched upload identity",
      { uploadAttemptId: "attempt-old", uploadGenerationId: "generation-old" },
    ],
  ] as const)(
    "does not adopt a legacy marker with %s",
    async (_name, state) => {
      queueMarker(legacyMarker());
      mockReadAppState.mockResolvedValue(legacyUploadState(state));

      await runMediaVerificationSweepOnce();

      expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
      expect(mockFinalizeRun).not.toHaveBeenCalled();
    },
  );

  it("does not adopt a legacy marker while its lease is active", async () => {
    queueMarker(
      legacyMarker({
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    mockReadAppState.mockResolvedValue(legacyUploadState());

    await runMediaVerificationSweepOnce();

    expect(mockReadAppState).not.toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("does not finalize when legacy marker adoption loses the CAS", async () => {
    queueMarker(legacyMarker());
    mockReadAppState.mockResolvedValue(legacyUploadState());
    mockCompareAndSetManyAppState.mockResolvedValue(false);

    await runMediaVerificationSweepOnce();

    expect(mockCompareAndSetManyAppState).toHaveBeenCalledTimes(1);
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("rejects a legacy marker with only one upload identity field", async () => {
    queueMarker(marker({ uploadGenerationId: undefined }));

    await runMediaVerificationSweepOnce();

    expect(mockReadAppState).not.toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("rejects a marker whose key and payload identify different recordings", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-2",
          value: marker(),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });
});
