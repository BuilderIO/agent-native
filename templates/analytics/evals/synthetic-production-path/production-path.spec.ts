import { execFileSync } from "node:child_process";
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
  return {
    ownerEmail: "synthetic-eval@example.invalid",
    orgId: "org_synthetic_eval",
    dictionaryEntries: {
      "data-dict-fixture-approved-monthly-organization-user-count": {
        id: "fixture-approved-monthly-organization-user-count",
        metric: "Monthly Organization User Count",
        definition:
          "Daily-built per calendar month and organization. Completed months use the last calendar day; the current month is partial through today. The headline count excludes records marked as test members; the test-member count includes them and is not a person roster.",
        source: "fixture_warehouse",
        sourceKind: "code",
        entryType: "model",
        table: "fixture_warehouse.monthly_org_user_counts",
        columnsUsed:
          "month_start, organization_key, member_count, test_member_count",
        grain: "One row per month_start per organization_key",
        semanticScope: "membership",
        approved: true,
      },
      "data-dict-fixture-approved-monthly-workspace-membership": {
        id: "fixture-approved-monthly-workspace-membership",
        metric: "Monthly Workspace Membership",
        definition:
          "Monthly aggregate of workspace membership counts, with one row per month and workspace.",
        source: "fixture_warehouse",
        sourceKind: "code",
        entryType: "model",
        table: "fixture_warehouse.monthly_workspace_memberships",
        columnsUsed: "month_start, workspace_id, member_count",
        grain: "One row per month_start per workspace_id",
        semanticScope: "membership",
        approved: true,
      },
      "data-dict-fixture-sample-product-users": {
        id: "fixture-sample-product-users",
        metric: "Synthetic Product User Records",
        definition:
          "Synthetic customer identity records for sample product users.",
        source: "fixture_warehouse",
        sourceKind: "code",
        entryType: "model",
        table: "fixture_warehouse.synthetic_product_users",
        columnsUsed: "user_key, account_key, created_at",
        grain: "One row per user_key",
        semanticScope: "product_user",
        approved: true,
      },
      "data-dict-fixture-current-workspace-user-assignments": {
        id: "fixture-current-workspace-user-assignments",
        metric: "Workspace User Assignments",
        definition:
          "Current synthetic user-to-workspace membership assignments, with each member's assigned role.",
        source: "fixture_warehouse",
        sourceKind: "dbt",
        entryType: "model",
        table: "fixture_warehouse.current_workspace_user_assignments",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        approved: true,
      },
      "data-dict-index-fixture-stale-current-workspace-user-roster": {
        id: "index-fixture-stale-current-workspace-user-roster",
        metric: "Current Workspace User Roster",
        definition:
          "One row per synthetic user-workspace membership, with its assigned role.",
        source: "fixture_warehouse",
        sourceKind: "dbt",
        entryType: "model",
        table: "fixture_warehouse.stale_workspace_user_roster_snapshot",
        columnsUsed: "user_id, workspace_id, role_code",
        grain: "One row per user_id per workspace_id",
        semanticScope: "membership",
        approved: true,
        sourceIndexStale: false,
        sourceIndexAgeDays: 0,
        sourceIndexStaleAfterDays: 36_500,
      },
    },
    activeCaseId: null as string | null,
    sourceIndexBundle: {
      schemaVersion: 1,
      generatedAt,
      sources: [
        {
          id: "fixture_warehouse",
          contentFingerprint: "a".repeat(64),
        },
      ],
      entries: [
        {
          id: "fixture-organization-member-roles",
          metric: "Organization Member Roles",
          definition:
            "One row per synthetic user-to-organization membership, including the assigned role.",
          source: "fixture_warehouse",
          sourceKind: "code",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per user_id per organization_id",
          primaryEntity: "organization membership",
          table: "fixture_warehouse.organization_member_roles",
          columnsUsed: "user_id, organization_id, role_code",
          sourcePath: "fixtures/models/organization_member_roles.sql",
        },
        {
          id: "fixture-workspace-membership-bridge",
          metric: "Workspace Membership Bridge",
          definition:
            "One row per synthetic user-to-workspace membership, with the assigned role.",
          source: "fixture_warehouse",
          sourceKind: "code",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per user_id per workspace_id",
          primaryEntity: "workspace membership",
          table: "fixture_warehouse.workspace_membership_bridge",
          columnsUsed: "user_id, workspace_id, role_code",
          sourcePath: "fixtures/models/workspace_membership_bridge.sql",
        },
        {
          id: "fixture-active-organization-member-roles",
          metric: "Active Organization Member Roles",
          definition:
            "Current active synthetic workspace members with their assigned roles.",
          source: "fixture_warehouse",
          sourceKind: "code",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per user_id per organization_id",
          primaryEntity: "organization membership",
          table: "fixture_warehouse.active_organization_member_roles",
          columnsUsed: "user_id, organization_id, role_code",
          sourcePath: "fixtures/models/active_organization_member_roles.sql",
        },
        {
          id: "fixture-monthly-organization-member-role-counts",
          metric: "Monthly Workspace Users by Role",
          definition:
            "Monthly count of workspace users grouped by their assigned role.",
          source: "fixture_warehouse",
          sourceKind: "code",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per month_start, organization_id, and role_code",
          primaryEntity: "organization membership aggregate",
          table: "fixture_warehouse.monthly_workspace_users_by_role",
          columnsUsed: "month_start, organization_id, role_code, user_count",
          sourcePath: "fixtures/models/monthly_workspace_users_by_role.sql",
        },
        {
          id: "fixture-product-activity-events",
          metric: "Product Activity Event Records",
          definition:
            "Synthetic product usage events with one row per actor and event timestamp.",
          source: "fixture_warehouse",
          sourceKind: "code",
          entryType: "model",
          status: "active",
          semanticScope: "product_activity",
          grain: "One row per event_key",
          primaryEntity: "product activity event",
          table: "fixture_warehouse.product_activity_events",
          columnsUsed: "user_key, event_name, event_timestamp",
          sourcePath: "fixtures/models/product_activity_events.sql",
        },
        {
          id: "fixture-stale-current-workspace-user-roster",
          metric: "Current Workspace User Roster",
          definition:
            "One row per synthetic user-workspace membership, with its assigned role.",
          source: "fixture_warehouse",
          sourceKind: "dbt",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per user_id per workspace_id",
          primaryEntity: "workspace membership",
          table: "fixture_warehouse.stale_workspace_user_roster_snapshot",
          columnsUsed: "user_id, workspace_id, role_code",
          sourcePath:
            "fixtures/models/stale_workspace_user_roster_snapshot.sql",
        },
        {
          id: "fixture-aliased-workspace-member-roster",
          metric: "model:aliased_workspace_member_roster",
          definition:
            "One row per synthetic workspace-member relationship with role detail.",
          source: "fixture_warehouse",
          sourceKind: "dbt",
          entryType: "model",
          status: "active",
          semanticScope: "membership",
          grain: "One row per member_key per workspace_key membership",
          primaryEntity: "workspace membership",
          table: "fixture_warehouse.aliased_workspace_member_roster",
          sqlProjectedColumns: "member_key, workspace_key, role_code",
          inferredMembershipKeys: ["member_key", "workspace_key"],
          inferredMembershipKeyRoles: {
            user: "member_key",
            organization: "workspace_key",
          },
          sourcePath: "fixtures/models/aliased_workspace_member_roster.sql",
        },
      ],
      scanSummary: {
        unsafeEntriesOmitted: 1,
        unsafeFieldsOmitted: 2,
        truncatedFields: 3,
        unresolvedTrackingCallSites: 4,
      },
    },
  };
});

const storage = vi.hoisted(() => ({
  getOrgSetting: vi.fn(async (orgId: string, key: string) => {
    if (orgId !== "org_synthetic_eval") {
      throw new Error("Synthetic fixture received an unexpected org scope.");
    }
    if (key !== "analytics-source-index") return null;
    const bundle = syntheticData.sourceIndexBundle;
    const includeStaleRoster = [
      "stale-generated-index-yields-to-current-source",
      "approved-stale-generated-entry-yields-to-current-roster",
    ].includes(syntheticData.activeCaseId ?? "");
    const includeAliasedRoster =
      syntheticData.activeCaseId ===
      "aliased-membership-keys-preserve-roster-grain";
    const entries = bundle.entries
      .filter((entry) => {
        if (includeAliasedRoster) {
          return entry.id === "fixture-aliased-workspace-member-roster";
        }
        return (
          (includeStaleRoster ||
            entry.id !== "fixture-stale-current-workspace-user-roster") &&
          entry.id !== "fixture-aliased-workspace-member-roster"
        );
      })
      .map((entry) => {
        const baselineCompatibleEntry = { ...entry };
        if (
          includeAliasedRoster &&
          process.env.ANALYTICS_EVAL_PHASE === "before"
        ) {
          // The baseline schema predates parser-projected membership metadata.
          delete baselineCompatibleEntry.sqlProjectedColumns;
          delete baselineCompatibleEntry.inferredMembershipKeys;
          delete baselineCompatibleEntry.inferredMembershipKeyRoles;
        }
        return baselineCompatibleEntry;
      });
    return {
      ...bundle,
      entries,
    };
  }),
  listOrgSettings: vi.fn(async (orgId: string, prefix: string) => {
    if (orgId !== "org_synthetic_eval") {
      throw new Error("Synthetic fixture received an unexpected org scope.");
    }
    if (prefix !== "data-dict-") return {};
    if (
      syntheticData.activeCaseId ===
      "aliased-membership-keys-preserve-roster-grain"
    ) {
      return {
        "data-dict-fixture-monthly-aliased-workspace-member-counts": {
          id: "fixture-monthly-aliased-workspace-member-counts",
          metric: "Monthly Workspace Member Counts",
          definition: "Monthly count of synthetic workspace members by role.",
          source: "fixture_warehouse",
          sourceKind: "dbt",
          entryType: "model",
          table: "fixture_warehouse.monthly_aliased_workspace_member_counts",
          columnsUsed: "month_start, workspace_key, role_code, member_count",
          grain: "One row per month_start, workspace_key, and role_code",
          semanticScope: "membership",
          approved: true,
        },
      };
    }
    if (
      syntheticData.activeCaseId ===
      "approved-stale-generated-entry-yields-to-current-roster"
    ) {
      return syntheticData.dictionaryEntries;
    }
    const withoutStaleOverlay = Object.fromEntries(
      Object.entries(syntheticData.dictionaryEntries).filter(
        ([key]) =>
          key !== "data-dict-index-fixture-stale-current-workspace-user-roster",
      ),
    );
    if (
      syntheticData.activeCaseId ===
      "stale-generated-index-yields-to-current-source"
    ) {
      return withoutStaleOverlay;
    }
    return Object.fromEntries(
      Object.entries(withoutStaleOverlay).filter(
        ([key]) =>
          key !== "data-dict-fixture-current-workspace-user-assignments",
      ),
    );
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

const FIXTURE_REVISION = "synthetic-analytics-retrieval-v21";
const STALE_INDEX_CASE_ID = "stale-generated-index-yields-to-current-source";
const APPROVED_STALE_INDEX_CASE_ID =
  "approved-stale-generated-entry-yields-to-current-roster";
const STALE_INDEX_GENERATED_AT = "2000-01-01T00:00:00.000Z";
const BASELINE_GIT_REVISION = "8961aeb5a901eb8be8e821c10b957fa9203796c7";
const BASELINE_HARNESS_PATH =
  "templates/analytics/evals/synthetic-production-path/production-path.spec.ts";
const CANDIDATE_HARNESS_REVISION_ENV = "ANALYTICS_EVAL_HARNESS_REVISION";
const ACTION_ALLOWLIST = ["find-data"] as const;
const ANALYTICS_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPOSITORY_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: ANALYTICS_PROJECT_ROOT,
  encoding: "utf8",
}).trim();
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
    id: "current-organization-role-roster",
    prompt:
      "Find the catalog reference for the current user roster by organization. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.organization_member_roles",
  },
  {
    id: "active-workspace-member-roster-with-roles",
    prompt:
      "Find the catalog reference for active workspace members with roles. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "active-workspace-users-map-to-membership",
    prompt:
      "Find the catalog reference for active workspace users. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "exclude-inactive-show-active-members",
    prompt:
      "Find the catalog reference for workspace users; exclude inactive users and show active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "not-excluding-active-members",
    prompt:
      "Find the catalog reference for workspace members, not excluding active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "exclude-everyone-but-active-members",
    prompt:
      "Find the catalog reference for workspace members; exclude everyone but active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "full-workspace-roster-excludes-active-only-source",
    prompt:
      "Find the catalog reference for a full workspace member roster. Do not use active workspace members as a filtered subset. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.organization_member_roles",
  },
  {
    id: "long-exclusion-clause-excludes-active-only-source",
    prompt:
      "Find the catalog reference for workspace users with no counts by role and region and product area and subscription plan and final request category and exclude internal test trial accounts and active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.organization_member_roles",
  },
  {
    id: "negated-removal-keeps-active-members",
    prompt:
      "Find the catalog reference for workspace users; do not exclude inactive internal trial accounts and active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "not-to-exclude-keeps-active-members",
    prompt:
      "Find the catalog reference for workspace members; not to exclude active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "later-independent-exclusion-excludes-active-members",
    prompt:
      "Find the catalog reference for workspace users; do not exclude internal test trial accounts and exclude active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.organization_member_roles",
  },
  {
    id: "nonpositive-count-instruction-keeps-member-rows",
    prompt:
      "Find workspace users, no live counts. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.workspace_membership_bridge",
  },
  {
    id: "negated-counts-keep-positive-monthly-trend",
    prompt:
      "Find workspace users with no live counts but show the monthly trend. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.monthly_org_user_counts",
  },
  {
    id: "negated-counts-preserve-role-detail",
    prompt:
      "Find the catalog reference for workspace users with no live counts and their roles. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.workspace_membership_bridge",
  },
  {
    id: "monthly-organization-user-count",
    prompt:
      "Find the catalog reference for monthly user counts by organization. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.monthly_org_user_counts",
  },
  {
    id: "workspace-membership-prefers-row-grain",
    prompt:
      "Find the catalog reference for workspace membership. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.workspace_membership_bridge",
  },
  {
    id: "aliased-membership-keys-preserve-roster-grain",
    prompt:
      "Find the catalog reference for a current workspace member roster with role detail. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.aliased_workspace_member_roster",
  },
  {
    id: "monthly-workspace-users-by-role",
    prompt:
      "Find the catalog reference for monthly workspace users by role. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.monthly_workspace_users_by_role",
  },
  {
    id: "bare-active-members-map-to-membership",
    prompt:
      "Find the catalog reference for active members. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.active_organization_member_roles",
  },
  {
    id: "active-product-users-map-to-activity",
    prompt:
      "Find the catalog reference for active product users. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.product_activity_events",
  },
  {
    id: "sample-product-users-map-to-identities",
    prompt:
      "Find the catalog reference for sample product users. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.synthetic_product_users",
  },
  {
    id: "active-sample-product-users-map-to-activity",
    prompt:
      "Find the catalog reference for sample product users active in the last 30 days. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.product_activity_events",
  },
  {
    id: STALE_INDEX_CASE_ID,
    prompt:
      "Find the catalog reference for workspace users. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.current_workspace_user_assignments",
  },
  {
    id: APPROVED_STALE_INDEX_CASE_ID,
    prompt:
      "Find the current workspace user roster with roles. Metadata only; do not report live counts or values.",
    expectedTable: "fixture_warehouse.current_workspace_user_assignments",
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

type EvalPhase = "before" | "after";

export type PrivacySafeEvalRow = {
  case_id: string;
  phase: EvalPhase;
  git_revision: string;
  code_revision: string;
  harness_revision: string;
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
  stale_index_marked: boolean;
};

const CSV_COLUMNS: readonly (keyof PrivacySafeEvalRow)[] = [
  "case_id",
  "phase",
  "git_revision",
  "code_revision",
  "harness_revision",
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
  "stale_index_marked",
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

function requestedEvalPhase(requested: string | undefined): EvalPhase {
  if (requested === undefined || requested === "after") return "after";
  if (requested === "before") return "before";
  throw new Error("Unsupported Analytics eval phase.");
}

function currentGitRevision(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ANALYTICS_PROJECT_ROOT,
    encoding: "utf8",
  }).trim();
}

function assertEvalProvenance(
  phase: EvalPhase,
  actualGitRevision: string,
  requestedGitRevision: string,
): void {
  if (!/^[a-f0-9]{40}$/.test(requestedGitRevision)) {
    throw new Error("Analytics eval output requires a pinned Git revision.");
  }
  if (requestedGitRevision !== actualGitRevision) {
    throw new Error(
      "Analytics eval Git revision does not match this checkout.",
    );
  }
  if (phase === "before" && actualGitRevision !== BASELINE_GIT_REVISION) {
    throw new Error(
      "Before-phase output requires the pinned baseline checkout.",
    );
  }
  if (phase === "after" && actualGitRevision === BASELINE_GIT_REVISION) {
    throw new Error(
      "After-phase output cannot use the pinned baseline checkout.",
    );
  }
}

/** Accept only the candidate harness as a changed file in the baseline tree. */
function assertBaselineWorkingTreeStatus(statusOutput: string): void {
  const entries = statusOutput.split("\0").filter(Boolean);
  const onlyHarnessChanged =
    entries.length === 1 &&
    entries[0]!.slice(3) === BASELINE_HARNESS_PATH &&
    ["??", " M"].includes(entries[0]!.slice(0, 2));
  if (onlyHarnessChanged) {
    return;
  }
  throw new Error(
    "Before-phase output requires a clean baseline source tree; only the candidate production-path harness may be modified or untracked.",
  );
}

function assertBaselineHarnessMatchesCandidate(
  copiedHarness: Uint8Array,
  candidateHarness: Uint8Array,
): void {
  if (
    copiedHarness.length !== candidateHarness.length ||
    copiedHarness.some((byte, index) => byte !== candidateHarness[index])
  ) {
    throw new Error(
      "Before-phase output requires the copied harness to match the pinned candidate harness revision.",
    );
  }
}

async function assertBaselineHarnessIntegrity(
  candidateHarnessRevision: string,
): Promise<void> {
  if (
    !/^[a-f0-9]{40}$/.test(candidateHarnessRevision) ||
    candidateHarnessRevision === BASELINE_GIT_REVISION
  ) {
    throw new Error(
      "Before-phase output requires a pinned candidate harness revision.",
    );
  }
  const repositoryRelativePath = path.relative(
    REPOSITORY_ROOT,
    fileURLToPath(import.meta.url),
  );
  const candidateHarness = execFileSync(
    "git",
    ["show", `${candidateHarnessRevision}:${repositoryRelativePath}`],
    { cwd: REPOSITORY_ROOT },
  );
  assertBaselineHarnessMatchesCandidate(
    await readFile(fileURLToPath(import.meta.url)),
    candidateHarness,
  );
}

const SOURCE_FILES = [
  new URL("../production-context.ts", import.meta.url),
  new URL("../../actions/find-data.ts", import.meta.url),
  new URL("../../server/lib/provider-api.ts", import.meta.url),
  new URL("../../server/lib/analytics-query-catalog.ts", import.meta.url),
  new URL("../../server/lib/data-dictionary-overlays.ts", import.meta.url),
  new URL("../../server/lib/analytics-term-matcher.ts", import.meta.url),
  new URL("../../server/lib/analytics-agent-context.ts", import.meta.url),
  new URL("../../server/lib/data-dictionary-context.ts", import.meta.url),
  new URL("../../server/lib/source-index-store.ts", import.meta.url),
  new URL("../../server/lib/source-index-schema.ts", import.meta.url),
  new URL("../../server/plugins/agent-chat.ts", import.meta.url),
  new URL(
    "../../../../packages/core/src/agent/production-agent.ts",
    import.meta.url,
  ),
  new URL(
    "../../../../packages/core/src/eval/agent-runner.ts",
    import.meta.url,
  ),
  new URL(
    "../../../../packages/core/src/provider-api/index.ts",
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
  hash.update(BASELINE_HARNESS_PATH);
  hash.update(await readFile(fileURLToPath(import.meta.url)));
  return `sha256:${hash.digest("hex")}`;
}

async function harnessRevision(): Promise<string> {
  const content = await readFile(fileURLToPath(import.meta.url));
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Ensure the files that define the evaluated production path are baseline bytes. */
async function assertBaselineSourceBytes(): Promise<void> {
  for (const source of SOURCE_FILES) {
    const sourcePath = fileURLToPath(source);
    const repositoryRelativePath = path.relative(REPOSITORY_ROOT, sourcePath);
    const baselineBytes = execFileSync(
      "git",
      ["show", `${BASELINE_GIT_REVISION}:${repositoryRelativePath}`],
      { cwd: REPOSITORY_ROOT },
    );
    const checkoutBytes = await readFile(sourcePath);
    if (!checkoutBytes.equals(baselineBytes)) {
      throw new Error(
        "Before-phase output requires production source files to match the pinned baseline commit.",
      );
    }
  }
}

function assertCandidateWorkingTreeStatus(statusOutput: string): void {
  if (statusOutput !== "") {
    throw new Error(
      "After-phase output requires a clean candidate source tree.",
    );
  }
}

async function assertCandidateSourceIntegrity(
  candidateRevision: string,
): Promise<void> {
  const statusOutput = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assertCandidateWorkingTreeStatus(statusOutput);
  for (const source of [...SOURCE_FILES, new URL(import.meta.url)]) {
    const sourcePath = fileURLToPath(source);
    const repositoryRelativePath = path.relative(REPOSITORY_ROOT, sourcePath);
    const committedBytes = execFileSync(
      "git",
      ["show", `${candidateRevision}:${repositoryRelativePath}`],
      { cwd: REPOSITORY_ROOT },
    );
    const checkoutBytes = await readFile(sourcePath);
    if (!checkoutBytes.equals(committedBytes)) {
      throw new Error(
        "After-phase output requires evaluated source files to match the candidate commit.",
      );
    }
  }
}

async function assertBaselineSourceIntegrity(): Promise<void> {
  const statusOutput = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assertBaselineWorkingTreeStatus(statusOutput);
  await assertBaselineSourceBytes();
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
      (row.phase !== "before" && row.phase !== "after") ||
      !/^(?:[a-f0-9]{40}|working-tree)$/.test(row.git_revision) ||
      !/^sha256:[a-f0-9]{64}$/.test(row.code_revision) ||
      !/^sha256:[a-f0-9]{64}$/.test(row.harness_revision) ||
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
    if (
      row.failed_action_calls >
      row.find_data_calls + row.other_action_calls
    ) {
      throw new Error(
        "Synthetic eval CSV rejected failed action calls above the recorded action total.",
      );
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
  syntheticData.activeCaseId = testCase.id;
  syntheticData.sourceIndexBundle.generatedAt =
    testCase.id === STALE_INDEX_CASE_ID ||
    testCase.id === APPROVED_STALE_INDEX_CASE_ID
      ? STALE_INDEX_GENERATED_AT
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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
  gitRevision: string,
  phase: EvalPhase,
): Promise<PrivacySafeEvalRow[]> {
  const revision = await codeRevision();
  const currentHarnessRevision = await harnessRevision();
  const rows: PrivacySafeEvalRow[] = [];
  for (const testCase of SYNTHETIC_CASES) {
    for (const run of [1, 2]) {
      try {
        const { report, output, receipt } = await runOnce(testCase);
        const rank = expectedCandidateRank(output, testCase.expectedTable);
        const counts = actionCounts(output);
        const reasonCode = reasonForRun(testCase, output, receipt);
        const staleIndexMarked = (getToolResult(output)?.results ?? []).some(
          (candidate) =>
            candidate.origin === "source-index" &&
            candidate.sourceIndexStale === true,
        );
        const measuredRank = [
          "rank_1",
          "ranked_below_1",
          "candidate_missing",
        ].includes(reasonCode)
          ? rank
          : null;
        const successful =
          reasonCode === "rank_1" && report.results[0]?.passed === true;
        rows.push({
          case_id: testCase.id,
          phase,
          git_revision: gitRevision,
          code_revision: revision,
          harness_revision: currentHarnessRevision,
          fixture_revision: FIXTURE_REVISION,
          run,
          score: successful ? 1 : 0,
          reason_code: reasonCode,
          expected_rank: measuredRank,
          hit_at_5: measuredRank !== null && measuredRank <= 5,
          find_data_calls: counts.findDataCalls,
          other_action_calls: counts.otherActionCalls,
          failed_action_calls: counts.failedActionCalls,
          completed: output.ok,
          aborted: !output.ok && /abort|timeout/i.test(output.error ?? ""),
          input_tokens: output.usage?.inputTokens ?? 0,
          output_tokens: output.usage?.outputTokens ?? 0,
          llm_calls: output.usage?.llmCalls ?? 0,
          latency_ms: Math.max(0, Math.round(output.durationMs)),
          stale_index_marked: staleIndexMarked,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          case_id: testCase.id,
          phase,
          git_revision: gitRevision,
          code_revision: revision,
          harness_revision: currentHarnessRevision,
          fixture_revision: FIXTURE_REVISION,
          run,
          score: 0,
          reason_code: "production_path_failed",
          expected_rank: null,
          hit_at_5: false,
          find_data_calls: 0,
          other_action_calls: 0,
          failed_action_calls: 0,
          completed: false,
          aborted: /abort|timeout/i.test(message),
          input_tokens: 0,
          output_tokens: 0,
          llm_calls: 0,
          latency_ms: 0,
          stale_index_marked: false,
        });
      }
    }
  }
  return rows;
}

describe("Analytics synthetic production-path retrieval harness", () => {
  let phase: EvalPhase;
  let gitRevision: string;
  let actualGitRevision: string;

  beforeAll(async () => {
    phase = requestedEvalPhase(process.env.ANALYTICS_EVAL_PHASE);
    actualGitRevision = currentGitRevision();
    gitRevision = process.env.ANALYTICS_EVAL_GIT_REVISION ?? actualGitRevision;
    assertEvalProvenance(phase, actualGitRevision, gitRevision);
    if (process.env.ANALYTICS_EVAL_EMIT_CSV === "1") {
      if (phase === "before") {
        await assertBaselineSourceIntegrity();
        await assertBaselineHarnessIntegrity(
          process.env[CANDIDATE_HARNESS_REVISION_ENV] ?? "",
        );
      } else {
        await assertCandidateSourceIntegrity(gitRevision);
      }
    }
    generateActionRegistryForProject(ANALYTICS_PROJECT_ROOT);
  }, 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps harness cases synthetic and writes only the approved CSV schema", async () => {
    expect(SYNTHETIC_CASES.map(({ id }) => id)).toEqual([
      "current-organization-role-roster",
      "active-workspace-member-roster-with-roles",
      "active-workspace-users-map-to-membership",
      "exclude-inactive-show-active-members",
      "not-excluding-active-members",
      "exclude-everyone-but-active-members",
      "full-workspace-roster-excludes-active-only-source",
      "long-exclusion-clause-excludes-active-only-source",
      "negated-removal-keeps-active-members",
      "not-to-exclude-keeps-active-members",
      "later-independent-exclusion-excludes-active-members",
      "nonpositive-count-instruction-keeps-member-rows",
      "negated-counts-keep-positive-monthly-trend",
      "negated-counts-preserve-role-detail",
      "monthly-organization-user-count",
      "workspace-membership-prefers-row-grain",
      "aliased-membership-keys-preserve-roster-grain",
      "monthly-workspace-users-by-role",
      "bare-active-members-map-to-membership",
      "active-product-users-map-to-activity",
      "sample-product-users-map-to-identities",
      "active-sample-product-users-map-to-activity",
      STALE_INDEX_CASE_ID,
      APPROVED_STALE_INDEX_CASE_ID,
    ]);
    expect(() =>
      assertCandidateWorkingTreeStatus(
        " M templates/analytics/server/lib/source.ts\0",
      ),
    ).toThrow("clean candidate source tree");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        ` M ${BASELINE_HARNESS_PATH}\0?? packages/core-corpus/corpus.tmp-91240-ead84192/\0`,
      ),
    ).toThrow("only the candidate production-path harness may be modified");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        ` M ${BASELINE_HARNESS_PATH}\0?? packages/core-corpus/corpus.tmp-91240-ead84192/unreviewed.ts\0`,
      ),
    ).toThrow("only the candidate production-path harness may be modified");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        ` M ${BASELINE_HARNESS_PATH}\0?? packages/core-corpus/corpus.tmp-91240-ead84192/\0?? packages/core/src/unreviewed.ts\0`,
      ),
    ).toThrow("only the candidate production-path harness may be modified");
    expect(() => assertCandidateWorkingTreeStatus("")).not.toThrow();
    expect(
      SYNTHETIC_CASES.every(
        ({ prompt }) =>
          !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(prompt),
      ),
    ).toBe(true);
    if (actualGitRevision === BASELINE_GIT_REVISION) {
      expect(() =>
        assertEvalProvenance("after", actualGitRevision, actualGitRevision),
      ).toThrow("After-phase output cannot use the pinned baseline");
    } else {
      expect(() =>
        assertEvalProvenance("before", actualGitRevision, actualGitRevision),
      ).toThrow("Before-phase output requires the pinned baseline");
    }
    const rows = await makeRows(gitRevision, phase);
    const csv = renderPrivacySafeEvalCsv(rows);
    if (process.env.ANALYTICS_EVAL_EMIT_CSV === "1") {
      process.stdout.write(
        `ANALYTICS_PRODUCTION_PATH_CSV_BEGIN\n${csv}\nANALYTICS_PRODUCTION_PATH_CSV_END\n`,
      );
    }
    expect(rows).toHaveLength(SYNTHETIC_CASES.length * 2);
    expect(rows.every((row) => row.phase === phase)).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.find_data_calls === 1 &&
          row.other_action_calls === 0 &&
          row.failed_action_calls === 0 &&
          row.completed &&
          !row.aborted,
      ),
    ).toBe(true);
    if (phase === "after") {
      expect(
        rows.map(
          ({ case_id, run, score, reason_code, expected_rank, hit_at_5 }) => ({
            case_id,
            run,
            score,
            reason_code,
            expected_rank,
            hit_at_5,
          }),
        ),
      ).toEqual(
        SYNTHETIC_CASES.flatMap(({ id }) =>
          [1, 2].map((run) => ({
            case_id: id,
            run,
            score: 1,
            reason_code: "rank_1",
            expected_rank: 1,
            hit_at_5: true,
          })),
        ),
      );
    }
    const [header, ...body] = csv.split("\n");
    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(body).toHaveLength(rows.length);
    expect(body.join("\n")).not.toMatch(
      /synthetic-eval@example\.invalid|org_synthetic_eval/i,
    );
    expect(rows.every((row) => row.phase === phase)).toBe(true);
    expect(rows.every((row) => row.code_revision.startsWith("sha256:"))).toBe(
      true,
    );
    expect(rows.every((row) => row.fixture_revision === FIXTURE_REVISION)).toBe(
      true,
    );
  }, 120_000);

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
    if (phase === "after") {
      expect(getToolResult(output)?.sourceIndexScanCoverage).toEqual({
        unsafeEntriesOmitted: 1,
        unsafeFieldsOmitted: 2,
        truncatedFields: 3,
        unresolvedTrackingCallSites: 4,
      });
      expect(getToolResult(output)?.guidance).toContain(
        "1 entry was omitted by safety checks; 2 fields were omitted by safety checks; 3 fields were truncated; 4 tracking call sites have unresolved event names",
      );
    }
  }, 120_000);

  it("retrieves a row-level dbt roster when both output keys are aliased", async () => {
    const testCase = SYNTHETIC_CASES.find(
      ({ id }) => id === "aliased-membership-keys-preserve-roster-grain",
    );
    expect(testCase).toBeDefined();
    const { output } = await runOnce(testCase!);
    const result = getToolResult(output);
    expect(result?.sourceIndexStatus).toBe("available");
    const candidates = result?.results;
    expect(Array.isArray(candidates)).toBe(true);
    const tables = (candidates as Array<Record<string, unknown>>).map(
      ({ table }) => table,
    );
    if (phase === "before") {
      expect(tables).not.toContain(
        "fixture_warehouse.aliased_workspace_member_roster",
      );
      return;
    }
    expect(tables).toContain(
      "fixture_warehouse.aliased_workspace_member_roster",
    );
  }, 120_000);

  it("keeps stale source-index entries as marked leads below current definitions", async () => {
    if (phase !== "after") return;
    const staleCase = SYNTHETIC_CASES.find(
      ({ id }) => id === STALE_INDEX_CASE_ID,
    );
    expect(staleCase).toBeDefined();
    const { output } = await runOnce(staleCase!);
    const result = getToolResult(output);
    expect(result?.sourceIndexFreshness).toMatchObject({ stale: true });
    const candidates = result?.results;
    expect(Array.isArray(candidates)).toBe(true);
    const candidateList = candidates as Array<Record<string, unknown>>;
    const currentSourceIndex = candidateList.findIndex(
      ({ table }) =>
        table === "fixture_warehouse.current_workspace_user_assignments",
    );
    const staleSourceIndex = candidateList.findIndex(
      ({ table }) =>
        table === "fixture_warehouse.stale_workspace_user_roster_snapshot",
    );
    expect(currentSourceIndex).toBe(0);
    expect(staleSourceIndex).toBeGreaterThan(0);
    expect(candidateList[staleSourceIndex]).toMatchObject({
      sourceIndexStale: true,
      approved: false,
    });
    expect(result?.guidance).toContain("discover leads");
  });

  it("ranks the current roster above an approved overlay on a stale generated entry", async () => {
    if (phase !== "after") return;
    const staleCase = SYNTHETIC_CASES.find(
      ({ id }) => id === APPROVED_STALE_INDEX_CASE_ID,
    );
    expect(staleCase).toBeDefined();
    const { output } = await runOnce(staleCase!);
    const result = getToolResult(output);
    expect(result?.sourceIndexFreshness).toMatchObject({ stale: true });
    const candidates = result?.results;
    expect(Array.isArray(candidates)).toBe(true);
    const candidateList = candidates as Array<Record<string, unknown>>;
    const currentSourceIndex = candidateList.findIndex(
      ({ table }) =>
        table === "fixture_warehouse.current_workspace_user_assignments",
    );
    const staleSourceIndex = candidateList.findIndex(
      ({ table }) =>
        table === "fixture_warehouse.stale_workspace_user_roster_snapshot",
    );
    expect(currentSourceIndex).toBe(0);
    expect(staleSourceIndex).toBeGreaterThan(0);
    expect(candidateList[staleSourceIndex]).toMatchObject({
      sourceIndexStale: true,
      approved: true,
    });
    expect(candidateList[staleSourceIndex].sourceIndexAgeDays).toBeGreaterThan(
      0,
    );
  });

  it("rejects attempts to serialize unapproved transcript or tool fields", () => {
    const unsafe = {
      case_id: "case",
      phase: "candidate",
      git_revision: "working-tree",
      code_revision: `sha256:${"a".repeat(64)}`,
      harness_revision: `sha256:${"c".repeat(64)}`,
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
      stale_index_marked: false,
      prompt: "not allowed",
    } as PrivacySafeEvalRow & { prompt: string };
    expect(() => renderPrivacySafeEvalCsv([unsafe])).toThrow(
      "unapproved field",
    );

    const mislabeled = { ...unsafe };
    delete (mislabeled as Partial<typeof unsafe>).prompt;
    (mislabeled as { phase: string }).phase = "candidate";
    expect(() =>
      renderPrivacySafeEvalCsv([mislabeled as unknown as PrivacySafeEvalRow]),
    ).toThrow("invalid metric value");
  });

  it("rejects more failed actions than recorded tool calls", () => {
    const impossible: PrivacySafeEvalRow = {
      case_id: "case",
      phase: "after",
      git_revision: "working-tree",
      code_revision: `sha256:${"a".repeat(64)}`,
      harness_revision: `sha256:${"c".repeat(64)}`,
      fixture_revision: FIXTURE_REVISION,
      run: 1,
      score: 0,
      reason_code: "action_failed",
      expected_rank: null,
      hit_at_5: false,
      find_data_calls: 1,
      other_action_calls: 0,
      failed_action_calls: 2,
      completed: true,
      aborted: false,
      input_tokens: 1,
      output_tokens: 1,
      llm_calls: 2,
      latency_ms: 1,
      stale_index_marked: false,
    };

    expect(() => renderPrivacySafeEvalCsv([impossible])).toThrow(
      "failed action calls above the recorded action total",
    );
  });

  it("requires the copied baseline harness to be pinned and byte-identical", () => {
    expect(() =>
      assertBaselineWorkingTreeStatus(`?? ${BASELINE_HARNESS_PATH}\0`),
    ).not.toThrow();
    expect(() =>
      assertBaselineWorkingTreeStatus(` M ${BASELINE_HARNESS_PATH}\0`),
    ).not.toThrow();
    expect(() => assertBaselineWorkingTreeStatus("")).toThrow(
      "clean baseline source tree",
    );
    const candidateHarness = new TextEncoder().encode("candidate harness");
    expect(() =>
      assertBaselineHarnessMatchesCandidate(candidateHarness, candidateHarness),
    ).not.toThrow();
    expect(() =>
      assertBaselineHarnessMatchesCandidate(
        candidateHarness,
        new TextEncoder().encode("modified harness"),
      ),
    ).toThrow("pinned candidate harness revision");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        " M templates/analytics/server/lib/analytics-term-matcher.ts\0",
      ),
    ).toThrow("clean baseline source tree");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        "M  templates/analytics/server/lib/analytics-term-matcher.ts\0",
      ),
    ).toThrow("clean baseline source tree");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        "?? templates/analytics/actions/local.ts\0",
      ),
    ).toThrow("clean baseline source tree");
    expect(() =>
      assertBaselineWorkingTreeStatus(
        `?? ${BASELINE_HARNESS_PATH}\0?? templates/analytics/actions/local.ts\0`,
      ),
    ).toThrow("clean baseline source tree");
  });

  it("rejects an unpinned or baseline harness revision", async () => {
    await expect(assertBaselineHarnessIntegrity("")).rejects.toThrow(
      "pinned candidate harness revision",
    );
    await expect(
      assertBaselineHarnessIntegrity(BASELINE_GIT_REVISION),
    ).rejects.toThrow("pinned candidate harness revision");
  });
});
