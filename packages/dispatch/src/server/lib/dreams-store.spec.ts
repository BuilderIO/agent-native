import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  currentOwnerEmail: vi.fn(() => "owner@example.test"),
  currentOrgId: vi.fn(() => null),
  recordAudit: vi.fn(),
  searchAgentThreads: vi.fn(),
  getAgentThreadDebug: vi.fn(),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourcePut: vi.fn(),
}));

vi.mock("../../db/index.js", async () => {
  const schemaModule =
    await vi.importActual<typeof import("../../db/schema.js")>(
      "../../db/schema.js",
    );
  return {
    ...schemaModule,
    schema: schemaModule,
    getDb: mocks.getDb,
  };
});

vi.mock("./dispatch-store.js", () => ({
  currentOwnerEmail: mocks.currentOwnerEmail,
  currentOrgId: mocks.currentOrgId,
  recordAudit: mocks.recordAudit,
}));

vi.mock("./thread-debug-store.js", () => ({
  searchAgentThreads: mocks.searchAgentThreads,
  getAgentThreadDebug: mocks.getAgentThreadDebug,
}));

vi.mock("@agent-native/core/resources/store", () => ({
  SHARED_OWNER: "__shared__",
  resourceGetByPath: mocks.resourceGetByPath,
  resourceList: mocks.resourceList,
  resourcePut: mocks.resourcePut,
}));

import { schema } from "../../db/index.js";
import {
  applyDreamProposal,
  buildProposalInputs,
  ensureDreamJob,
  listDreamCandidates,
  type DreamCandidate,
  type DreamEvidence,
} from "./dreams-store.js";

function resource(path: string, content: string, owner = "owner@example.test") {
  return {
    id: `res-${path}`,
    owner,
    path,
    content,
    mimeType: "text/markdown",
    size: Buffer.byteLength(content, "utf8"),
    createdAt: 1,
    updatedAt: 2,
    createdBy: "agent",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

function resourceWithMime(
  path: string,
  content: string,
  owner = "owner@example.test",
  mimeType = "text/markdown",
) {
  return {
    ...resource(path, content, owner),
    mimeType,
  };
}

function createDbMock(proposal?: Record<string, unknown>) {
  let currentProposal = proposal;
  return {
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn((table) => ({
      set: vi.fn((values) => ({
        where: vi.fn(async () => {
          if (table === schema.dispatchDreamProposals && currentProposal) {
            currentProposal = { ...currentProposal, ...values };
          }
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table === schema.dispatchDreamProposals && currentProposal) {
              return [currentProposal];
            }
            return [];
          }),
          orderBy: vi.fn(async () => {
            if (table === schema.dispatchDreamProposals && currentProposal) {
              return [currentProposal];
            }
            return [];
          }),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  };
}

function explicitEvidence(
  overrides: Partial<DreamEvidence> = {},
): DreamEvidence {
  return {
    kind: "explicit-correction",
    label: "User corrected the agent",
    snippet:
      "Actually, remember to use shadcn DropdownMenu for action menus next time",
    threadId: "thread-1",
    threadTitle: "Memory correction",
    messageIndex: 0,
    createdAt: 1,
    ...overrides,
  };
}

function candidateWithEvidence(evidence: DreamEvidence[]): DreamCandidate {
  return {
    thread: {
      id: evidence[0]?.threadId ?? "thread-1",
      ownerEmail: "owner@example.test",
      title: evidence[0]?.threadTitle ?? "Dream thread",
      preview: "preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
    },
    sourceId: "current",
    score: 50,
    reasons: [
      {
        code: "explicit-correction",
        label: "User corrections should be considered for memory",
        score: 25,
        evidenceCount: evidence.length,
      },
    ],
    evidenceCounts: {},
    evidence,
    latestRunStatus: null,
  };
}

function pendingProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    dreamId: "dream-1",
    ownerEmail: "owner@example.test",
    orgId: null,
    targetType: "personal-memory",
    targetPath: "memory/custom.md",
    title: "Save explicit user corrections",
    summary: "Remember a user-grounded Dispatch correction.",
    rationale: "Explicit user corrections are high-signal evidence.",
    content: "# Dispatch Dream Memory\n\nUse shadcn menus.",
    evidence: JSON.stringify([explicitEvidence()]),
    confidence: 80,
    risk: "low",
    status: "pending",
    appliedBy: null,
    appliedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
  mocks.currentOrgId.mockReturnValue(null);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.resourceGetByPath.mockResolvedValue(null);
  mocks.resourceList.mockResolvedValue([]);
  mocks.resourcePut.mockImplementation(
    async (
      owner: string,
      path: string,
      content: string,
      mimeType = "text/markdown",
    ) => resourceWithMime(path, content, owner, mimeType),
  );
  mocks.getDb.mockReturnValue(createDbMock());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("listDreamCandidates", () => {
  it("scores grounded thread signals and keeps per-thread debug errors isolated", async () => {
    mocks.searchAgentThreads.mockResolvedValue({
      source: { id: "current" },
      access: { mode: "local" },
      query: null,
      threads: [{ id: "thread-1" }, { id: "thread-2" }],
    });
    mocks.getAgentThreadDebug.mockImplementation(async ({ threadId }) => {
      if (threadId === "thread-2") {
        throw new Error("debug unavailable");
      }
      return {
        thread: {
          id: "thread-1",
          ownerEmail: "owner@example.test",
          title: "Memory correction",
          preview: "remember this",
          messageCount: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        messages: [
          {
            role: "user",
            text: "Actually, remember to use shadcn DropdownMenu for action menus next time",
            index: 0,
            createdAt: 1,
          },
        ],
        runs: [
          {
            id: "run-1",
            status: "failed",
            abortReason: null,
            events: [{ type: "tool", error: "timed out" }],
          },
        ],
        feedback: [],
        evals: [],
        satisfaction: [],
        checkpoints: [],
      };
    });

    const result = await listDreamCandidates({ limit: 5 });

    expect(result.candidateCount).toBe(1);
    expect(result.errors).toEqual([
      { threadId: "thread-2", message: "debug unavailable" },
    ]);
    const candidate = result.candidates[0]!;
    expect(candidate.evidenceCounts.rememberRequests).toBe(1);
    expect(candidate.evidenceCounts.explicitCorrections).toBe(1);
    expect(candidate.evidenceCounts.failedRuns).toBe(1);
    expect(candidate.evidenceCounts.toolErrors).toBe(1);
    expect(candidate.reasons.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "remember-request",
        "explicit-correction",
        "failed-run",
        "tool-error",
      ]),
    );
  });
});

describe("buildProposalInputs", () => {
  it("skips personal memory proposals whose source evidence is already captured", () => {
    const result = buildProposalInputs(
      [candidateWithEvidence([explicitEvidence()])],
      {
        personalIndex: "# Memory Index\n",
        personalNotes: [
          {
            path: "memory/ui.md",
            content:
              "Use shadcn DropdownMenu for action menus.\n\nSource thread: thread-1",
          },
        ],
        sharedLearnings: "",
      },
    );

    expect(result.proposals).toEqual([]);
    expect(result.guardrailNotes.join("\n")).toContain("Skipped duplicate");
  });

  it("uses the personal memory index as part of duplicate detection", () => {
    const result = buildProposalInputs(
      [candidateWithEvidence([explicitEvidence()])],
      {
        personalIndex:
          "# Memory Index\n\n- [ui](ui.md) — Source thread: thread-1\n",
        personalNotes: [],
        sharedLearnings: "",
      },
    );

    expect(result.proposals).toEqual([]);
    expect(result.guardrailNotes.join("\n")).toContain("Skipped duplicate");
  });

  it("retargets likely stale personal memories instead of creating parallel notes", () => {
    const result = buildProposalInputs(
      [candidateWithEvidence([explicitEvidence()])],
      {
        personalIndex: "# Memory Index\n",
        personalNotes: [
          {
            path: "memory/ui-patterns.md",
            content: "Use shadcn DropdownMenu for action menus.",
          },
        ],
        sharedLearnings: "",
      },
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      targetType: "personal-memory",
      targetPath: "memory/ui-patterns.md",
      title: "Update existing memory from recent corrections",
    });
    expect(result.guardrailNotes.join("\n")).toContain("Retargeted proposal");
  });

  it("skips shared learning proposals already captured in LEARNINGS.md", () => {
    const failureEvidence: DreamEvidence[] = [
      {
        kind: "failed-run",
        label: "Run failed or aborted",
        snippet: "tool timed out while syncing workspace resources",
        threadId: "thread-a",
        threadTitle: "Sync A",
      },
      {
        kind: "tool-error",
        label: "Tool call reported an error",
        snippet: "tool timed out while syncing workspace resources",
        threadId: "thread-b",
        threadTitle: "Sync B",
      },
    ];

    const result = buildProposalInputs(
      [
        candidateWithEvidence([failureEvidence[0]!]),
        candidateWithEvidence([failureEvidence[1]!]),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings:
          "# Learnings\n\n## Patterns\n\nSource threads: thread-a, thread-b\n",
      },
    );

    expect(result.proposals).toEqual([]);
    expect(result.guardrailNotes.join("\n")).toContain("Skipped duplicate");
  });
});

describe("applyDreamProposal", () => {
  it("writes personal memory and updates the memory index before auditing", async () => {
    mocks.getDb.mockReturnValue(createDbMock(pendingProposal()));
    mocks.resourceGetByPath.mockImplementation(async (_owner, path) => {
      if (path === "memory/MEMORY.md") {
        return resource("memory/MEMORY.md", "# Memory Index\n");
      }
      return null;
    });

    const result = await applyDreamProposal("proposal-1");

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "owner@example.test",
      "memory/custom.md",
      expect.stringContaining("## Provenance"),
      "text/markdown",
      expect.objectContaining({
        createdBy: "agent",
        metadata: { dreamId: "dream-1", proposalId: "proposal-1" },
      }),
    );
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "owner@example.test",
      "memory/MEMORY.md",
      expect.stringContaining("[custom](custom.md)"),
      "text/markdown",
      expect.any(Object),
    );
    expect(result.proposal.status).toBe("applied");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dream.proposal.applied",
        targetId: "proposal-1",
      }),
    );
  });

  it("rejects personal memory proposals owned by another user", async () => {
    mocks.getDb.mockReturnValue(
      createDbMock(pendingProposal({ ownerEmail: "other@example.test" })),
    );

    await expect(applyDreamProposal("proposal-1")).rejects.toThrow(
      "Personal memory proposals can only be applied by owner",
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });
});

describe("ensureDreamJob", () => {
  it("materializes the recurring dream job with schedule metadata", async () => {
    const result = await ensureDreamJob({
      schedule: "0 10 * * 2",
      sourceId: "current",
      query: "memory",
      limit: 12,
    });

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "owner@example.test",
      "jobs/dispatch-dream.md",
      expect.stringContaining('schedule: "0 10 * * 2"'),
      "text/markdown",
      expect.objectContaining({
        createdBy: "agent",
        metadata: { sourceId: "current", query: "memory", limit: 12 },
      }),
    );
    expect(result).toMatchObject({
      path: "jobs/dispatch-dream.md",
      schedule: "0 10 * * 2",
      runAs: "creator",
    });
  });

  it("rejects invalid cron before writing the job resource", async () => {
    await expect(ensureDreamJob({ schedule: "weekly please" })).rejects.toThrow(
      "Invalid cron expression",
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });
});
