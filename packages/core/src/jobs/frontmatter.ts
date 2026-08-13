export type JobLastStatus = "success" | "error" | "running" | "skipped";
export type JobTriggerType = "schedule" | "event";
export type JobExecutionMode = "agentic" | "deterministic";

/**
 * Every persisted field understood by either recurring jobs or automations.
 *
 * Automation-only fields stay optional so legacy recurring jobs can remain
 * distinguishable from explicitly defined schedule automations.
 */
export interface JobFrontmatter {
  schedule: string;
  enabled: boolean;
  /**
   * IANA zone the cron fields are read in. Absent means the schedule predates
   * timezone support and keeps its original host-relative meaning.
   */
  timezone?: string;
  createdBy?: string;
  orgId?: string;
  runAs?: "creator" | "shared";
  /** Last time the automation actually started executing. */
  lastRun?: string;
  /**
   * Last time a tick evaluated this automation and declined to run it. Kept
   * distinct from `lastRun` so a blocked automation cannot report a run it
   * never performed.
   */
  lastCheck?: string;
  lastStatus?: JobLastStatus;
  lastError?: string;
  nextRun?: string;
  originScopeId?: string;
  deliveryPlatform?: string;
  deliveryDestination?: string;
  deliveryThreadRef?: string;
  deliveryTenantId?: string;
  model?: string;
  /** Per-run guard for background automations; omitted uses the app setting. */
  maxIterations?: number;
  /** Per-turn input-token guard; omitted uses the app setting. */
  maxRunInputTokens?: number;
  /** Explicit MCP tool capabilities available to this background run. */
  mcpTools?: string[];
  /** Present only for resources explicitly defined as automations. */
  triggerType?: JobTriggerType;
  /** For event automations: the event name to subscribe to. */
  event?: string;
  /** Natural-language condition evaluated before dispatch. */
  condition?: string;
  mode?: JobExecutionMode;
  /** Domain tag for filtering in per-template UIs. */
  domain?: string;
  /** Explicit application owner used by the recurring-job scheduler. */
  appId?: string;
  /**
   * Optional application-owned policy id carried into actions by the trusted
   * trigger dispatcher. It is not model-supplied action input.
   */
  delegatedPolicyId?: string;
}

/**
 * Return whether a scheduler or trigger dispatcher may claim this resource.
 *
 * Personal legacy jobs have no app owner and remain compatible with the
 * shared scheduler. An organization-owned resource without an explicit app
 * owner is ambiguous, though: letting every installed app claim it can run
 * the same job multiple times and with the wrong deployment credentials.
 */
export function jobBelongsToApp(
  meta: Pick<JobFrontmatter, "appId" | "orgId">,
  appId: string | null | undefined,
): boolean {
  const ownerAppId = meta.appId?.trim();
  if (ownerAppId) {
    const schedulerAppId = appId?.trim();
    return Boolean(schedulerAppId && ownerAppId === schedulerAppId);
  }
  return !meta.orgId?.trim();
}

export interface JobResourceClassification {
  kind: "job" | "automation";
  hasExplicitTriggerType: boolean;
  triggerType: JobTriggerType;
}

export interface ParsedJobResource {
  meta: JobFrontmatter;
  body: string;
  classification: JobResourceClassification;
}

const MAX_JOB_MCP_TOOLS = 64;
const JOB_MCP_TOOL_NAME_RE = /^mcp__[^\s]+__[^\s]+$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/;
const DELEGATED_POLICY_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

/**
 * Normalize the non-secret MCP capability references persisted with a job.
 * Tool names are opaque framework identifiers; URLs and credentials never
 * belong in job frontmatter.
 */
export function normalizeJobMcpTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            throw new Error("mcpTools must be a JSON array of tool names.");
          }
        })()
      : value;
  if (!Array.isArray(parsed)) {
    throw new Error("mcpTools must be an array of MCP tool names.");
  }
  if (parsed.length > MAX_JOB_MCP_TOOLS) {
    throw new Error(
      `mcpTools may contain at most ${MAX_JOB_MCP_TOOLS} tool names.`,
    );
  }
  const normalized = [...new Set(parsed)];
  if (
    normalized.some(
      (toolName) =>
        typeof toolName !== "string" || !JOB_MCP_TOOL_NAME_RE.test(toolName),
    )
  ) {
    throw new Error(
      "mcpTools must contain only framework MCP tool names such as mcp__server__tool.",
    );
  }
  return normalized;
}

function parseScalar(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value.slice(1, -1);
    } catch {
      return value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parsePositiveInteger(rawValue: string): number | undefined {
  const parsed = Number(parseScalar(rawValue));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseKnownField(
  meta: JobFrontmatter,
  key: string,
  rawValue: string,
): void {
  const value = parseScalar(rawValue);
  switch (key) {
    case "schedule":
      meta.schedule = value;
      break;
    case "enabled":
      meta.enabled = value !== "false";
      break;
    case "timezone":
      meta.timezone = value || undefined;
      break;
    case "createdBy":
      meta.createdBy = value;
      break;
    case "orgId":
      meta.orgId = value;
      break;
    case "runAs":
      meta.runAs =
        value === "shared" || value === "creator" ? value : undefined;
      break;
    case "lastRun":
      meta.lastRun = value;
      break;
    case "lastCheck":
      meta.lastCheck = value;
      break;
    case "lastStatus":
      meta.lastStatus = value as JobLastStatus;
      break;
    case "lastError":
      meta.lastError = value;
      break;
    case "nextRun":
      meta.nextRun = value;
      break;
    case "originScopeId":
      meta.originScopeId = value;
      break;
    case "deliveryPlatform":
      meta.deliveryPlatform = value;
      break;
    case "deliveryDestination":
      meta.deliveryDestination = value;
      break;
    case "deliveryThreadRef":
      meta.deliveryThreadRef = value;
      break;
    case "deliveryTenantId":
      meta.deliveryTenantId = value;
      break;
    case "model":
      meta.model = value;
      break;
    case "maxIterations":
      meta.maxIterations = parsePositiveInteger(value);
      break;
    case "maxRunInputTokens":
      meta.maxRunInputTokens = parsePositiveInteger(value);
      break;
    case "mcpTools":
      meta.mcpTools = normalizeJobMcpTools(value);
      break;
    case "triggerType":
      // The field's presence is the durable legacy-job/automation boundary.
      // Preserve that marker even if an old writer stored an invalid value.
      meta.triggerType = value === "event" ? "event" : "schedule";
      break;
    case "event":
      meta.event = value;
      break;
    case "condition":
      meta.condition = value;
      break;
    case "mode":
      if (value === "agentic" || value === "deterministic") {
        meta.mode = value;
      }
      break;
    case "domain":
      meta.domain = value;
      break;
    case "appId":
      meta.appId = value || undefined;
      break;
    case "delegatedPolicyId":
      meta.delegatedPolicyId = value || undefined;
      break;
  }
}

export function classifyJobFrontmatter(
  meta: JobFrontmatter,
): JobResourceClassification {
  const hasExplicitTriggerType = meta.triggerType !== undefined;
  return {
    kind: hasExplicitTriggerType ? "automation" : "job",
    hasExplicitTriggerType,
    triggerType: meta.triggerType ?? "schedule",
  };
}

export function parseJobResource(content: string): ParsedJobResource {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    const meta: JobFrontmatter = { schedule: "", enabled: false };
    return {
      meta,
      body: content,
      classification: classifyJobFrontmatter(meta),
    };
  }

  const meta: JobFrontmatter = { schedule: "", enabled: true };
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    parseKnownField(
      meta,
      line.slice(0, colonIdx).trim(),
      line.slice(colonIdx + 1),
    );
  }

  return {
    meta,
    body: match[2].trim(),
    classification: classifyJobFrontmatter(meta),
  };
}

export function classifyJobResource(
  content: string,
): JobResourceClassification {
  return parseJobResource(content).classification;
}

function pushString(
  lines: string[],
  key: string,
  value: string | undefined,
  alwaysQuote = true,
): void {
  if (!value) return;
  const serialized =
    alwaysQuote || value.includes("\n") || value.includes("\r")
      ? JSON.stringify(value)
      : value;
  lines.push(`${key}: ${serialized}`);
}

export function buildJobResourceContent(
  meta: JobFrontmatter,
  body: string,
): string {
  if (
    meta.delegatedPolicyId &&
    !DELEGATED_POLICY_ID_RE.test(meta.delegatedPolicyId)
  ) {
    throw new Error(
      "Delegated automation policy IDs must be 1-128 letters, numbers, dots, underscores, colons, or hyphens.",
    );
  }

  const lines = [
    "---",
    `schedule: ${JSON.stringify(meta.schedule)}`,
    `enabled: ${meta.enabled}`,
  ];
  if (meta.triggerType) lines.push(`triggerType: ${meta.triggerType}`);
  pushString(lines, "event", meta.event);
  pushString(lines, "condition", meta.condition);
  if (meta.mode) lines.push(`mode: ${meta.mode}`);
  pushString(lines, "domain", meta.domain);
  pushString(lines, "appId", meta.appId);
  pushString(lines, "delegatedPolicyId", meta.delegatedPolicyId);
  // Keep the long-standing human-readable owner shape used by existing
  // resources and diagnostics; values that can contain free-form text use
  // JSON quoting below.
  pushString(lines, "createdBy", meta.createdBy, false);
  pushString(lines, "orgId", meta.orgId);
  if (meta.runAs) lines.push(`runAs: ${meta.runAs}`);
  pushString(lines, "timezone", meta.timezone);
  pushString(lines, "lastRun", meta.lastRun);
  pushString(lines, "lastCheck", meta.lastCheck);
  if (meta.lastStatus) lines.push(`lastStatus: ${meta.lastStatus}`);
  pushString(lines, "lastError", meta.lastError);
  pushString(lines, "nextRun", meta.nextRun);
  pushString(lines, "originScopeId", meta.originScopeId);
  pushString(lines, "deliveryPlatform", meta.deliveryPlatform);
  pushString(lines, "deliveryDestination", meta.deliveryDestination);
  pushString(lines, "deliveryThreadRef", meta.deliveryThreadRef);
  pushString(lines, "deliveryTenantId", meta.deliveryTenantId);
  pushString(lines, "model", meta.model);
  if (meta.maxIterations !== undefined) {
    lines.push(`maxIterations: ${meta.maxIterations}`);
  }
  if (meta.maxRunInputTokens !== undefined) {
    lines.push(`maxRunInputTokens: ${meta.maxRunInputTokens}`);
  }
  if (meta.mcpTools?.length) {
    lines.push(`mcpTools: ${JSON.stringify(meta.mcpTools)}`);
  }
  lines.push("---", "", body);
  return lines.join("\n");
}
