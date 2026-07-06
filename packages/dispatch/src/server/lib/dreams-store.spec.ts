import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  currentOwnerEmail: vi.fn(() => "owner@example.test"),
  currentOrgId: vi.fn(() => null),
  getApprovalPolicy: vi.fn(),
  createApprovalRequest: vi.fn(),
  recordAudit: vi.fn(),
  searchAgentThreads: vi.fn(),
  getAgentThreadDebug: vi.fn(),
  listThreadDebugSources: vi.fn(),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourcePut: vi.fn(),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
  putUserSetting: vi.fn(),
  createWorkspaceResource: vi.fn(),
  listWorkspaceResources: vi.fn(),
  updateWorkspaceResource: vi.fn(),
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
  getApprovalPolicy: mocks.getApprovalPolicy,
  createApprovalRequest: mocks.createApprovalRequest,
  recordAudit: mocks.recordAudit,
}));

vi.mock("./thread-debug-store.js", () => ({
  searchAgentThreads: mocks.searchAgentThreads,
  getAgentThreadDebug: mocks.getAgentThreadDebug,
  listThreadDebugSources: mocks.listThreadDebugSources,
}));

vi.mock("@agent-native/core/resources/store", () => ({
  SHARED_OWNER: "__shared__",
  resourceGetByPath: mocks.resourceGetByPath,
  resourceList: mocks.resourceList,
  resourcePut: mocks.resourcePut,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
  putOrgSetting: mocks.putOrgSetting,
  putUserSetting: mocks.putUserSetting,
}));

vi.mock("./workspace-resources-store.js", () => ({
  createWorkspaceResource: mocks.createWorkspaceResource,
  listWorkspaceResources: mocks.listWorkspaceResources,
  updateWorkspaceResource: mocks.updateWorkspaceResource,
}));

import { schema } from "../../db/index.js";
import {
  applyApprovedDreamProposal,
  applyDreamProposal,
  buildProposalInputs,
  ensureDreamJob,
  getDreamSettings,
  listDreamCandidates,
  previewDreamProposal,
  setDreamSettings,
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

function candidateWithEvidence(
  evidence: DreamEvidence[],
  sourceId = "current",
): DreamCandidate {
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
    sourceId,
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
  mocks.getApprovalPolicy.mockResolvedValue({
    enabled: false,
    approverEmails: [],
  });
  mocks.createApprovalRequest.mockResolvedValue({
    id: "approval-1",
    status: "pending",
  });
  mocks.listThreadDebugSources.mockResolvedValue({
    access: {
      viewerEmail: "owner@example.test",
      orgId: null,
      role: null,
      envAdmin: true,
      canInspectAll: true,
      memberCount: 1,
    },
    sources: [
      {
        id: "current",
        label: "Current Dispatch DB",
        kind: "current",
        current: true,
        connected: true,
        databaseUrlEnv: "DATABASE_URL",
        databaseAuthTokenEnv: null,
        canInspectAll: true,
      },
    ],
  });
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
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.putOrgSetting.mockResolvedValue(undefined);
  mocks.putUserSetting.mockResolvedValue(undefined);
  mocks.listWorkspaceResources.mockResolvedValue([]);
  mocks.createWorkspaceResource.mockImplementation(async (input) => ({
    id: `workspace-${input.path}`,
    ownerEmail: "owner@example.test",
    orgId: null,
    createdBy: "owner@example.test",
    createdAt: 1,
    updatedAt: 2,
    ...input,
  }));
  mocks.updateWorkspaceResource.mockImplementation(
    async (resourceId, input) => ({
      id: resourceId,
      ownerEmail: "owner@example.test",
      orgId: null,
      kind: "instruction",
      path: "instructions/existing.md",
      scope: "all",
      createdBy: "owner@example.test",
      createdAt: 1,
      updatedAt: 2,
      ...input,
    }),
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
      expect.objectContaining({
        threadId: "thread-2",
        sourceId: "current",
        message: "debug unavailable",
        timedOut: false,
      }),
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

  it("keeps all-source scans partial when one source times out", async () => {
    mocks.listThreadDebugSources.mockResolvedValue({
      access: {
        viewerEmail: "owner@example.test",
        orgId: null,
        role: null,
        envAdmin: true,
        canInspectAll: true,
        memberCount: 1,
      },
      sources: [
        {
          id: "voice",
          label: "Voice",
          kind: "env",
          current: false,
          connected: true,
          databaseUrlEnv: "VOICE_DATABASE_URL",
          databaseAuthTokenEnv: null,
          canInspectAll: true,
        },
        {
          id: "mail",
          label: "Mail",
          kind: "env",
          current: false,
          connected: true,
          databaseUrlEnv: "MAIL_DATABASE_URL",
          databaseAuthTokenEnv: null,
          canInspectAll: true,
        },
      ],
    });
    mocks.searchAgentThreads.mockImplementation(async ({ sourceId }) => {
      if (sourceId === "mail") {
        await new Promise(() => undefined);
      }
      return {
        source: {
          id: sourceId,
          label: sourceId === "voice" ? "Voice" : "Mail",
        },
        access: { mode: "local" },
        query: null,
        threads: [{ id: "voice-thread-1" }],
      };
    });
    mocks.getAgentThreadDebug.mockResolvedValue({
      thread: {
        id: "voice-thread-1",
        ownerEmail: "owner@example.test",
        title: "Remember correction",
        preview: "remember",
        messageCount: 1,
        createdAt: 1,
        updatedAt: 2,
      },
      messages: [
        {
          role: "user",
          text: "Remember to keep dream source scans partial.",
          index: 0,
          createdAt: 1,
        },
      ],
      runs: [],
      feedback: [],
      evals: [],
      satisfaction: [],
      checkpoints: [],
    });

    const result = await listDreamCandidates({
      sourceId: "all",
      allSources: true,
      limit: 5,
      sourceTimeoutMs: 5,
      sourceStartStaggerMs: 0,
    });

    expect(result.source).toMatchObject({ id: "all" });
    expect(result.candidateCount).toBe(1);
    expect(result.inspectedThreadCount).toBe(1);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "voice",
          status: "ok",
          timeoutMs: 5,
          threadErrorCount: 0,
          inspectedThreadCount: 1,
          candidateCount: 1,
        }),
        expect.objectContaining({
          sourceId: "mail",
          status: "timed_out",
          timeoutMs: 5,
          inspectedThreadCount: 0,
          candidateCount: 0,
        }),
      ]),
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "mail",
          message: "Timed out after 5ms",
        }),
      ]),
    );
  });

  it("keeps source scans partial when one thread debug read times out", async () => {
    mocks.searchAgentThreads.mockResolvedValue({
      source: { id: "current", label: "Current Dispatch DB" },
      access: { mode: "local" },
      query: null,
      threads: [{ id: "thread-ok" }, { id: "thread-hangs" }],
    });
    mocks.getAgentThreadDebug.mockImplementation(async ({ threadId }) => {
      if (threadId === "thread-hangs") {
        await new Promise(() => undefined);
      }
      return {
        thread: {
          id: "thread-ok",
          ownerEmail: "owner@example.test",
          title: "Remember correction",
          preview: "remember",
          messageCount: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        messages: [
          {
            role: "user",
            text: "Remember that source scans should keep partial thread results.",
            index: 0,
            createdAt: 1,
          },
        ],
        runs: [],
        feedback: [],
        evals: [],
        satisfaction: [],
        checkpoints: [],
      };
    });

    const result = await listDreamCandidates({
      limit: 5,
      sourceTimeoutMs: 50,
      threadTimeoutMs: 5,
    });

    expect(result.candidateCount).toBe(1);
    expect(result.inspectedThreadCount).toBe(2);
    expect(result.errors).toEqual([
      expect.objectContaining({
        threadId: "thread-hangs",
        sourceId: "current",
        timedOut: true,
        message: "Timed out after 5ms",
      }),
    ]);
    expect(result.sources[0]).toEqual(
      expect.objectContaining({
        sourceId: "current",
        status: "ok",
        inspectedThreadCount: 2,
        candidateCount: 1,
        threadErrorCount: 1,
      }),
    );
  });

  it("does not treat feature wording or successful eval metadata as dream failures", async () => {
    mocks.searchAgentThreads.mockResolvedValue({
      source: { id: "current" },
      access: { mode: "local" },
      query: null,
      threads: [{ id: "thread-1" }],
    });
    mocks.getAgentThreadDebug.mockResolvedValue({
      thread: {
        id: "thread-1",
        ownerEmail: "owner@example.test",
        title: "Create an extension",
        preview: "image instead of camera",
        messageCount: 1,
        createdAt: 1,
        updatedAt: 2,
      },
      messages: [
        {
          role: "user",
          text: "Create an extension to add image instead of camera when recording",
          index: 0,
          createdAt: 1,
        },
      ],
      runs: [
        {
          id: "run-1",
          status: "completed",
          abortReason: null,
          events: [
            {
              event: {
                type: "tool_done",
                tool: "db-query",
                result:
                  "query: select status, failure_reason from transcripts\nrows: 1\nstatus | failure_reason\nfailed | no native transcript",
              },
            },
          ],
        },
      ],
      feedback: [],
      evals: [
        {
          eval_type: "automated",
          criteria: "tool_success_rate",
          score: 1,
          metadata: JSON.stringify({ failedTools: 0, successfulTools: 1 }),
        },
      ],
      satisfaction: [],
      checkpoints: [],
    });

    const result = await listDreamCandidates({ limit: 5 });

    expect(result.candidateCount).toBe(0);
  });

  it("ignores injected context when detecting user corrections", async () => {
    mocks.searchAgentThreads.mockResolvedValue({
      source: { id: "clips" },
      access: { mode: "local" },
      query: null,
      threads: [{ id: "thread-context" }],
    });
    mocks.getAgentThreadDebug.mockResolvedValue({
      thread: {
        id: "thread-context",
        ownerEmail: "owner@example.test",
        title: "einstein shaking head",
        preview: "composition request",
        messageCount: 1,
        createdAt: 1,
        updatedAt: 2,
      },
      messages: [
        {
          role: "user",
          text: "einstein shaking head\n\n<context>\nUse the Clips app flow. Do not route this as source-code generation.</context>",
          index: 0,
          createdAt: 1,
        },
      ],
      runs: [],
      feedback: [],
      evals: [],
      satisfaction: [],
      checkpoints: [],
    });

    const result = await listDreamCandidates({
      sourceId: "clips",
      limit: 5,
    });

    expect(result.candidateCount).toBe(0);
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

  it("routes personal-memory proposals to shared learnings when the owner scope is not personal", () => {
    const result = buildProposalInputs(
      [
        candidateWithEvidence([explicitEvidence({ threadId: "thread-1" })]),
        candidateWithEvidence(
          [
            explicitEvidence({
              threadId: "thread-2",
              snippet: "Remember to keep dream proposals reviewable",
            }),
          ],
          "mail",
        ),
      ],
      {
        personalIndex: "# Memory Index\n",
        personalNotes: [],
        sharedLearnings: "",
      },
      {
        personalMemoryAllowed: false,
        personalMemoryBlockReason:
          "source evidence includes a thread owned by another user",
      },
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      targetType: "shared-learnings",
      targetPath: "LEARNINGS.md",
      risk: "medium",
    });
    expect(result.proposals[0]?.content).toContain(
      "Provenance: Personal memory was disabled",
    );
    expect(result.guardrailNotes.join("\n")).toContain(
      "Routed personal-memory dream proposals to shared learnings",
    );
  });

  it("proposes workspace instructions from repeated corrections", () => {
    const result = buildProposalInputs(
      [
        candidateWithEvidence([
          explicitEvidence({
            threadId: "thread-1",
            snippet: "Actually use actions first",
          }),
        ]),
        candidateWithEvidence([
          explicitEvidence({
            threadId: "thread-2",
            snippet:
              "Remember to use workspace resources for shared instructions",
          }),
          explicitEvidence({
            threadId: "thread-2",
            snippet: "From now on, keep dream proposals reviewable",
          }),
        ]),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
    );

    expect(result.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "workspace-instruction",
          targetPath: expect.stringMatching(
            /^instructions\/dream-corrections-/,
          ),
          risk: "medium",
        }),
      ]),
    );
  });

  it("deduplicates repeated evidence and keeps single-app UI wording out of global instructions", () => {
    const repeatedCorrection = explicitEvidence({
      threadId: "thread-clips",
      threadTitle: "Clips export copy",
      snippet: "Actually the Clips UI button label should say Export",
      sourceId: "clips",
    });
    const result = buildProposalInputs(
      [
        candidateWithEvidence(
          [
            repeatedCorrection,
            {
              ...repeatedCorrection,
              messageIndex: 1,
            },
          ],
          "clips",
        ),
        candidateWithEvidence(
          [
            explicitEvidence({
              threadId: "thread-clips-2",
              threadTitle: "Clips export wording",
              snippet:
                "Remember the Clips button wording should use Export in this screen",
              sourceId: "clips",
            }),
          ],
          "clips",
        ),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
      {
        personalMemoryAllowed: false,
        personalMemoryBlockReason: "admin scan spans shared production data",
      },
    );

    const shared = result.proposals.find(
      (proposal) => proposal.targetType === "shared-learnings",
    );

    expect(shared?.evidence).toHaveLength(2);
    expect(
      shared?.content.match(/Actually the Clips UI button label/g),
    ).toHaveLength(1);
    expect(
      result.proposals.some(
        (proposal) => proposal.targetType === "workspace-instruction",
      ),
    ).toBe(false);
  });

  it("summarizes raw eval failure rows before writing proposal content", () => {
    const result = buildProposalInputs(
      [
        candidateWithEvidence(
          [
            {
              kind: "failed-run",
              label: "Run failed or aborted",
              snippet: "failed: Notion import exceeded retry budget",
              threadId: "thread-a",
              threadTitle: "Slow dream run A",
              runId: "run-a",
            },
            {
              kind: "eval-failure",
              label: "Evaluation failed or scored low",
              snippet: {
                name: "latency_score",
                score: 0,
                passed: false,
                run_id: "run-a",
                metadata: JSON.stringify({
                  actualMs: 61_250,
                  expectedMs: 30_000,
                }),
              } as any,
              threadId: "thread-a",
              threadTitle: "Slow dream run A",
              runId: "run-a",
            },
          ],
          "dispatch-prod",
        ),
        candidateWithEvidence(
          [
            {
              kind: "failed-run",
              label: "Run failed or aborted",
              snippet: "failed: Notion import exceeded retry budget",
              threadId: "thread-b",
              threadTitle: "Slow dream run B",
              runId: "run-b",
            },
            {
              kind: "eval-failure",
              label: "Evaluation failed or scored low",
              snippet: {
                name: "latency_score",
                score: 0.2,
                passed: false,
                run_id: "run-b",
                metadata: JSON.stringify({
                  actualMs: 44_000,
                  expectedMs: 30_000,
                }),
              } as any,
              threadId: "thread-b",
              threadTitle: "Slow dream run B",
              runId: "run-b",
            },
          ],
          "analytics-prod",
        ),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
    );

    const content = result.proposals
      .map((proposal) => proposal.content)
      .join("\n");

    expect(content).toContain("latency score failed");
    expect(content).toContain("actual 61250ms, expected 30000ms");
    expect(content).not.toContain('"metadata"');
    expect(content).not.toContain('"run_id"');
    expect(content).not.toContain("{");
  });

  it("does not create durable proposals from eval-only or account setup failures", () => {
    const result = buildProposalInputs(
      [
        candidateWithEvidence(
          [
            {
              kind: "eval-failure",
              label: "Evaluation failed or scored low",
              snippet: {
                name: "cost_efficiency",
                score: 0,
                passed: false,
                metadata: JSON.stringify({
                  actualCx100: 4160,
                  expectedCx100: 300,
                }),
              } as any,
              threadId: "thread-a",
              threadTitle: "Costly run",
            },
            {
              kind: "tool-error",
              label: "Tool call reported an error",
              snippet:
                "Tool error (credits-limit-daily): You've reached the daily AI credits limit for your current plan.",
              threadId: "thread-a",
              threadTitle: "Costly run",
            },
          ],
          "mail",
        ),
        candidateWithEvidence(
          [
            {
              kind: "eval-failure",
              label: "Evaluation failed or scored low",
              snippet: {
                name: "latency_score",
                score: 0,
                passed: false,
                metadata: JSON.stringify({
                  actual_ms: 61_250,
                  expected_ms: 30_000,
                }),
              } as any,
              threadId: "thread-b",
              threadTitle: "Slow run",
            },
            {
              kind: "tool-error",
              label: "Tool call reported an error",
              snippet:
                "Tool error (missing_credentials): No LLM provider is connected.",
              threadId: "thread-b",
              threadTitle: "Slow run",
            },
          ],
          "content",
        ),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
    );

    expect(result.proposals).toEqual([]);
    expect(result.guardrailNotes.join("\n")).toContain(
      "Skipped failure proposals because the signals were eval-only noise",
    );
  });

  it("explains why admin-visible one-off corrections produce no proposal", () => {
    const result = buildProposalInputs(
      [
        candidateWithEvidence(
          [
            explicitEvidence({
              threadId: "thread-forms",
              threadTitle: "Recording answer",
              snippet:
                "Actually this Forms screen should say record instead of upload",
              sourceId: "forms",
            }),
          ],
          "forms",
        ),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
      {
        personalMemoryAllowed: false,
        personalMemoryBlockReason:
          "source evidence includes a thread owned by another user",
      },
    );

    expect(result.proposals).toEqual([]);
    const notes = result.guardrailNotes.join("\n");
    expect(notes).toContain(
      "Skipped explicit user-correction proposals because personal memory is blocked",
    );
    expect(notes).toContain(
      "Skipped workspace-instruction promotion for explicit corrections",
    );
  });

  it("requires workspace instruction evidence to span threads or source apps", () => {
    const sameThreadFailures: DreamEvidence[] = [
      {
        kind: "failed-run",
        label: "Run failed or aborted",
        snippet: "failed: resource sync wrote an invalid workspace resource",
        threadId: "thread-a",
        threadTitle: "Production timeout",
        sourceId: "dispatch-prod",
      },
      {
        kind: "tool-error",
        label: "Tool call reported an error",
        snippet:
          "Tool error (schema-mismatch): resource grant failed validation",
        threadId: "thread-a",
        threadTitle: "Production timeout",
        sourceId: "dispatch-prod",
      },
      {
        kind: "eval-failure",
        label: "Evaluation failed or scored low",
        snippet: "latency score failed; score 0",
        threadId: "thread-a",
        threadTitle: "Production timeout",
        sourceId: "dispatch-prod",
      },
      {
        kind: "frustration",
        label: "User expressed friction or repeated failure",
        snippet: "This keeps failing again",
        threadId: "thread-a",
        threadTitle: "Production timeout",
        sourceId: "dispatch-prod",
      },
      {
        kind: "negative-feedback",
        label: "Negative feedback was recorded",
        snippet: "User said the workspace sync fix did not work",
        threadId: "thread-a",
        threadTitle: "Production timeout",
        sourceId: "dispatch-prod",
      },
    ];

    const singleSource = buildProposalInputs(
      [candidateWithEvidence(sameThreadFailures, "dispatch-prod")],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
    );

    expect(
      singleSource.proposals.some(
        (proposal) => proposal.targetType === "workspace-instruction",
      ),
    ).toBe(false);

    const crossSource = buildProposalInputs(
      [
        candidateWithEvidence(sameThreadFailures.slice(0, 2), "dispatch-prod"),
        candidateWithEvidence(
          sameThreadFailures.slice(2).map((entry) => ({
            ...entry,
            sourceId: "analytics-prod",
          })),
          "analytics-prod",
        ),
      ],
      {
        personalIndex: "",
        personalNotes: [],
        sharedLearnings: "",
      },
    );

    expect(crossSource.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "workspace-instruction",
          targetPath: expect.stringMatching(
            /^instructions\/dream-run-reliability-/,
          ),
        }),
      ]),
    );
  });
});

describe("applyDreamProposal", () => {
  it("previews workspace proposal target content and approval behavior", async () => {
    mocks.getApprovalPolicy.mockResolvedValue({
      enabled: true,
      approverEmails: ["admin@example.test"],
    });
    mocks.getDb.mockReturnValue(
      createDbMock(
        pendingProposal({
          targetType: "workspace-instruction",
          targetPath: "instructions/dream-corrections.md",
          title: "Create workspace instruction from repeated corrections",
          summary:
            "Repeated corrections should become a workspace instruction.",
          content: "# Proposed instruction\n\nUse reviewed guidance.",
        }),
      ),
    );
    mocks.listWorkspaceResources.mockResolvedValue([
      {
        id: "workspace-existing",
        ownerEmail: "owner@example.test",
        orgId: null,
        kind: "instruction",
        name: "Existing instruction",
        description: "Existing",
        path: "instructions/dream-corrections.md",
        content: "# Existing instruction\n",
        scope: "all",
        createdBy: "owner@example.test",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    const preview = await previewDreamProposal("proposal-1");

    expect(preview).toMatchObject({
      operation: "update",
      targetExists: true,
      currentContent: "# Existing instruction\n",
      proposedContent: expect.stringContaining("Proposed instruction"),
      target: {
        kind: "instruction",
        resourceId: "workspace-existing",
        path: "instructions/dream-corrections.md",
      },
      approval: {
        required: true,
        policyEnabled: true,
        willRequestApproval: true,
      },
    });
  });

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

  it("queues shared proposals for approval when approval policy is enabled", async () => {
    mocks.getApprovalPolicy.mockResolvedValue({
      enabled: true,
      approverEmails: ["admin@example.test"],
    });
    mocks.getDb.mockReturnValue(
      createDbMock(
        pendingProposal({
          targetType: "shared-learnings",
          targetPath: "LEARNINGS.md",
        }),
      ),
    );

    const result = await applyDreamProposal("proposal-1");

    expect(mocks.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "dream-proposal.apply",
        targetType: "dream-proposal",
        targetId: "proposal-1",
        payload: { proposalId: "proposal-1" },
      }),
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(result.proposal.status).toBe("approval_requested");
    expect(result.result).toEqual({
      approvalRequired: true,
      approvalId: "approval-1",
    });
  });

  it("applies approved shared proposals to LEARNINGS.md", async () => {
    mocks.getDb.mockReturnValue(
      createDbMock(
        pendingProposal({
          status: "approval_requested",
          targetType: "shared-learnings",
          targetPath: "LEARNINGS.md",
          summary: "Record a repeated Dispatch failure pattern.",
        }),
      ),
    );
    mocks.resourceGetByPath.mockResolvedValue(
      resource("LEARNINGS.md", "# Learnings\n\n## Patterns\n", "__shared__"),
    );

    const result = await applyApprovedDreamProposal(
      "proposal-1",
      "admin@example.test",
      { ownerEmail: "owner@example.test", orgId: null },
    );

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "__shared__",
      "LEARNINGS.md",
      expect.stringContaining("Record a repeated Dispatch failure pattern."),
      "text/markdown",
      expect.objectContaining({
        createdBy: "agent",
        metadata: { dreamId: "dream-1", proposalId: "proposal-1" },
      }),
    );
    expect(result.proposal.status).toBe("applied");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dream.proposal.applied",
        actor: "admin@example.test",
      }),
    );
  });

  it("creates all-scope workspace resources for approved workspace proposals", async () => {
    mocks.getDb.mockReturnValue(
      createDbMock(
        pendingProposal({
          status: "approval_requested",
          targetType: "workspace-instruction",
          targetPath: "instructions/dream-corrections.md",
          title: "Create workspace instruction from repeated corrections",
          summary:
            "Repeated corrections should become a workspace instruction.",
          content: "# Dream instruction\n\nUse reviewed workspace guidance.",
        }),
      ),
    );

    const result = await applyApprovedDreamProposal(
      "proposal-1",
      "admin@example.test",
      { ownerEmail: "owner@example.test", orgId: null },
    );

    expect(mocks.createWorkspaceResource).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "instruction",
        path: "instructions/dream-corrections.md",
        scope: "all",
        content: expect.stringContaining("Dream instruction"),
      }),
    );
    expect(result.proposal.status).toBe("applied");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dream.proposal.applied",
        actor: "admin@example.test",
      }),
    );
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
        metadata: expect.objectContaining({
          sourceId: "current",
          query: "memory",
          limit: 12,
          sourceTimeoutMs: 30000,
        }),
      }),
    );
    expect(result).toMatchObject({
      path: "jobs/dispatch-dream.md",
      schedule: "0 10 * * 2",
      runAs: "creator",
      sourceId: "current",
      query: "memory",
      limit: 12,
    });
  });

  it("rejects invalid cron before writing the job resource", async () => {
    await expect(ensureDreamJob({ schedule: "weekly please" })).rejects.toThrow(
      "Invalid cron expression",
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("persists recurring dream settings", async () => {
    mocks.getUserSetting.mockResolvedValueOnce(null).mockResolvedValueOnce({
      enabled: true,
      schedule: "0 8 * * 1",
      sourceId: "all",
      allSources: true,
      limit: 9,
      sourceTimeoutMs: 45000,
      minCandidateCount: 3,
    });

    const result = await setDreamSettings({
      enabled: true,
      schedule: "0 8 * * 1",
      sourceId: "all",
      allSources: true,
      limit: 9,
      sourceTimeoutMs: 45000,
      minCandidateCount: 3,
    });

    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "dispatch-dream-settings",
      expect.objectContaining({
        enabled: true,
        schedule: "0 8 * * 1",
        sourceId: "all",
        allSources: true,
        limit: 9,
        sourceTimeoutMs: 45000,
        minCandidateCount: 3,
      }),
    );
    expect(result).toMatchObject({
      enabled: true,
      schedule: "0 8 * * 1",
      sourceId: "all",
      allSources: true,
      limit: 9,
      sourceTimeoutMs: 45000,
      minCandidateCount: 3,
    });
  });

  it("reads persisted recurring dream settings", async () => {
    mocks.getUserSetting.mockResolvedValue({
      enabled: true,
      schedule: "0 8 * * 1",
      sourceId: "voice",
      allSources: false,
      limit: 7,
      sourceTimeoutMs: 20000,
      minCandidateCount: 2,
    });

    await expect(getDreamSettings()).resolves.toMatchObject({
      enabled: true,
      schedule: "0 8 * * 1",
      sourceId: "voice",
      allSources: false,
      limit: 7,
      sourceTimeoutMs: 20000,
      minCandidateCount: 2,
    });
  });
});
