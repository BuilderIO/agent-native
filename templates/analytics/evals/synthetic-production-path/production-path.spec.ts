import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentEngine,
  EngineEvent,
  EngineStreamOptions,
} from "@agent-native/core/agent/engine";
import {
  createAgentRunner,
  runEvals,
  type AgentRunOutput,
  type Eval,
  type EvalProductionPathReceipt,
  type EvalProductionIdentity,
  type Scorer,
} from "@agent-native/core/eval";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const syntheticData = vi.hoisted(() => {
  const generatedAt = "2026-10-12T00:00:00.000Z";
  const sourceRevision = "000d5e351b5be91166610a4acf1b10fea565fcff";
  return {
    ownerEmail: "synthetic-eval@example.invalid",
    orgId: "org_synthetic_eval",
    dictionaryEntries: {
      "data-dict-fixture-approved-monthly-count": {
        id: "fixture-approved-monthly-count",
        metric: "Monthly Organization User Count",
        definition:
          "Daily-built per date month and organization. Completed months use the last calendar day; the current month is partial through today. The main user count excludes members with @builder.io addresses; the internal-user count records them and is not a staff roster. Organization ID may identify a child workspace.",
        source: "dbt",
        sourceKind: "dbt",
        entryType: "model",
        table: "dbt_mart.aggregate_monthly_users_per_org",
        columnsUsed: "date_month, org_id, user_count, internal_user_count",
        grain: "One row per date_month per org_id",
        semanticScope: "membership",
        approved: true,
      },
    },
    sourceIndexBundle: {
      schemaVersion: 1,
      generatedAt,
      sources: [{ id: "dbt", revision: sourceRevision }],
      entries: [
        {
          id: "fixture-workspace-user-role-bridge",
          metric: "Organization User Roles",
          definition:
            "One row per users.organizations array element, including the organization role.",
          source: "dbt",
          sourceKind: "dbt",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per users.organizations array element",
          primaryEntity: "user-organization membership",
          table: "dbt_intermediate.user_organization_role",
          columnsUsed: "user_id, organization_id, organization_role",
          sourcePath: "models/intermediate/user_organization_role.sql",
          sourceRevision,
        },
      ],
      scanSummary: {
        unsafeEntriesOmitted: 0,
        unsafeFieldsOmitted: 0,
        truncatedFields: 0,
        unresolvedTrackingCallSites: 0,
      },
    },
  };
});

const storage = vi.hoisted(() => ({
  getOrgSetting: vi.fn(async (orgId: string, key: string) => {
    if (orgId !== "org_synthetic_eval") {
      throw new Error("Synthetic fixture received an unexpected org scope.");
    }
    return key === "analytics-source-index"
      ? syntheticData.sourceIndexBundle
      : null;
  }),
  listOrgSettings: vi.fn(async (orgId: string, prefix: string) => {
    if (orgId !== "org_synthetic_eval") {
      throw new Error("Synthetic fixture received an unexpected org scope.");
    }
    return prefix === "data-dict-" ? syntheticData.dictionaryEntries : {};
  }),
  listSettingsByPrefix: vi.fn(async (prefix: string) => {
    if (prefix !== "u:synthetic-eval@example.invalid:data-dict-") {
      throw new Error("Synthetic fixture received an unexpected user scope.");
    }
    return [];
  }),
  getUserSetting: vi.fn(async (email: string) => {
    if (email !== "synthetic-eval@example.invalid") {
      throw new Error("Synthetic fixture received an unexpected user scope.");
    }
    return null;
  }),
  listDashboardSummaries: vi.fn(async () => []),
  loadDashboardCatalogDashboards: vi.fn(async () => []),
  searchDashboardReferencesPage: vi.fn(async () => ({
    results: [],
    searched: 0,
    of: 0,
    truncated: false,
    nextPage: null,
  })),
  availableEmbeddingFamilies: vi.fn(async () => []),
}));

vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: storage.getOrgSetting,
  getUserSetting: storage.getUserSetting,
  listOrgSettings: storage.listOrgSettings,
  listSettingsByPrefix: storage.listSettingsByPrefix,
}));

vi.mock("../../server/lib/dashboards-store.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/lib/dashboards-store.js")
  >()),
  listDashboardSummaries: storage.listDashboardSummaries,
  loadDashboardCatalogDashboards: storage.loadDashboardCatalogDashboards,
  searchDashboardReferencesPage: storage.searchDashboardReferencesPage,
}));

vi.mock("@agent-native/core/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/embeddings")>()),
  availableEmbeddingFamilies: storage.availableEmbeddingFamilies,
  defaultEmbeddingFamily: () => null,
}));

const FIXTURE_REVISION =
  "dbt-schema-000d5e351b5be91166610a4acf1b10fea565fcff-fixture-v1";
const ACTION_ALLOWLIST = ["find-data"] as const;
const ANALYTICS_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const IDENTITY: EvalProductionIdentity = {
  ownerEmail: syntheticData.ownerEmail,
  orgId: syntheticData.orgId,
};

type SyntheticCase = {
  id: string;
  prompt: string;
  expectedTable: string;
};

const SYNTHETIC_CASES: readonly SyntheticCase[] = [
  {
    id: "role-aware-membership-source",
    prompt:
      "Find the catalog reference for the current workspace user roster with roles. Metadata only; do not report live counts or values.",
    expectedTable: "dbt_intermediate.user_organization_role",
  },
  {
    id: "monthly-membership-count-source",
    prompt:
      "Find the catalog reference for a monthly workspace user count. Metadata only; do not report live counts or values.",
    expectedTable: "dbt_mart.aggregate_monthly_users_per_org",
  },
];

type SafeReasonCode =
  | "rank_1"
  | "ranked_below_1"
  | "candidate_missing"
  | "production_path_failed"
  | "find_data_missing"
  | "unexpected_action"
  | "action_failed"
  | "usage_missing"
  | "guard_not_applied";

export type PrivacySafeEvalRow = {
  case_id: string;
  phase: "before" | "after";
  git_revision: string;
  code_revision: string;
  fixture_revision: string;
  run: number;
  score: number;
  reason_code: SafeReasonCode;
  expected_rank: number | null;
  hit_at_5: boolean;
  find_data_calls: number;
  other_action_calls: number;
  failed_action_calls: number;
  completed: boolean;
  aborted: boolean;
  input_tokens: number;
  output_tokens: number;
  llm_calls: number;
  latency_ms: number;
};

const CSV_COLUMNS: readonly (keyof PrivacySafeEvalRow)[] = [
  "case_id",
  "phase",
  "git_revision",
  "code_revision",
  "fixture_revision",
  "run",
  "score",
  "reason_code",
  "expected_rank",
  "hit_at_5",
  "find_data_calls",
  "other_action_calls",
  "failed_action_calls",
  "completed",
  "aborted",
  "input_tokens",
  "output_tokens",
  "llm_calls",
  "latency_ms",
];

const SAFE_REASON_CODES = new Set<SafeReasonCode>([
  "rank_1",
  "ranked_below_1",
  "candidate_missing",
  "production_path_failed",
  "find_data_missing",
  "unexpected_action",
  "action_failed",
  "usage_missing",
  "guard_not_applied",
]);

const SOURCE_FILES = [
  new URL("../production-context.ts", import.meta.url),
  new URL("../../actions/find-data.ts", import.meta.url),
  new URL("../../server/lib/analytics-query-catalog.ts", import.meta.url),
  new URL("../../server/lib/analytics-term-matcher.ts", import.meta.url),
  new URL("../../server/lib/analytics-agent-context.ts", import.meta.url),
  new URL("../../server/lib/data-dictionary-context.ts", import.meta.url),
  new URL("../../server/lib/source-index-store.ts", import.meta.url),
  new URL("../../server/plugins/agent-chat.ts", import.meta.url),
  new URL(
    "../../../../packages/core/src/agent/production-agent.ts",
    import.meta.url,
  ),
  new URL(
    "../../../../packages/core/src/eval/agent-runner.ts",
    import.meta.url,
  ),
];

async function codeRevision(): Promise<string> {
  const hash = createHash("sha256");
  for (const source of SOURCE_FILES) {
    const content = await readFile(source);
    hash.update(source.pathname.split("/").at(-1) ?? "source");
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Serialize an explicit allowlist only, rejecting raw eval or action data. */
export function renderPrivacySafeEvalCsv(
  rows: readonly PrivacySafeEvalRow[],
): string {
  const header = CSV_COLUMNS.join(",");
  const output = rows.map((row) => {
    const keys = Object.keys(row).sort();
    const expectedKeys = [...CSV_COLUMNS].sort();
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new Error("Synthetic eval CSV rejected an unapproved field.");
    }
    if (
      !/^[a-z0-9_-]+$/.test(row.case_id) ||
      !["before", "after"].includes(row.phase) ||
      !/^(?:[a-f0-9]{40}|working-tree)$/.test(row.git_revision) ||
      !/^sha256:[a-f0-9]{64}$/.test(row.code_revision) ||
      row.fixture_revision !== FIXTURE_REVISION ||
      !isNonnegativeInteger(row.run) ||
      (row.score !== 0 && row.score !== 1) ||
      !SAFE_REASON_CODES.has(row.reason_code) ||
      (row.expected_rank !== null &&
        !isNonnegativeInteger(row.expected_rank)) ||
      typeof row.hit_at_5 !== "boolean" ||
      !isNonnegativeInteger(row.find_data_calls) ||
      !isNonnegativeInteger(row.other_action_calls) ||
      !isNonnegativeInteger(row.failed_action_calls) ||
      typeof row.completed !== "boolean" ||
      typeof row.aborted !== "boolean" ||
      !isNonnegativeInteger(row.input_tokens) ||
      !isNonnegativeInteger(row.output_tokens) ||
      !isNonnegativeInteger(row.llm_calls) ||
      !isNonnegativeInteger(row.latency_ms)
    ) {
      throw new Error("Synthetic eval CSV rejected an invalid metric value.");
    }
    return CSV_COLUMNS.map((column) => csvCell(row[column])).join(",");
  });
  return [header, ...output].join("\n");
}

function getToolResult(output: AgentRunOutput): Record<string, unknown> | null {
  const call = output.toolCallDetails?.find(
    (detail) => detail.name === "find-data",
  );
  if (!call || typeof call.result !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(call.result);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function expectedCandidateRank(
  output: AgentRunOutput,
  expectedTable: string,
): number | null {
  const result = getToolResult(output);
  const candidates = result?.results;
  if (!Array.isArray(candidates)) return null;
  const index = candidates.findIndex(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as { table?: unknown }).table === expectedTable,
  );
  return index < 0 ? null : index + 1;
}

function actionCounts(output: AgentRunOutput) {
  const details = output.toolCallDetails ?? [];
  return {
    findDataCalls: details.filter((call) => call.name === "find-data").length,
    otherActionCalls: details.filter((call) => call.name !== "find-data")
      .length,
    failedActionCalls: details.filter((call) => call.isError === true).length,
  };
}

function reasonForRun(
  testCase: SyntheticCase,
  output: AgentRunOutput,
  receipt: EvalProductionPathReceipt,
): SafeReasonCode {
  const counts = actionCounts(output);
  const rank = expectedCandidateRank(output, testCase.expectedTable);
  const pathIsValid =
    receipt.productionAgentLoopInvoked &&
    receipt.requestPreparationInvoked &&
    receipt.systemPromptBuilt &&
    receipt.ownerEmail === IDENTITY.ownerEmail &&
    receipt.orgId === IDENTITY.orgId &&
    receipt.availableActionNames.length === 1 &&
    receipt.availableActionNames[0] === "find-data" &&
    receipt.initialToolNames.length === 1 &&
    receipt.initialToolNames[0] === "find-data";
  if (!output.ok || !pathIsValid) return "production_path_failed";
  if (counts.findDataCalls === 0) return "find_data_missing";
  if (counts.otherActionCalls > 0) return "unexpected_action";
  if (counts.failedActionCalls > 0) return "action_failed";
  if (!output.usage?.usageReported || !receipt.usageCaptured) {
    return "usage_missing";
  }
  if (
    !receipt.finalResponseGuardInstalled ||
    !receipt.finalResponseGuardApplied
  ) {
    return "guard_not_applied";
  }
  if (rank === null) return "candidate_missing";
  return rank === 1 ? "rank_1" : "ranked_below_1";
}

type Capture = {
  output?: AgentRunOutput;
  receipt?: EvalProductionPathReceipt;
};

function evalCaseFor(testCase: SyntheticCase, capture: Capture): Eval {
  const scorer: Scorer<AgentRunOutput> = {
    name: "synthetic-retrieval-rank",
    preprocess: (output) => {
      capture.output = output;
      return output;
    },
    generateScore: (output) =>
      expectedCandidateRank(output, testCase.expectedTable) === 1 ? 1 : 0,
    generateReason: ({ run }) => {
      const rank = expectedCandidateRank(run, testCase.expectedTable);
      return rank === 1
        ? "rank_1"
        : rank === null
          ? "candidate_missing"
          : "ranked_below_1";
    },
  };
  const pathScorer: Scorer<AgentRunOutput> = {
    name: "synthetic-production-path-integrity",
    generateScore: (output) =>
      reasonForRun(testCase, output, capture.receipt!) === "rank_1" ? 1 : 0,
    generateReason: ({ run }) => reasonForRun(testCase, run, capture.receipt!),
  };
  return {
    name: `SYNTHETIC: ${testCase.id}`,
    input: { prompt: testCase.prompt },
    actionAllowlist: ACTION_ALLOWLIST,
    scorers: [scorer, pathScorer],
    threshold: 1,
  };
}

function makeSyntheticEngine(): AgentEngine {
  let callId = 0;
  return {
    name: "synthetic-fixture-engine",
    label: "Synthetic fixture engine",
    defaultModel: "synthetic-fixture-model",
    supportedModels: ["synthetic-fixture-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(options: EngineStreamOptions): AsyncIterable<EngineEvent> {
      const toolResultSeen = options.messages.some((message) =>
        message.content.some((part) => part.type === "tool-result"),
      );
      if (options.tools.some((tool) => tool.name !== "find-data")) {
        throw new Error("Synthetic engine received an unexpected action.");
      }
      if (!toolResultSeen) {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: `synthetic-find-data-${++callId}`,
              name: "find-data",
              input: {
                question: options.messages
                  .filter((message) => message.role === "user")
                  .flatMap((message) => message.content)
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .at(-1),
                limit: 8,
              },
            },
          ],
        };
        yield {
          type: "usage",
          inputTokens: 120,
          outputTokens: 24,
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [
          {
            type: "text",
            text: "I cannot report live values from metadata; this run checks catalog retrieval only.",
          },
        ],
      };
      yield {
        type: "usage",
        inputTokens: 120,
        outputTokens: 24,
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

async function runOnce(testCase: SyntheticCase) {
  const { resolveProductionEvalContext } =
    await import("../production-context.js");
  const { invalidateSourceIndexCache } =
    await import("../../server/lib/source-index-store.js");
  invalidateSourceIndexCache(IDENTITY.orgId);
  const context = resolveProductionEvalContext(IDENTITY);
  const productionChatPath = context.productionChatPath;
  if (!productionChatPath) {
    throw new Error("Synthetic Analytics production path is unavailable.");
  }
  const capture: Capture = {};
  const instrumentedContext = {
    ...context,
    productionChatPath: {
      run: async (args: Parameters<typeof productionChatPath.run>[0]) => {
        const result = await productionChatPath.run(args);
        capture.receipt = result.receipt;
        return result;
      },
    },
  };
  const runner = await createAgentRunner({
    productionContext: instrumentedContext,
    engine: makeSyntheticEngine(),
    model: "synthetic-fixture-model",
    timeoutMs: 10_000,
  });
  const report = await runEvals([evalCaseFor(testCase, capture)], runner, {
    persist: false,
  });
  if (!capture.output || !capture.receipt) {
    throw new Error("Synthetic production run did not produce its receipt.");
  }
  return { report, output: capture.output, receipt: capture.receipt };
}

async function makeRows(
  phase: "before" | "after",
  gitRevision: string,
): Promise<PrivacySafeEvalRow[]> {
  const revision = await codeRevision();
  const rows: PrivacySafeEvalRow[] = [];
  for (const testCase of SYNTHETIC_CASES) {
    for (const run of [1, 2]) {
      const { report, output, receipt } = await runOnce(testCase);
      const rank = expectedCandidateRank(output, testCase.expectedTable);
      const counts = actionCounts(output);
      const reasonCode = reasonForRun(testCase, output, receipt);
      const successful = report.results[0]?.passed === true;
      rows.push({
        case_id: testCase.id,
        phase,
        git_revision: gitRevision,
        code_revision: revision,
        fixture_revision: FIXTURE_REVISION,
        run,
        score: successful ? 1 : 0,
        reason_code: reasonCode,
        expected_rank: rank,
        hit_at_5: rank !== null && rank <= 5,
        find_data_calls: counts.findDataCalls,
        other_action_calls: counts.otherActionCalls,
        failed_action_calls: counts.failedActionCalls,
        completed: output.ok,
        aborted: !output.ok && /abort|timeout/i.test(output.error ?? ""),
        input_tokens: output.usage?.inputTokens ?? 0,
        output_tokens: output.usage?.outputTokens ?? 0,
        llm_calls: output.usage?.llmCalls ?? 0,
        latency_ms: Math.max(0, Math.round(output.durationMs)),
      });
    }
  }
  return rows;
}

describe("Analytics synthetic production-path retrieval harness", () => {
  beforeAll(() => {
    generateActionRegistryForProject(ANALYTICS_PROJECT_ROOT);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps harness cases synthetic and writes only the approved CSV schema", async () => {
    expect(SYNTHETIC_CASES.map(({ id }) => id)).toEqual([
      "role-aware-membership-source",
      "monthly-membership-count-source",
    ]);
    expect(
      SYNTHETIC_CASES.every(
        ({ prompt }) =>
          !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(prompt),
      ),
    ).toBe(true);
    expect(SYNTHETIC_CASES.map(({ prompt }) => prompt).join("\n")).not.toMatch(
      /builder\.io|brent|steve/i,
    );

    const phase =
      process.env.ANALYTICS_EVAL_PHASE === "before" ? "before" : "after";
    const gitRevision =
      process.env.ANALYTICS_EVAL_GIT_REVISION ?? "working-tree";
    const rows = await makeRows(phase, gitRevision);
    expect(rows).toHaveLength(4);
    if (phase === "after") {
      expect(
        rows.map(({ score, reason_code, expected_rank, hit_at_5 }) => ({
          score,
          reason_code,
          expected_rank,
          hit_at_5,
        })),
      ).toEqual(
        Array.from({ length: 4 }, () => ({
          score: 1,
          reason_code: "rank_1",
          expected_rank: 1,
          hit_at_5: true,
        })),
      );
    }
    const csv = renderPrivacySafeEvalCsv(rows);
    const [header, ...body] = csv.split("\n");
    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(body).toHaveLength(4);
    expect(body.join("\n")).not.toMatch(
      /synthetic-eval@example\.invalid|org_synthetic_eval|dbt_intermediate\.user_organization_role|dbt_mart\.aggregate_monthly_users_per_org|organization user roles|monthly organization user count/i,
    );
    expect(rows.every((row) => row.code_revision.startsWith("sha256:"))).toBe(
      true,
    );
    expect(rows.every((row) => row.fixture_revision === FIXTURE_REVISION)).toBe(
      true,
    );
    if (process.env.ANALYTICS_EVAL_EMIT_CSV === "1") {
      process.stdout.write(
        `ANALYTICS_PRODUCTION_PATH_CSV_BEGIN\n${csv}\nANALYTICS_PRODUCTION_PATH_CSV_END\n`,
      );
    }
  });

  it("runs the real Analytics production loop with fixture storage, guard, identity, and usage", async () => {
    const { output, receipt } = await runOnce(SYNTHETIC_CASES[0]!);
    expect(output.ok).toBe(true);
    expect(output.toolCalls).toEqual(["find-data"]);
    expect(output.usage).toMatchObject({
      inputTokens: 240,
      outputTokens: 48,
      llmCalls: 2,
      usageReported: true,
    });

    expect(receipt).toMatchObject({
      productionAgentLoopInvoked: true,
      requestPreparationInvoked: true,
      systemPromptBuilt: true,
      finalResponseGuardInstalled: true,
      finalResponseGuardApplied: true,
      usageCaptured: true,
      ownerEmail: IDENTITY.ownerEmail,
      orgId: IDENTITY.orgId,
      prefetchStatus: "ok",
    });
    expect(receipt.availableActionNames).toEqual(["find-data"]);
    expect(receipt.initialToolNames).toEqual(["find-data"]);
    expect(storage.listOrgSettings).toHaveBeenCalledWith(
      IDENTITY.orgId,
      "data-dict-",
      expect.any(Object),
    );
    expect(storage.getOrgSetting).toHaveBeenCalledWith(
      IDENTITY.orgId,
      "analytics-source-index",
    );
    expect(storage.listSettingsByPrefix).toHaveBeenCalledWith(
      `u:${IDENTITY.ownerEmail}:data-dict-`,
      expect.any(Object),
    );
    expect(storage.availableEmbeddingFamilies).toHaveBeenCalled();
  });

  it("rejects attempts to serialize unapproved transcript or tool fields", () => {
    const unsafe = {
      case_id: "case",
      phase: "after",
      git_revision: "working-tree",
      code_revision: `sha256:${"a".repeat(64)}`,
      fixture_revision: FIXTURE_REVISION,
      run: 1,
      score: 1,
      reason_code: "rank_1",
      expected_rank: 1,
      hit_at_5: true,
      find_data_calls: 1,
      other_action_calls: 0,
      failed_action_calls: 0,
      completed: true,
      aborted: false,
      input_tokens: 1,
      output_tokens: 1,
      llm_calls: 2,
      latency_ms: 1,
      prompt: "not allowed",
    } as PrivacySafeEvalRow & { prompt: string };
    expect(() => renderPrivacySafeEvalCsv([unsafe])).toThrow(
      "unapproved field",
    );
  });
});
