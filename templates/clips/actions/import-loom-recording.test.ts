import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureEnabledAt: vi.fn(),
  enqueue: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  ownerEmailMatches: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({ uploadFile: vi.fn() }));
vi.mock("@agent-native/core/server", () => ({ buildDeepLink: vi.fn() }));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => mocks.and(...args),
  asc: (...args: unknown[]) => mocks.asc(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
  gte: (...args: unknown[]) => mocks.gte(...args),
  inArray: (...args: unknown[]) => mocks.inArray(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      sourceAppName: "recordings.sourceAppName",
      createdAt: "recordings.createdAt",
    },
  },
}));

vi.mock("../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: vi.fn(),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(),
  getOrganizationDefaultVisibility: vi.fn(),
  nanoid: vi.fn(),
  ownerEmailMatches: (...args: unknown[]) => mocks.ownerEmailMatches(...args),
  parseSpaceIds: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  stringifySpaceIds: vi.fn(),
}));

vi.mock("../server/lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    ensureEnabledAt: (...args: unknown[]) => mocks.ensureEnabledAt(...args),
    enqueue: (...args: unknown[]) => mocks.enqueue(...args),
  },
}));

vi.mock("../server/lib/video-storage.js", () => ({
  hasRequestVideoStorage: vi.fn(),
}));

vi.mock("./lib/direct-video.js", () => ({
  downloadDirectVideo: vi.fn(),
  isCandidateDirectVideoUrl: vi.fn(),
}));

vi.mock("./lib/loom-transcript.js", () => ({
  fetchLoomTranscript: vi.fn(),
  loomTranscriptUnavailableMessage: vi.fn(),
}));

vi.mock("./lib/loom-video.js", () => ({ downloadLoomVideo: vi.fn() }));

import { enqueueFirstImportEmailIfEligible } from "./import-loom-recording";

function createDb(firstReadyImportId: string | null) {
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.orderBy.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue(
    firstReadyImportId ? [{ id: firstReadyImportId }] : [],
  );
  return { select: mocks.select } as any;
}

describe("first imported recording transactional email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureEnabledAt.mockResolvedValue({
      enabledAt: "2026-07-01T00:00:00.000Z",
    });
    mocks.enqueue.mockResolvedValue({ created: true });
    mocks.ownerEmailMatches.mockReturnValue("owner-match");
    mocks.and.mockReturnValue("conditions");
    mocks.asc.mockImplementation((column) => ({ column, direction: "asc" }));
    mocks.eq.mockImplementation((column, value) => ({ column, value }));
    mocks.gte.mockImplementation((column, value) => ({ column, value }));
    mocks.inArray.mockImplementation((column, values) => ({ column, values }));
  });

  it("enqueues only when this recording is the first ready import after enablement", async () => {
    const db = createDb("recording-first");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-first",
        ownerEmail: "Owner@Example.com",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      db,
    );

    expect(mocks.eq).toHaveBeenCalledWith("recordings.status", "ready");
    expect(mocks.inArray).toHaveBeenCalledWith("recordings.sourceAppName", [
      "Loom",
      "Video link",
    ]);
    expect(mocks.gte).toHaveBeenCalledWith(
      "recordings.createdAt",
      "2026-07-01T00:00:00.000Z",
    );
    expect(mocks.orderBy).toHaveBeenCalledWith(
      { column: "recordings.createdAt", direction: "asc" },
      { column: "recordings.id", direction: "asc" },
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "first-import:owner@example.com",
      {
        type: "first-import",
        recipient: "Owner@Example.com",
        recordingIds: ["recording-first"],
        requestedBy: "Owner@Example.com",
      },
    );
  });

  it("does not query or enqueue for a recording created before enablement", async () => {
    const db = createDb("recording-old");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-old",
        ownerEmail: "owner@example.com",
        createdAt: "2026-06-30T23:59:59.999Z",
      },
      db,
    );

    expect(mocks.ensureEnabledAt).toHaveBeenCalledOnce();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue later successful imports", async () => {
    const db = createDb("recording-first");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-later",
        ownerEmail: "owner@example.com",
        createdAt: "2026-07-03T00:00:00.000Z",
      },
      db,
    );

    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
