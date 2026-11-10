import { beforeEach, describe, expect, it, vi } from "vitest";

const expiryAccess = vi.hoisted(() => ({
  role: "editor",
  expiresAt: null as string | null,
}));

type Rows = Array<Record<string, unknown>>;
const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Rows | (() => Rows)>,
}));
const mockRemoval = vi.hoisted(() => ({ at: null as string | null }));
const mockUpdateReturning = vi.hoisted(() =>
  vi.fn(async () => [{ id: "rec_1" }]),
);
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockUpdateReturning })),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockReadAppState = vi.hoisted(() =>
  vi.fn(async () => null as Record<string, unknown> | null),
);
const mockCompareAndSetManyAppState = vi.hoisted(() => vi.fn(async () => true));
const mockCleanupTranscriptRun = vi.hoisted(() => vi.fn());
const mockLoadAgentsContext = vi.hoisted(() => vi.fn(async () => ""));

const mockDb = vi.hoisted(() => ({
  select: vi.fn((projection?: Record<string, unknown>) => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (projection && "removedAt" in projection) {
            return [{ removedAt: mockRemoval.at }];
          }
          const next = mockSelectRows.queue.shift() ?? [];
          return typeof next === "function" ? next() : next;
        }),
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
  compareAndSetManyAppState: mockCompareAndSetManyAppState,
  readAppState: mockReadAppState,
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

const mockChatModelAvailability = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/server", () => ({
  resolveChatModelAvailability: mockChatModelAvailability,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  assertAccess: vi.fn(async () => ({
    role: expiryAccess.role,
    resource: { expiresAt: expiryAccess.expiresAt },
  })),
}));

vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
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
  loadAgentsMdContext: mockLoadAgentsContext,
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
    expiryAccess.role = "editor";
    expiryAccess.expiresAt = null;
    vi.clearAllMocks();
    mockSelectRows.queue = [];
    mockRemoval.at = null;
    mockReadAppState.mockResolvedValue(null);
    mockCompareAndSetManyAppState.mockResolvedValue(true);
    mockUpdateReturning.mockResolvedValue([{ id: "rec_1" }]);
    mockLoadAgentsContext.mockResolvedValue("");
    mockChatModelAvailability.mockResolvedValue("available");
  });

  it("does not automatically replace a manually chosen default title", async () => {
    mockSelectRows.queue = [
      [
        {
          id: "rec_1",
          title: "Untitled recording",
          titleSource: "manual",
          updatedAt: "one",
          description: "Saved",
        },
      ],
    ];
    await expect(
      regenerateTitle.run({ recordingId: "rec_1", automatic: true }),
    ).resolves.toMatchObject({
      updated: false,
      skipped: true,
      reason: "Recording title is manual",
    });
    expect(mockCleanupTranscriptRun).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("allows an explicit request to regenerate a manually chosen default title", async () => {
    const manual = {
      title: "Untitled recording",
      titleSource: "manual",
      updatedAt: "one",
    };
    mockSelectRows.queue = [
      [{ id: "rec_1", ...manual, description: "Saved" }],
      [
        {
          status: "ready",
          fullText: "A representative transcript for the recording.",
          segmentsJson: "[]",
        },
      ],
      [manual],
    ];
    mockCleanupTranscriptRun.mockResolvedValueOnce({
      title: "Generated title",
      provider: "builder",
    });
    await expect(
      regenerateTitle.run({ recordingId: "rec_1" }),
    ).resolves.toMatchObject({ updated: true, title: "Generated title" });
  });

  describe("when earlier audio is removed while the title generates", () => {
    const untitled = {
      title: "Untitled recording",
      titleSource: "default",
      updatedAt: "one",
    };
    const removedAt = "2026-11-03T10:00:00.000Z";
    const staleRead = [
      [{ id: "rec_1", ...untitled, description: "" }],
      [
        {
          status: "ready",
          fullText: "Audio the user is about to remove.",
          segmentsJson: "[]",
        },
      ],
    ];

    it("drops a generated title", async () => {
      mockSelectRows.queue = [...staleRead, [untitled]];
      mockCleanupTranscriptRun.mockImplementationOnce(async () => {
        mockRemoval.at = removedAt;
        return { title: "Title from removed audio", provider: "builder" };
      });

      await expect(
        regenerateTitle.run({ recordingId: "rec_1" }),
      ).resolves.toMatchObject({ updated: false, reason: "title_changed" });

      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("drops a fallback title", async () => {
      mockSelectRows.queue = [...staleRead, [untitled]];
      mockCleanupTranscriptRun.mockImplementationOnce(async () => {
        mockRemoval.at = removedAt;
        throw new Error("no provider");
      });

      await expect(
        regenerateTitle.run({ recordingId: "rec_1" }),
      ).resolves.toMatchObject({ updated: false, reason: "title_changed" });

      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it.each([
      ["matches the current title", "Agent Credits Cost $63"],
      ["comes back empty", ""],
    ])(
      "queues no refinement of the old text when the model's title %s",
      async (_case, generated) => {
        const title = "Agent Credits Cost $63";
        const current = { title, titleSource: "ai", updatedAt: "one" };
        mockSelectRows.queue = [
          [{ id: "rec_1", ...current, description: "" }],
          [
            {
              status: "ready",
              fullText:
                "It's easier to just walk through this real quick. Regarding your question about the agent credits costing $63, there are two reasons. The CPQ tool cannot show the SLA fee as a separate line item today.",
              segmentsJson: "[]",
            },
          ],
          [current],
          [current],
        ];
        mockCleanupTranscriptRun.mockImplementationOnce(async () => {
          mockRemoval.at = removedAt;
          return { title: generated, provider: "builder" };
        });

        await expect(
          regenerateTitle.run({ recordingId: "rec_1" }),
        ).resolves.toMatchObject({ updated: false, reason: "title_changed" });

        expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
      },
    );

    it("queues no full-video request carrying text read before the removal", async () => {
      const { readIncludeFullVideoInAi } =
        await import("./lib/clips-ai-prefs.js");
      vi.mocked(readIncludeFullVideoInAi).mockResolvedValueOnce(true);
      mockSelectRows.queue = [
        () => {
          mockRemoval.at = removedAt;
          return [{ id: "rec_1", ...untitled, description: "" }];
        },
        [
          {
            status: "ready",
            fullText: "What remains.",
            segmentsJson: "[]",
            earlierAudioRemovedAt: removedAt,
          },
        ],
      ];

      await expect(
        regenerateTitle.run({ recordingId: "rec_1" }),
      ).resolves.toMatchObject({ updated: false, reason: "title_changed" });
    });

    it("drops a title whose current title was read just before the removal", async () => {
      mockSelectRows.queue = [
        () => {
          mockRemoval.at = removedAt;
          return [{ id: "rec_1", ...untitled, description: "" }];
        },
        [
          {
            status: "ready",
            fullText: "What remains.",
            segmentsJson: "[]",
            earlierAudioRemovedAt: removedAt,
          },
        ],
        [untitled],
      ];
      mockCleanupTranscriptRun.mockResolvedValueOnce({
        title: "Title from removed audio",
        provider: "builder",
      });

      await expect(
        regenerateTitle.run({ recordingId: "rec_1" }),
      ).resolves.toMatchObject({ updated: false, reason: "title_changed" });

      expect(mockUpdateSet).not.toHaveBeenCalled();
    });
  });

  it.each([false, true])(
    "rechecks title expiry after cleanup without falling back (owner=%s)",
    async (owner) => {
      expiryAccess.role = owner ? "owner" : "editor";
      mockSelectRows.queue = [
        [
          {
            id: "rec_1",
            title: "Untitled recording",
            titleSource: "default",
            description: "Saved",
          },
        ],
        [
          {
            status: "ready",
            fullText: "Fake transcript for a title",
            segmentsJson: "[]",
            ownerEmail: "owner@example.com",
          },
        ],
        [{ title: "Untitled recording", titleSource: "default" }],
      ];
      mockCleanupTranscriptRun.mockImplementationOnce(async () => {
        expiryAccess.expiresAt = "2000-01-01T00:00:00Z";
        return { title: "Fake delayed title", provider: "builder" };
      });
      const pending = regenerateTitle.run({ recordingId: "rec_1" });
      if (owner)
        await expect(pending).resolves.toMatchObject({ updated: true });
      else {
        await expect(pending).rejects.toMatchObject({ statusCode: 403 });
        expect(mockUpdateSet).not.toHaveBeenCalled();
        expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
      }
    },
  );

  it.each([false, true])(
    "rechecks expiry before queuing a same-title refinement (owner=%s)",
    async (owner) => {
      expiryAccess.role = owner ? "owner" : "editor";
      const title = "Agent Credits Cost $63";
      mockSelectRows.queue = [
        [{ id: "rec_1", title, titleSource: "manual", description: "Saved" }],
        [
          {
            status: "ready",
            fullText:
              "It's easier to just walk through this real quick. Regarding your question about the agent credits costing $63, there are two reasons. The CPQ tool cannot show the SLA fee as a separate line item today.",
            segmentsJson: "[]",
            ownerEmail: "owner@example.com",
          },
        ],
        [{ title, titleSource: "manual" }],
        [{ title, titleSource: "manual" }],
      ];
      mockCleanupTranscriptRun.mockImplementationOnce(async () => {
        expiryAccess.expiresAt = "2000-01-01T00:00:00Z";
        return { title, provider: "builder" };
      });
      const pending = regenerateTitle.run({ recordingId: "rec_1" });
      if (owner) await expect(pending).resolves.toMatchObject({ queued: true });
      else {
        await expect(pending).rejects.toMatchObject({ statusCode: 403 });
        expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
      }
      expect(mockUpdateSet).not.toHaveBeenCalled();
    },
  );

  it("does not overwrite a manual edit made while the generated title is being saved", async () => {
    mockSelectRows.queue = [
      [
        {
          id: "rec_1",
          title: "Untitled recording",
          titleSource: "default",
          description: "Saved",
        },
      ],
      [
        {
          status: "ready",
          fullText: "A representative transcript for the recording.",
          segmentsJson: "[]",
        },
      ],
      [{ title: "Untitled recording", titleSource: "default" }],
    ];
    mockCleanupTranscriptRun.mockResolvedValueOnce({
      title: "Generated title",
      provider: "builder",
    });
    mockUpdateReturning.mockResolvedValueOnce([]);
    await expect(
      regenerateTitle.run({ recordingId: "rec_1" }),
    ).resolves.toMatchObject({
      updated: false,
      skipped: true,
      reason: "title_changed",
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it.each(["generated", "fallback"])(
    "preserves a manual rename back to the original title on the %s path",
    async (path) => {
      const original = {
        id: "rec_1",
        title: "Untitled recording",
        titleSource: "default",
        updatedAt: "2026-01-01T00:00:00Z",
        description: "Saved",
      };
      const renamed = {
        title: original.title,
        titleSource: "manual",
        updatedAt: "2026-01-01T00:00:01Z",
      };
      mockSelectRows.queue = [
        [original],
        [
          {
            status: "ready",
            fullText: "A representative transcript for the recording.",
            segmentsJson: "[]",
          },
        ],
        [renamed],
      ];
      if (path === "generated") {
        mockCleanupTranscriptRun.mockResolvedValueOnce({
          title: "Generated title",
          provider: "builder",
        });
      } else {
        mockCleanupTranscriptRun.mockRejectedValueOnce(
          new Error("provider unavailable"),
        );
      }
      const result = await regenerateTitle.run({ recordingId: "rec_1" });
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(result).toMatchObject({ updated: false, skipped: true });
    },
  );

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
      [{ title: "Agent Credits Cost $63", titleSource: "context" }],
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
    expect(mockCompareAndSetManyAppState).toHaveBeenCalledWith([
      {
        key: "clips-ai-request-status-rec_1",
        expectedValue: null,
        nextValue: expect.objectContaining({
          kind: "generate-metadata",
          status: "queued",
        }),
      },
      {
        key: "clips-ai-request-rec_1",
        expectedValue: null,
        nextValue: expect.objectContaining({
          kind: "generate-metadata",
          includeSummary: true,
          currentTitle: "Agent Credits Cost $63",
        }),
      },
    ]);
    expect(result).toMatchObject({
      updated: true,
      queued: true,
      provider: "local",
      summaryQueued: true,
    });
  });
  it("keeps the local title and queues no agent work when no chat model is available", async () => {
    mockChatModelAvailability.mockResolvedValue("unavailable");
    mockCleanupTranscriptRun.mockRejectedValue(new Error("no model"));
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
          fullText:
            "The CPQ tool cannot show the SLA fee as a separate line item today.",
          segmentsJson: "[]",
          ownerEmail: "owner@example.com",
        },
      ],
      [{ title: "Untitled recording", titleSource: "default" }],
    ];

    const result = await regenerateTitle.run({
      recordingId: "rec_1",
      automatic: true,
      includeSummary: true,
    });

    expect(mockCleanupTranscriptRun).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      updated: true,
      queued: false,
      provider: "local",
    });
  });
  it("keeps the local title for an automatic full-video request when no chat model is available", async () => {
    mockChatModelAvailability.mockResolvedValue("unavailable");
    const { readIncludeFullVideoInAi } =
      await import("./lib/clips-ai-prefs.js");
    vi.mocked(readIncludeFullVideoInAi).mockResolvedValueOnce(true);
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
          fullText:
            "The CPQ tool cannot show the SLA fee as a separate line item today.",
          segmentsJson: "[]",
          ownerEmail: "owner@example.com",
        },
      ],
      [{ title: "Untitled recording", titleSource: "default" }],
    ];

    const result = await regenerateTitle.run({
      recordingId: "rec_1",
      automatic: true,
    });

    expect(mockUpdateSet).toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      updated: true,
      queued: false,
      provider: "local",
    });
  });
  it("fails a manual request loudly when no chat model is available", async () => {
    mockChatModelAvailability.mockResolvedValue("unavailable");
    mockSelectRows.queue = [
      [
        {
          id: "rec_1",
          title: "My clip",
          titleSource: "default",
          description: "",
        },
      ],
      [
        {
          status: "ready",
          fullText:
            "The CPQ tool cannot show the SLA fee as a separate line item today.",
          segmentsJson: "[]",
          ownerEmail: "owner@example.com",
        },
      ],
      [{ title: "My clip", titleSource: "default" }],
    ];

    await expect(
      regenerateTitle.run({ recordingId: "rec_1", automatic: false }),
    ).rejects.toMatchObject({ errorCode: "ai_model_unavailable" });
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
  });
  it("keeps the local title and reports the refusal when the model check is unreadable", async () => {
    mockChatModelAvailability.mockResolvedValue("unknown");
    mockCleanupTranscriptRun.mockRejectedValue(new Error("no model"));
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
          fullText:
            "The CPQ tool cannot show the SLA fee as a separate line item today.",
          segmentsJson: "[]",
          ownerEmail: "owner@example.com",
        },
      ],
      [{ title: "Untitled recording", titleSource: "default" }],
    ];

    const result = await regenerateTitle.run({
      recordingId: "rec_1",
      automatic: true,
    });

    expect(mockUpdateSet).toHaveBeenCalled();
    expect(mockCompareAndSetManyAppState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      updated: true,
      queued: false,
      queueSkippedReason: "ai_model_lookup_unavailable",
    });
  });
});
