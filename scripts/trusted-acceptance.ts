import { readFileSync } from "node:fs";

/**
 * Pure validation contracts for the isolated trusted-acceptance lane.
 *
 * This module deliberately contains no environment access, network access, or
 * deployment code. The default-branch controller supplies available templates
 * and PR metadata, then fails closed on these results before a build starts.
 */

export type AcceptancePaths = {
  health: string;
  oauthMetadata: string;
  mcp: string;
};

export type AcceptanceBuild = {
  command: string;
  publishDirectory: string;
};

export type AcceptanceEnvironmentKeys = {
  databaseUrl: string;
  betterAuthSecret: string;
  a2aSecret: string;
};

export type RuntimeAuthorityProvisioner =
  | { kind: "unconfigured" }
  | {
      kind: "trusted-lease-v1";
      profileMapVariable: "ACCEPTANCE_AUTHORITY_PROFILES_JSON";
    };

export type AcceptanceDirectoryFixture = {
  origin: string;
  siteIdVariable: string;
  withdrawnMemberId: string;
};

export type AcceptanceHarness =
  | {
      kind: "a2a-directory-withdrawal";
      callerMemberId: string;
      targetMemberId: string;
      message: string;
      expectedResult: string;
      maxStatusPolls: number;
    }
  | {
      kind: "mcp-read-only-tool";
      memberId: string;
      tool: string;
      arguments: Record<string, unknown>;
    };

export type AcceptanceIsolation = {
  productionOrigin: string;
  otherAcceptanceMemberId: string;
};

export type TrustedAcceptanceMember = {
  template: string;
  origin: string;
  siteIdVariable: string;
  environment: AcceptanceEnvironmentKeys;
  inference?: {
    provider: "openrouter";
    engine: "ai-sdk:openrouter";
  };
  build: AcceptanceBuild;
  paths: AcceptancePaths;
};

export type TrustedAcceptanceWorkspace = {
  id: string;
  enabled: boolean;
  runtimeAuthority: {
    lifecycle: "ephemeral-per-run";
    provisioner: RuntimeAuthorityProvisioner;
  };
  directoryFixture?: AcceptanceDirectoryFixture;
  harness: AcceptanceHarness;
  isolation?: AcceptanceIsolation;
  assertions: string[];
  members: TrustedAcceptanceMember[];
};

export type TrustedAcceptanceConfig = {
  revision: string;
  workspaces: TrustedAcceptanceWorkspace[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: ValidationIssue[] };

const forbiddenKeyPattern =
  /(?:^|_)(?:PROD(?:UCTION)?|NETLIFY|GITHUB|DEPLOY(?:MENT)?|TOKEN|API_KEY|PROVIDER)(?:_|$)/i;
const shaPattern = /^[0-9a-f]{40}$/;
const mutablePreviewHostPattern =
  /(?:^|[-.])(?:deploy-preview-\d+|branch|preview)(?:--|[-.])/i;
const acceptanceHostPattern = /(?:^|[-.])acceptance(?:[-.]|$)/i;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !/\s/.test(value);
}

function isSafeEnvironmentKey(value: string, suffix: string): boolean {
  return (
    /^[A-Z][A-Z0-9_]*$/.test(value) &&
    value.startsWith("ACCEPTANCE_") &&
    value.endsWith(suffix) &&
    !forbiddenKeyPattern.test(value)
  );
}

function isAcceptanceSiteVariable(value: string): boolean {
  return (
    /^[A-Z][A-Z0-9_]*_NETLIFY_SITE_ID$/.test(value) &&
    value.startsWith("ACCEPTANCE_") &&
    !/(?:^|_)(?:PROD(?:UCTION)?|DEPLOY(?:MENT)?|TOKEN|API_KEY)(?:_|$)/i.test(
      value,
    )
  );
}

function isAcceptanceOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      acceptanceHostPattern.test(url.hostname) &&
      !mutablePreviewHostPattern.test(url.hostname) &&
      !/(?:^|[-.])(?:prod|production)(?:[-.]|$)/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Validates config shape plus the isolation constraints that are knowable locally. */
export function validateTrustedAcceptanceConfig(
  config: TrustedAcceptanceConfig,
  availableTemplates: readonly string[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const workspaceIds = new Set<string>();
  const origins = new Set<string>();
  const siteIdVariables = new Set<string>();

  if (!config.revision.trim()) {
    issues.push({ path: "revision", message: "must be non-empty" });
  }
  if (config.workspaces.length === 0) {
    issues.push({ path: "workspaces", message: "must contain a workspace" });
  }

  for (const [workspaceIndex, workspace] of config.workspaces.entries()) {
    const workspacePath = `workspaces[${workspaceIndex}]`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(workspace.id)) {
      issues.push({
        path: `${workspacePath}.id`,
        message: "must be a stable slug",
      });
    }
    if (workspaceIds.has(workspace.id)) {
      issues.push({
        path: `${workspacePath}.id`,
        message: "duplicates a workspace",
      });
    }
    workspaceIds.add(workspace.id);
    if (workspace.runtimeAuthority?.lifecycle !== "ephemeral-per-run") {
      issues.push({
        path: `${workspacePath}.runtimeAuthority.lifecycle`,
        message: "must require disposable per-run runtime authority",
      });
    }
    const provisioner = workspace.runtimeAuthority?.provisioner;
    if (
      !provisioner ||
      (provisioner.kind !== "unconfigured" &&
        provisioner.kind !== "trusted-lease-v1")
    ) {
      issues.push({
        path: `${workspacePath}.runtimeAuthority.provisioner`,
        message: "must name a supported trusted lease provisioner",
      });
    } else if (
      provisioner.kind === "trusted-lease-v1" &&
      provisioner.profileMapVariable !== "ACCEPTANCE_AUTHORITY_PROFILES_JSON"
    ) {
      issues.push({
        path: `${workspacePath}.runtimeAuthority.provisioner.profileMapVariable`,
        message: "must use the protected generic authority profile map",
      });
    }
    if (workspace.assertions.length === 0) {
      issues.push({
        path: `${workspacePath}.assertions`,
        message: "must contain at least one assertion",
      });
    }
    if (new Set(workspace.assertions).size !== workspace.assertions.length) {
      issues.push({
        path: `${workspacePath}.assertions`,
        message: "must not contain duplicate assertion IDs",
      });
    }
    if (workspace.members.length === 0) {
      issues.push({
        path: `${workspacePath}.members`,
        message: "must contain a member",
      });
    }

    const templates = new Set<string>();
    for (const [memberIndex, member] of workspace.members.entries()) {
      const memberPath = `${workspacePath}.members[${memberIndex}]`;
      if (!availableTemplates.includes(member.template)) {
        issues.push({
          path: `${memberPath}.template`,
          message: "is not an available template",
        });
      }
      if (templates.has(member.template)) {
        issues.push({
          path: `${memberPath}.template`,
          message: "duplicates a workspace member",
        });
      }
      templates.add(member.template);
      if (!isAcceptanceOrigin(member.origin)) {
        issues.push({
          path: `${memberPath}.origin`,
          message: "must be a stable non-production acceptance HTTPS origin",
        });
      }
      if (origins.has(member.origin)) {
        issues.push({
          path: `${memberPath}.origin`,
          message: "duplicates an acceptance origin",
        });
      }
      origins.add(member.origin);
      if (!isAcceptanceSiteVariable(member.siteIdVariable)) {
        issues.push({
          path: `${memberPath}.siteIdVariable`,
          message: "must be an acceptance-scoped NETLIFY_SITE_ID variable name",
        });
      }
      if (siteIdVariables.has(member.siteIdVariable)) {
        issues.push({
          path: `${memberPath}.siteIdVariable`,
          message: "duplicates an acceptance site variable",
        });
      }
      siteIdVariables.add(member.siteIdVariable);

      const environment = member.environment;
      if (!isSafeEnvironmentKey(environment.databaseUrl, "_DATABASE_URL")) {
        issues.push({
          path: `${memberPath}.environment.databaseUrl`,
          message: "must be an acceptance-scoped DATABASE_URL key name",
        });
      }
      if (
        !isSafeEnvironmentKey(
          environment.betterAuthSecret,
          "_BETTER_AUTH_SECRET",
        )
      ) {
        issues.push({
          path: `${memberPath}.environment.betterAuthSecret`,
          message: "must be an acceptance-scoped BETTER_AUTH_SECRET key name",
        });
      }
      if (!isSafeEnvironmentKey(environment.a2aSecret, "_A2A_SECRET")) {
        issues.push({
          path: `${memberPath}.environment.a2aSecret`,
          message: "must be an acceptance-scoped A2A_SECRET key name",
        });
      }
      if (
        member.inference &&
        (member.inference.provider !== "openrouter" ||
          member.inference.engine !== "ai-sdk:openrouter")
      ) {
        issues.push({
          path: `${memberPath}.inference`,
          message: "must use the bounded OpenRouter acceptance engine",
        });
      }
      if (member.build.command !== `pnpm --filter ${member.template} build`) {
        issues.push({
          path: `${memberPath}.build.command`,
          message: "must use the template's standard pnpm build command",
        });
      }
      if (
        !member.build.publishDirectory.trim() ||
        member.build.publishDirectory.startsWith("/") ||
        member.build.publishDirectory.includes("..") ||
        !member.build.publishDirectory.startsWith(
          `templates/${member.template}/`,
        )
      ) {
        issues.push({
          path: `${memberPath}.build.publishDirectory`,
          message: "must be a relative publish directory",
        });
      }
      for (const [key, value] of Object.entries(member.paths)) {
        if (!isAbsolutePath(value)) {
          issues.push({
            path: `${memberPath}.paths.${key}`,
            message: "must be an absolute path",
          });
        }
      }
    }

    if (workspace.directoryFixture) {
      const fixturePath = `${workspacePath}.directoryFixture`;
      if (!isAcceptanceOrigin(workspace.directoryFixture.origin)) {
        issues.push({
          path: `${fixturePath}.origin`,
          message: "must be a stable non-production acceptance HTTPS origin",
        });
      }
      if (
        !isAcceptanceSiteVariable(workspace.directoryFixture.siteIdVariable)
      ) {
        issues.push({
          path: `${fixturePath}.siteIdVariable`,
          message: "must be an acceptance-scoped NETLIFY_SITE_ID variable name",
        });
      }
      if (!templates.has(workspace.directoryFixture.withdrawnMemberId)) {
        issues.push({
          path: `${fixturePath}.withdrawnMemberId`,
          message: "must identify a declared workspace member",
        });
      }
      if (origins.has(workspace.directoryFixture.origin)) {
        issues.push({
          path: `${fixturePath}.origin`,
          message: "must not duplicate a workspace member origin",
        });
      }
      if (siteIdVariables.has(workspace.directoryFixture.siteIdVariable)) {
        issues.push({
          path: `${fixturePath}.siteIdVariable`,
          message: "must not duplicate a workspace member site variable",
        });
      }
      origins.add(workspace.directoryFixture.origin);
      siteIdVariables.add(workspace.directoryFixture.siteIdVariable);
    }

    const harnessPath = `${workspacePath}.harness`;
    if (
      !workspace.harness ||
      typeof (workspace.harness as { kind?: unknown }).kind !== "string"
    ) {
      issues.push({
        path: harnessPath,
        message: "must declare a generic acceptance harness",
      });
      continue;
    }
    if (workspace.harness.kind === "a2a-directory-withdrawal") {
      if (!workspace.directoryFixture) {
        issues.push({
          path: `${harnessPath}.kind`,
          message: "requires a trusted directory fixture",
        });
      }
      if (!templates.has(workspace.harness.callerMemberId)) {
        issues.push({
          path: `${harnessPath}.callerMemberId`,
          message: "must identify a declared workspace member",
        });
      }
      if (
        workspace.harness.callerMemberId === workspace.harness.targetMemberId
      ) {
        issues.push({
          path: `${harnessPath}.targetMemberId`,
          message: "must differ from the caller to prove cross-app delegation",
        });
      }
      if (
        !templates.has(workspace.harness.targetMemberId) ||
        workspace.harness.targetMemberId !==
          workspace.directoryFixture?.withdrawnMemberId
      ) {
        issues.push({
          path: `${harnessPath}.targetMemberId`,
          message: "must identify the directory member selected for withdrawal",
        });
      }
      if (!workspace.isolation) {
        issues.push({
          path: `${workspacePath}.isolation`,
          message: "is required for the route-continuity trust boundary",
        });
      }
      if (
        !workspace.harness.message.trim() ||
        workspace.harness.message.length > 500
      ) {
        issues.push({
          path: `${harnessPath}.message`,
          message: "must be a bounded non-empty fixture message",
        });
      }
      if (
        !Number.isInteger(workspace.harness.maxStatusPolls) ||
        workspace.harness.maxStatusPolls < 1 ||
        workspace.harness.maxStatusPolls > 60
      ) {
        issues.push({
          path: `${harnessPath}.maxStatusPolls`,
          message: "must be an integer from 1 through 60",
        });
      }
      if (
        !workspace.harness.expectedResult?.trim() ||
        workspace.harness.expectedResult.length > 200
      ) {
        issues.push({
          path: `${harnessPath}.expectedResult`,
          message: "must name a bounded deterministic synthetic result",
        });
      }
    } else if (workspace.harness.kind === "mcp-read-only-tool") {
      if (!templates.has(workspace.harness.memberId)) {
        issues.push({
          path: `${harnessPath}.memberId`,
          message: "must identify a declared workspace member",
        });
      }
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(workspace.harness.tool)) {
        issues.push({
          path: `${harnessPath}.tool`,
          message: "must be a stable tool name",
        });
      }
    } else {
      issues.push({
        path: `${harnessPath}.kind`,
        message: "must name a supported generic harness",
      });
    }
    if (workspace.isolation) {
      try {
        const production = new URL(workspace.isolation.productionOrigin);
        if (
          production.protocol !== "https:" ||
          production.origin !== workspace.isolation.productionOrigin ||
          acceptanceHostPattern.test(production.hostname)
        ) {
          throw new Error("unsafe production origin");
        }
      } catch {
        issues.push({
          path: `${workspacePath}.isolation.productionOrigin`,
          message: "must be an exact non-acceptance HTTPS origin",
        });
      }
      if (
        !templates.has(workspace.isolation.otherAcceptanceMemberId) ||
        workspace.isolation.otherAcceptanceMemberId ===
          (workspace.harness.kind === "a2a-directory-withdrawal"
            ? workspace.harness.callerMemberId
            : workspace.harness.memberId)
      ) {
        issues.push({
          path: `${workspacePath}.isolation.otherAcceptanceMemberId`,
          message: "must identify a different declared acceptance member",
        });
      }
    }
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

export type TrustedAcceptancePlan = {
  revision: string;
  workspace: string;
  enabled: boolean;
  runtimeAuthority: TrustedAcceptanceWorkspace["runtimeAuthority"];
  directoryFixture?: AcceptanceDirectoryFixture;
  harness: AcceptanceHarness;
  isolation?: AcceptanceIsolation;
  assertions: string[];
  members: TrustedAcceptanceMember[];
};

export function createTrustedAcceptancePlan(
  config: TrustedAcceptanceConfig,
  availableTemplates: readonly string[],
  workspaceId: string,
  allowDisabled: boolean,
):
  | { ok: true; plan: TrustedAcceptancePlan }
  | { ok: false; issues: ValidationIssue[] } {
  const validation = validateTrustedAcceptanceConfig(
    config,
    availableTemplates,
  );
  if (!validation.ok) return validation;

  const workspace = config.workspaces.find(({ id }) => id === workspaceId);
  if (!workspace) {
    return {
      ok: false,
      issues: [{ path: "workspace", message: "is not configured" }],
    };
  }
  if (!workspace.enabled && !allowDisabled) {
    return {
      ok: false,
      issues: [
        {
          path: "workspace",
          message: "is disabled; only dry-run planning is permitted",
        },
      ],
    };
  }
  if (
    !allowDisabled &&
    workspace.runtimeAuthority.provisioner.kind === "unconfigured"
  ) {
    return {
      ok: false,
      issues: [
        {
          path: "workspace.runtimeAuthority.provisioner",
          message:
            "has no trusted ephemeral runtime authority provisioner; live deployment is unavailable",
        },
      ],
    };
  }

  return {
    ok: true,
    plan: {
      revision: config.revision,
      workspace: workspace.id,
      enabled: workspace.enabled,
      runtimeAuthority: workspace.runtimeAuthority,
      ...(workspace.directoryFixture
        ? { directoryFixture: workspace.directoryFixture }
        : {}),
      harness: workspace.harness,
      ...(workspace.isolation ? { isolation: workspace.isolation } : {}),
      assertions: workspace.assertions,
      members: workspace.members,
    },
  };
}

export type PullRequestProvenance = {
  number: number;
  state: "open" | "closed";
  headSha: string;
  headRepository: string;
  isFork: boolean;
};

export type PullRequestProvenanceInput = {
  selectedSha: string;
  expectedRepository: string;
  pullRequest: PullRequestProvenance;
};

/** Checks GitHub-sourced PR facts without making a GitHub request itself. */
export function validatePullRequestProvenance(
  input: PullRequestProvenanceInput,
): ValidationResult {
  const { selectedSha, expectedRepository, pullRequest } = input;
  const issues: ValidationIssue[] = [];
  if (!shaPattern.test(selectedSha)) {
    issues.push({
      path: "selectedSha",
      message: "must be a full lowercase 40-character SHA",
    });
  }
  if (pullRequest.state !== "open") {
    issues.push({ path: "pullRequest.state", message: "must be open" });
  }
  if (pullRequest.isFork || pullRequest.headRepository !== expectedRepository) {
    issues.push({
      path: "pullRequest.headRepository",
      message: "must be the same repository, not a fork",
    });
  }
  if (selectedSha !== pullRequest.headSha) {
    issues.push({
      path: "selectedSha",
      message: "must equal the current pull request head SHA",
    });
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

export type AcceptanceAssertionState = "pass" | "fail" | "blocked";

export type TrustedAcceptanceReceipt = {
  actor: string;
  runUrl: string;
  operation: "candidate" | "rollback";
  pullRequest: number | null;
  sha: string;
  controllerSha: string;
  configRevision: string;
  workspace: string;
  members: Array<{
    template: string;
    origin: string;
    deployId: string | null;
  }>;
  assertions: Array<{
    id: string;
    state: AcceptanceAssertionState;
    evidencePointer?: string;
  }>;
  startedAt: string;
  completedAt: string;
  result: AcceptanceAssertionState;
  rollbackTarget: string | null;
  priorKnownGoodSha: string | null;
  currentKnownGoodSha: string | null;
  lease?: {
    id: string;
    issuedAt: string;
    expiresAt: string;
    revokedAt: string | null;
    state: "active" | "revoking" | "revoked" | "failed";
  };
  cleanup?: {
    inferenceAuthority: "verified-absent" | "pending" | "failed";
    databaseBranches: "verified-absent" | "pending" | "failed";
    runtimeConfiguration: "verified-absent" | "pending" | "failed";
    tombstoneDeployIds: string[];
    verifiedAt: string | null;
  };
  scenarios?:
    | {
        kind: "a2a-directory-withdrawal";
        hostedOAuth: AcceptanceAssertionState;
        stableDiscovery: AcceptanceAssertionState;
        discoveryWithdrawal: AcceptanceAssertionState;
        taskRouteContinuity: AcceptanceAssertionState;
      }
    | {
        kind: "mcp-read-only-tool";
        hostedOAuth: AcceptanceAssertionState;
        readOnlyTool: AcceptanceAssertionState;
      };
  isolation?: {
    authorities: Array<{
      memberId: string;
      provenance: "fresh-per-run";
      algorithm: "sha256";
      digest: string;
      generatedAt: string;
    }>;
    metadata: Array<{
      role: "production" | "acceptance";
      resource: string;
      issuer: string;
    }>;
    probes: Array<{
      kind:
        | "acceptance-at-production"
        | "acceptance-at-other-acceptance"
        | "foreign-domain-sentinel-at-acceptance"
        | "expired-acceptance"
        | "replayed-acceptance"
        | "wrong-audience"
        | "post-cleanup";
      status: number;
      at: string;
      proofDigest?: string;
    }>;
  };
};

const sensitiveFieldPattern =
  /(?:secret|token|password|credential|private.?key|value)/i;
const credentialLikeValuePattern =
  /(?:gh[pousr]_|ntl_[A-Za-z0-9]|-----BEGIN|data:)/i;

function containsSensitiveReceiptData(
  value: unknown,
  path = "receipt",
): ValidationIssue[] {
  if (typeof value === "string") {
    return credentialLikeValuePattern.test(value)
      ? [{ path, message: "must not contain secret or credential values" }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      containsSensitiveReceiptData(entry, `${path}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => {
      const fieldPath = `${path}.${key}`;
      return sensitiveFieldPattern.test(key)
        ? [{ path: fieldPath, message: "must not include sensitive fields" }]
        : containsSensitiveReceiptData(entry, fieldPath);
    });
  }
  return [];
}

/** Validates the redacted receipt shape before it is emitted as an artifact. */
export function validateTrustedAcceptanceReceipt(
  receipt: TrustedAcceptanceReceipt,
  expectedAssertions?: readonly string[],
): ValidationResult {
  const issues = containsSensitiveReceiptData(receipt);
  if (!receipt.actor.trim())
    issues.push({ path: "actor", message: "must be non-empty" });
  try {
    const runUrl = new URL(receipt.runUrl);
    if (runUrl.protocol !== "https:" || runUrl.hostname !== "github.com") {
      issues.push({ path: "runUrl", message: "must be a GitHub HTTPS URL" });
    }
  } catch {
    issues.push({ path: "runUrl", message: "must be a GitHub HTTPS URL" });
  }
  if (!["candidate", "rollback"].includes(receipt.operation)) {
    issues.push({
      path: "operation",
      message: "must be candidate or rollback",
    });
  }
  if (
    receipt.operation === "candidate" &&
    (!Number.isInteger(receipt.pullRequest) || (receipt.pullRequest ?? 0) < 1)
  ) {
    issues.push({
      path: "pullRequest",
      message: "must be a positive integer for a candidate receipt",
    });
  }
  if (receipt.operation === "rollback" && receipt.pullRequest !== null) {
    issues.push({
      path: "pullRequest",
      message: "must be null for a rollback receipt",
    });
  }
  if (!shaPattern.test(receipt.sha)) {
    issues.push({
      path: "sha",
      message: "must be a full lowercase 40-character SHA",
    });
  }
  if (!shaPattern.test(receipt.controllerSha)) {
    issues.push({
      path: "controllerSha",
      message: "must be a full lowercase 40-character SHA",
    });
  }
  if (!receipt.configRevision.trim())
    issues.push({ path: "configRevision", message: "must be non-empty" });
  if (!receipt.workspace.trim())
    issues.push({ path: "workspace", message: "must be non-empty" });
  if (receipt.members.length === 0)
    issues.push({ path: "members", message: "must not be empty" });
  for (const [index, member] of receipt.members.entries()) {
    if (
      !member.template ||
      !isAcceptanceOrigin(member.origin) ||
      (member.deployId !== null && !member.deployId)
    ) {
      issues.push({
        path: `members[${index}]`,
        message: "must include template and stable acceptance origin",
      });
    }
  }
  if (receipt.assertions.length === 0)
    issues.push({ path: "assertions", message: "must not be empty" });
  if (
    new Set(receipt.assertions.map(({ id }) => id)).size !==
    receipt.assertions.length
  ) {
    issues.push({
      path: "assertions",
      message: "must not contain duplicate assertion IDs",
    });
  }
  for (const [index, assertion] of receipt.assertions.entries()) {
    if (
      !assertion.id ||
      !["pass", "fail", "blocked"].includes(assertion.state)
    ) {
      issues.push({
        path: `assertions[${index}]`,
        message: "must include an ID and valid state",
      });
    }
  }
  if (
    expectedAssertions &&
    JSON.stringify(receipt.assertions.map(({ id }) => id)) !==
      JSON.stringify(expectedAssertions)
  ) {
    issues.push({
      path: "assertions",
      message: "must exactly match the configured assertion IDs",
    });
  }
  for (const [key, value] of Object.entries({
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
  })) {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))
      issues.push({ path: key, message: "must be an ISO timestamp" });
  }
  if (!["pass", "fail", "blocked"].includes(receipt.result)) {
    issues.push({ path: "result", message: "must be pass, fail, or blocked" });
  }
  if (
    receipt.operation === "rollback" &&
    !receipt.rollbackTarget &&
    receipt.result === "pass"
  ) {
    issues.push({
      path: "rollbackTarget",
      message: "is required for a passing receipt",
    });
  } else if (
    receipt.rollbackTarget &&
    !shaPattern.test(receipt.rollbackTarget)
  ) {
    issues.push({
      path: "rollbackTarget",
      message: "must be a full lowercase 40-character SHA or null",
    });
  }
  if (
    receipt.operation === "candidate" &&
    (receipt.rollbackTarget !== null || receipt.priorKnownGoodSha !== null)
  ) {
    issues.push({
      path: "rollbackTarget",
      message: "candidate receipts must not claim rollback provenance",
    });
  }
  if (
    receipt.result === "pass" &&
    receipt.assertions.some(({ state }) => state !== "pass")
  ) {
    issues.push({
      path: "assertions",
      message: "every assertion must pass when the receipt result passes",
    });
  }
  for (const key of ["priorKnownGoodSha", "currentKnownGoodSha"] as const) {
    const value = receipt[key];
    if (value && !shaPattern.test(value)) {
      issues.push({
        path: key,
        message: "must be a full lowercase 40-character SHA or null",
      });
    }
  }
  if (
    receipt.result === "pass" &&
    receipt.members.some(({ deployId }) => !deployId)
  ) {
    issues.push({
      path: "members",
      message: "passing receipts require every deployment ID",
    });
  }
  if (
    receipt.result === "pass" &&
    receipt.currentKnownGoodSha !== receipt.sha
  ) {
    issues.push({
      path: "currentKnownGoodSha",
      message: "must equal the deployed SHA for a passing receipt",
    });
  }
  if (
    receipt.operation === "rollback" &&
    receipt.result === "pass" &&
    receipt.priorKnownGoodSha !== receipt.rollbackTarget
  ) {
    issues.push({
      path: "priorKnownGoodSha",
      message: "must equal the rollback target for a passing receipt",
    });
  }
  if (receipt.lease) {
    if (!receipt.lease.id.trim()) {
      issues.push({ path: "lease.id", message: "must be non-empty" });
    }
    for (const key of ["issuedAt", "expiresAt"] as const) {
      if (Number.isNaN(Date.parse(receipt.lease[key]))) {
        issues.push({
          path: `lease.${key}`,
          message: "must be an ISO timestamp",
        });
      }
    }
    if (
      receipt.lease.revokedAt !== null &&
      Number.isNaN(Date.parse(receipt.lease.revokedAt))
    ) {
      issues.push({
        path: "lease.revokedAt",
        message: "must be an ISO timestamp or null",
      });
    }
    if (
      Date.parse(receipt.lease.expiresAt) <= Date.parse(receipt.lease.issuedAt)
    ) {
      issues.push({
        path: "lease.expiresAt",
        message: "must be later than the issue timestamp",
      });
    }
  }
  if (receipt.cleanup) {
    if (
      receipt.cleanup.verifiedAt !== null &&
      Number.isNaN(Date.parse(receipt.cleanup.verifiedAt))
    ) {
      issues.push({
        path: "cleanup.verifiedAt",
        message: "must be an ISO timestamp or null",
      });
    }
    if (
      receipt.cleanup.tombstoneDeployIds.some((id) => !id.trim()) ||
      new Set(receipt.cleanup.tombstoneDeployIds).size !==
        receipt.cleanup.tombstoneDeployIds.length
    ) {
      issues.push({
        path: "cleanup.tombstoneDeployIds",
        message: "must contain unique non-empty opaque deployment IDs",
      });
    }
  }
  if (
    receipt.scenarios &&
    Object.entries(receipt.scenarios).some(
      ([key, state]) =>
        key !== "kind" && !["pass", "fail", "blocked"].includes(String(state)),
    )
  ) {
    issues.push({
      path: "scenarios",
      message: "must contain valid assertion states",
    });
  }
  if (receipt.isolation) {
    for (const [index, authority] of receipt.isolation.authorities.entries()) {
      if (
        !/^[a-z0-9][a-z0-9-]*$/.test(authority.memberId) ||
        authority.provenance !== "fresh-per-run" ||
        authority.algorithm !== "sha256" ||
        !/^sha256:[a-f0-9]{64}$/.test(authority.digest) ||
        Number.isNaN(Date.parse(authority.generatedAt))
      ) {
        issues.push({
          path: `isolation.authorities[${index}]`,
          message: "must contain redacted fresh per-run signing provenance",
        });
      }
    }
    for (const [index, metadata] of receipt.isolation.metadata.entries()) {
      try {
        const resource = new URL(metadata.resource);
        const issuer = new URL(metadata.issuer);
        if (
          resource.protocol !== "https:" ||
          issuer.protocol !== "https:" ||
          !["production", "acceptance"].includes(metadata.role)
        ) {
          throw new Error("unsafe metadata");
        }
      } catch {
        issues.push({
          path: `isolation.metadata[${index}]`,
          message: "must name public HTTPS resource and issuer metadata",
        });
      }
    }
    for (const [index, probe] of receipt.isolation.probes.entries()) {
      if (
        probe.status < 400 ||
        probe.status > 499 ||
        Number.isNaN(Date.parse(probe.at)) ||
        (probe.proofDigest !== undefined &&
          !/^sha256:[a-f0-9]{64}$/.test(probe.proofDigest))
      ) {
        issues.push({
          path: `isolation.probes[${index}]`,
          message:
            "must contain only a fail-closed HTTP status, timestamp, and optional redacted digest",
        });
      }
    }
  }
  if (receipt.result === "pass") {
    const expectedTombstoneCount =
      receipt.members.length +
      (receipt.scenarios?.kind === "a2a-directory-withdrawal" ? 1 : 0);
    if (
      receipt.lease?.state !== "revoked" ||
      !receipt.lease.revokedAt ||
      receipt.cleanup?.inferenceAuthority !== "verified-absent" ||
      receipt.cleanup.databaseBranches !== "verified-absent" ||
      receipt.cleanup.runtimeConfiguration !== "verified-absent" ||
      !receipt.cleanup.verifiedAt ||
      receipt.cleanup.tombstoneDeployIds.length !== expectedTombstoneCount
    ) {
      issues.push({
        path: "cleanup",
        message:
          "passing receipts require verified lease revocation, database and runtime cleanup, and one trusted tombstone deploy per member and directory fixture",
      });
    }
    const scenarios = receipt.scenarios;
    const scenariosPassed =
      scenarios?.hostedOAuth === "pass" &&
      (scenarios.kind === "a2a-directory-withdrawal"
        ? scenarios.stableDiscovery === "pass" &&
          scenarios.discoveryWithdrawal === "pass" &&
          scenarios.taskRouteContinuity === "pass"
        : scenarios.kind === "mcp-read-only-tool" &&
          scenarios.readOnlyTool === "pass");
    if (!scenariosPassed) {
      issues.push({
        path: "scenarios",
        message:
          "passing receipts require hosted OAuth and every configured generic harness scenario",
      });
    }
    const isolationRequired = expectedAssertions
      ? expectedAssertions.includes("A11") || expectedAssertions.includes("I7")
      : true;
    const requiredProbeKinds = new Set<
      NonNullable<
        TrustedAcceptanceReceipt["isolation"]
      >["probes"][number]["kind"]
    >([
      "acceptance-at-production",
      "acceptance-at-other-acceptance",
      "foreign-domain-sentinel-at-acceptance",
      "expired-acceptance",
      "replayed-acceptance",
      "wrong-audience",
      "post-cleanup",
    ]);
    const isolation = receipt.isolation;
    const productionMetadata = isolation?.metadata.filter(
      ({ role }) => role === "production",
    );
    const acceptanceMetadata = isolation?.metadata.filter(
      ({ role }) => role === "acceptance",
    );
    if (
      isolationRequired &&
      (!isolation?.authorities.length ||
        !productionMetadata?.length ||
        !acceptanceMetadata?.length ||
        productionMetadata.some((production) =>
          acceptanceMetadata.some(
            (acceptance) =>
              production.resource === acceptance.resource ||
              production.issuer === acceptance.issuer,
          ),
        ) ||
        isolation.probes.some(({ kind, status }) =>
          kind === "acceptance-at-production" ||
          kind === "acceptance-at-other-acceptance" ||
          kind === "foreign-domain-sentinel-at-acceptance"
            ? status !== 401
            : status < 400 || status > 499,
        ) ||
        ![...requiredProbeKinds].every((kind) =>
          isolation.probes.some((probe) => probe.kind === kind),
        ))
    ) {
      issues.push({
        path: "isolation",
        message:
          "passing receipts require fresh signing provenance, distinct public production and acceptance metadata, and every controller-owned 401 isolation probe",
      });
    }
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

type CliCommand = "config" | "plan" | "provenance" | "receipt";

function readJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * CLI commands intentionally accept JSON files, never inline secrets:
 *
 * - config --file <config.json> --templates calendar,content
 * - plan --file <config.json> --templates calendar,content --workspace <id> [--allow-disabled]
 * - provenance --file <github-pr.json> --sha <full-sha> --repository BuilderIO/agent-native
 * - receipt --file <receipt.json>
 */
export function runTrustedAcceptanceCli(
  args: string[],
): ValidationResult | { ok: true; plan: TrustedAcceptancePlan } {
  const [command] = args as [CliCommand | undefined];
  const file = argumentValue(args, "--file");
  if (!command || !file) {
    return {
      ok: false,
      issues: [{ path: "arguments", message: "requires a command and --file" }],
    };
  }
  if (command === "config") {
    const templates = (argumentValue(args, "--templates") ?? "")
      .split(",")
      .filter(Boolean);
    return validateTrustedAcceptanceConfig(
      readJsonFile<TrustedAcceptanceConfig>(file),
      templates,
    );
  }
  if (command === "plan") {
    const templates = (argumentValue(args, "--templates") ?? "")
      .split(",")
      .filter(Boolean);
    const workspace = argumentValue(args, "--workspace");
    if (!workspace) {
      return {
        ok: false,
        issues: [{ path: "arguments", message: "plan requires --workspace" }],
      };
    }
    return createTrustedAcceptancePlan(
      readJsonFile<TrustedAcceptanceConfig>(file),
      templates,
      workspace,
      args.includes("--allow-disabled"),
    );
  }
  if (command === "provenance") {
    const selectedSha = argumentValue(args, "--sha");
    const expectedRepository = argumentValue(args, "--repository");
    if (!selectedSha || !expectedRepository) {
      return {
        ok: false,
        issues: [
          {
            path: "arguments",
            message: "provenance requires --sha and --repository",
          },
        ],
      };
    }
    return validatePullRequestProvenance({
      selectedSha,
      expectedRepository,
      pullRequest: readJsonFile<PullRequestProvenance>(file),
    });
  }
  if (command === "receipt") {
    const expectedAssertions = argumentValue(args, "--expected-assertions");
    return validateTrustedAcceptanceReceipt(
      readJsonFile<TrustedAcceptanceReceipt>(file),
      expectedAssertions
        ? (JSON.parse(expectedAssertions) as string[])
        : undefined,
    );
  }
  return {
    ok: false,
    issues: [
      {
        path: "command",
        message: "must be config, plan, provenance, or receipt",
      },
    ],
  };
}

async function main(): Promise<void> {
  const result = runTrustedAcceptanceCli(process.argv.slice(2));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("trusted-acceptance.ts")) void main();
