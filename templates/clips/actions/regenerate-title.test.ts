import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Array<Record<string, unknown>>>,
}));
const mockUpdateWhere = vi.hoisted(() => vi.fn(async () => undefined));
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockCleanupTranscriptRun = vi.hoisted(() => vi.fn());

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mockSelectRows.queue.shift() ?? []),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: mockUpdateSet,
  })),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ role: "editor" })),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      title: "recordings.title",
      titleSource: "recordings.titleSource",
      description: "recordings.description",
      updatedAt: "recordings.updatedAt",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
    },
  },
}));

vi.mock("../shared/builder-credits.js", () => ({
  isBuilderCreditsExhaustedMessage: vi.fn(() => false),
}));

vi.mock("../shared/clips-ai-prefs.js", () => ({
  withFullVideoAiInstructions: (message: string) => message,
}));

vi.mock("./cleanup-transcript.js", () => ({
  default: { run: (...args: unknown[]) => mockCleanupTranscriptRun(...args) },
}));

vi.mock("./lib/agents-md-context.js", () => ({
  loadAgentsMdContext: vi.fn(async () => ""),
}));

vi.mock("./lib/builder-credits-state.js", () => ({
  clearBuilderCreditsExhausted: vi.fn(async () => undefined),
}));

vi.mock("./lib/clips-ai-prefs.js", () => ({
  readIncludeFullVideoInAi: vi.fn(async () => false),
}));

vi.mock("./regenerate-summary.js", () => ({
  default: { run: vi.fn(async () => ({ queued: true })) },
}));

import { fallbackTitleFromTranscript } from "./lib/title-fallback";
import regenerateTitle from "./regenerate-title";

describe("fallbackTitleFromTranscript", () => {
  it("ignores opening filler and titles the transcript topic", () => {
    const title = fallbackTitleFromTranscript(`
      It’s easier to just walk through this real quick.
      Regarding your question about the agent credits costing $63, there are two reasons—or rather, two scenarios.
      First, this is essentially a hack because we don't have a good CPQ tool or mechanism.
      Any dollar spent on builders is going to have an SLA support fee that is a percentage of the dollars spent.
    `);

    expect(title).toBe("Agent Credits Cost $63");
  });

  it("preserves acronyms in extracted titles", () => {
    const title = fallbackTitleFromTranscript(`
      Let me walk through this quickly.
      The CPQ tool cannot show the SLA fee as a separate line item today.
    `);

    expect(title).toBe("CPQ Tool Cannot Show the SLA Fee");
  });
});

describe("regenerate-title fallback refinement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.queue = [];
  });

  it("keeps a heuristic title replaceable and queues richer metadata", async () => {
    const transcript = `
      It’s easier to just walk through this real quick.
      Regarding your question about the agent credits costing $63, there are two reasons.
      The CPQ tool cannot show the SLA fee as a separate line item today.
    `;
    mockCleanupTranscriptRun.mockRejectedValue(
      new Error("Transcript title service unavailable"),
    );
    mockSelectRows.queue = [
      [
        {
          id: "rec_1",
          title: "Untitled recording",
          titleSource: "default",
          description: "",
        },
      ],
      [
        {
          status: "ready",
          fullText: transcript,
          segmentsJson: "[]",
          ownerEmail: "owner@example.com",
        },
      ],
      [{ title: "Untitled recording", titleSource: "default" }],
    ];

    const result = await regenerateTitle.run({
      recordingId: "rec_1",
      includeSummary: true,
    });

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Agent Credits Cost $63",
        titleSource: "context",
      }),
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_1",
      expect.objectContaining({
        kind: "generate-metadata",
        includeSummary: true,
        currentTitle: "Agent Credits Cost $63",
      }),
    );
    expect(result).toMatchObject({
      updated: true,
      queued: true,
      provider: "local",
      summaryQueued: true,
    });
  });
});
