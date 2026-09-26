import {
  isReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";

export type JobLastStatus = "success" | "error" | "running" | "skipped";
export type JobTriggerType = "schedule" | "event" | "webhook";
export type JobExecutionMode = "agentic" | "deterministic";

export interface JobFrontmatter {
  schedule: string;
  enabled: boolean;
  timezone?: string;
  createdBy?: string;
  orgId?: string;
  runAs?: "creator" | "shared";
  lastRun?: string;
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
  reasoningEffort?: ReasoningEffort;
  maxIterations?: number;
  maxRunInputTokens?: number;
  mcpTools?: string[];
  triggerType?: JobTriggerType;
  event?: string;
  /** Legacy only. New webhook tokens live in the encrypted secret store. */
  webhookToken?: string;
  condition?: string;
  mode?: JobExecutionMode;
  domain?: string;
  appId?: string;
  executionHostId?: string;
  executionEngine?: string;
  executionCwd?: string;
  remoteRequestId?: string;
  remoteCommandId?: string;
  remoteRunId?: string;
  remoteAutomationRunId?: string;
  remoteAdvanceSchedule?: boolean;
  delegatedPolicyId?: string;
}

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

function isFactoryAutomationPath(path: string): boolean {
  return (
    /^jobs\/factories\/[^/]+\/[^/]+\.md$/.test(path) ||
    /^jobs\/factory-[^/]+\.md$/.test(path)
  );
}

function organizationIdFromOwner(
  owner: string | null | undefined,
): string | null {
  if (!owner?.startsWith("__organization__:")) return null;
  const encoded = owner.slice("__organization__:".length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    // coercion-ok: a malformed owner key is not an organization id
    return null;
  }
}

export function recoveredFactoryOwnerOrgId(
  meta: Pick<JobFrontmatter, "appId" | "orgId">,
  path: string,
  owner: string | null | undefined,
): string | null {
  if (!isFactoryAutomationPath(path)) return null;
  const ownerOrgId = organizationIdFromOwner(owner);
  if (!ownerOrgId) return null;
  const ownerAppId = meta.appId?.trim();
  if (ownerAppId && ownerAppId !== "factory") return null;
  const declaredOrgId = meta.orgId?.trim();
  if (declaredOrgId && declaredOrgId !== ownerOrgId) return null;
  return ownerOrgId;
}

export function isRecoveredFactoryJob(
  meta: Pick<JobFrontmatter, "appId" | "orgId">,
  path: string,
  actorAppId: string | null | undefined,
  owner: string | null | undefined,
): boolean {
  if (actorAppId?.trim() !== "factory") return false;
  return recoveredFactoryOwnerOrgId(meta, path, owner) !== null;
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
const EXECUTION_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const REMOTE_ID_RE = /^[a-z0-9][a-z0-9@+._:/-]{0,511}$/i;
const WEBHOOK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EXTRA_FRONTMATTER_LINES = "_extraFrontmatterLines";
const KNOWN_FRONTMATTER_FIELDS = new Set([
  "schedule",
  "enabled",
  "timezone",
  "createdBy",
  "orgId",
  "runAs",
  "lastRun",
  "lastCheck",
  "lastStatus",
  "lastError",
  "nextRun",
  "originScopeId",
  "deliveryPlatform",
  "deliveryDestination",
  "deliveryThreadRef",
  "deliveryTenantId",
  "model",
  "reasoningEffort",
  "maxIterations",
  "maxRunInputTokens",
  "mcpTools",
  "triggerType",
  "event",
  "webhookToken",
  "condition",
  "mode",
  "domain",
  "appId",
  "executionHostId",
  "executionEngine",
  "executionCwd",
  "remoteRequestId",
  "remoteCommandId",
  "remoteRunId",
  "remoteAutomationRunId",
  "remoteAdvanceSchedule",
  "delegatedPolicyId",
]);

type JobFrontmatterWithExtras = JobFrontmatter & {
  [EXTRA_FRONTMATTER_LINES]?: string[];
};

function assertBoundedFrontmatterValue(
  value: string | undefined,
  label: string,
  pattern: RegExp,
): void {
  if (value === undefined) return;
  if (!pattern.test(value)) {
    throw new Error(`${label} must be a bounded opaque identifier.`);
  }
}

export function assertDelegatedPolicyId(value: string | undefined): void {
  if (!value) return;
  if (!DELEGATED_POLICY_ID_RE.test(value)) {
    throw new Error(
      "Delegated automation policy IDs must be 1-128 letters, numbers, dots, underscores, colons, or hyphens.",
    );
  }
}

export function assertJobExecutionTargetFields(
  meta: Pick<
    JobFrontmatter,
    "executionHostId" | "executionEngine" | "executionCwd"
  >,
): void {
  assertBoundedFrontmatterValue(
    meta.executionHostId,
    "Execution host IDs",
    EXECUTION_ID_RE,
  );
  assertBoundedFrontmatterValue(
    meta.executionEngine,
    "Execution engine IDs",
    EXECUTION_ID_RE,
  );
  if (
    meta.executionCwd !== undefined &&
    (meta.executionCwd.length > 1024 || /[\r\n]/.test(meta.executionCwd))
  ) {
    throw new Error(
      "Execution workspace paths must be at most 1024 characters.",
    );
  }
}

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
    case "reasoningEffort":
      meta.reasoningEffort = isReasoningEffort(value) ? value : undefined;
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
      meta.triggerType =
        value === "event" || value === "webhook" ? value : "schedule";
      break;
    case "event":
      meta.event = value;
      break;
    case "webhookToken":
      if (WEBHOOK_TOKEN_RE.test(value)) meta.webhookToken = value;
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
    case "executionHostId":
      meta.executionHostId = value || undefined;
      break;
    case "executionEngine":
      meta.executionEngine = value || undefined;
      break;
    case "executionCwd":
      meta.executionCwd = value || undefined;
      break;
    case "remoteRequestId":
      meta.remoteRequestId = value || undefined;
      break;
    case "remoteCommandId":
      meta.remoteCommandId = value || undefined;
      break;
    case "remoteRunId":
      meta.remoteRunId = value || undefined;
      break;
    case "remoteAutomationRunId":
      meta.remoteAutomationRunId = value || undefined;
      break;
    case "remoteAdvanceSchedule":
      meta.remoteAdvanceSchedule = value !== "false";
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

  const meta: JobFrontmatterWithExtras = { schedule: "", enabled: true };
  const extraLines: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      if (line.trim()) extraLines.push(line);
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    if (key === EXTRA_FRONTMATTER_LINES) continue;
    if (!KNOWN_FRONTMATTER_FIELDS.has(key)) {
      extraLines.push(line);
      continue;
    }
    parseKnownField(meta, key, line.slice(colonIdx + 1));
  }
  if (extraLines.length) {
    meta[EXTRA_FRONTMATTER_LINES] = extraLines;
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
  assertDelegatedPolicyId(meta.delegatedPolicyId);
  assertJobExecutionTargetFields(meta);
  assertBoundedFrontmatterValue(
    meta.remoteRequestId,
    "Remote request IDs",
    REMOTE_ID_RE,
  );
  assertBoundedFrontmatterValue(
    meta.remoteCommandId,
    "Remote command IDs",
    REMOTE_ID_RE,
  );
  assertBoundedFrontmatterValue(
    meta.remoteRunId,
    "Remote run IDs",
    REMOTE_ID_RE,
  );
  assertBoundedFrontmatterValue(
    meta.remoteAutomationRunId,
    "Remote automation run IDs",
    REMOTE_ID_RE,
  );

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
  pushString(lines, "executionHostId", meta.executionHostId);
  pushString(lines, "executionEngine", meta.executionEngine);
  pushString(lines, "executionCwd", meta.executionCwd);
  pushString(lines, "remoteRequestId", meta.remoteRequestId);
  pushString(lines, "remoteCommandId", meta.remoteCommandId);
  pushString(lines, "remoteRunId", meta.remoteRunId);
  pushString(lines, "remoteAutomationRunId", meta.remoteAutomationRunId);
  if (meta.remoteAdvanceSchedule !== undefined) {
    lines.push(`remoteAdvanceSchedule: ${meta.remoteAdvanceSchedule}`);
  }
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
  if (meta.reasoningEffort) {
    lines.push(`reasoningEffort: ${meta.reasoningEffort}`);
  }
  if (meta.maxIterations !== undefined) {
    lines.push(`maxIterations: ${meta.maxIterations}`);
  }
  if (meta.maxRunInputTokens !== undefined) {
    lines.push(`maxRunInputTokens: ${meta.maxRunInputTokens}`);
  }
  if (meta.mcpTools?.length) {
    lines.push(`mcpTools: ${JSON.stringify(meta.mcpTools)}`);
  }
  lines.push(
    ...((meta as JobFrontmatterWithExtras)[EXTRA_FRONTMATTER_LINES] ?? []),
  );
  lines.push("---", "", body);
  return lines.join("\n");
}

export type JobExecutionFrontmatterPatch = {
  lastRun?: string;
  lastCheck?: string;
  lastStatus?: JobLastStatus;
  lastError?: string;
  nextRun?: string;
  remoteRequestId?: string;
  remoteCommandId?: string;
  remoteRunId?: string;
  remoteAutomationRunId?: string;
  remoteAdvanceSchedule?: boolean;
};

function jobFrontmatterBounds(content: string): {
  newline: string;
  opener: string;
  closer: string;
  end: number;
} {
  const newline = content.startsWith("---\r\n")
    ? "\r\n"
    : content.startsWith("---\n")
      ? "\n"
      : null;
  if (!newline) {
    throw new Error(
      "Job resource is missing frontmatter; cannot patch the stored document.",
    );
  }
  const opener = `---${newline}`;
  const closer = `${newline}---`;
  const end = content.indexOf(closer, opener.length);
  if (end === -1) {
    throw new Error(
      "Job resource is missing frontmatter; cannot patch the stored document.",
    );
  }
  return { newline, opener, closer, end };
}

function setOrRemoveFrontmatterField(
  content: string,
  key: string,
  serialized: string | undefined,
): string {
  const { newline, opener, end } = jobFrontmatterBounds(content);
  const frontmatter = content.slice(opener.length, end);
  const pattern = new RegExp(`^${key}:.*(?:\\r?\\n)?`, "m");
  if (serialized === undefined) {
    if (!pattern.test(frontmatter)) return content;
    const nextFrontmatter = frontmatter.replace(pattern, "").trimEnd();
    return nextFrontmatter
      ? `${opener}${nextFrontmatter}${content.slice(end)}`
      : `${opener}${content.slice(end)}`;
  }
  if (pattern.test(frontmatter)) {
    return `${opener}${frontmatter.replace(pattern, `${key}: ${serialized}${newline}`)}${content.slice(end)}`;
  }
  return `${content.slice(0, end)}${newline}${key}: ${serialized}${content.slice(end)}`;
}

const UNQUOTED_STRING_FRONTMATTER_KEYS = new Set([
  "lastStatus",
  "triggerType",
  "mode",
  "runAs",
  "reasoningEffort",
]);

export type JobFrontmatterPatchValue =
  | string
  | number
  | boolean
  | readonly string[]
  | undefined;

export type JobFrontmatterPatch = {
  [key: string]: JobFrontmatterPatchValue;
};

function serializeFrontmatterPatchValue(
  key: string,
  value: string | number | boolean | readonly string[],
): string {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (UNQUOTED_STRING_FRONTMATTER_KEYS.has(key) && typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function patchJobFrontmatterFields(
  content: string,
  fields: JobFrontmatterPatch,
): string {
  let next = content;
  for (const key of Object.keys(fields)) {
    if (key === EXTRA_FRONTMATTER_LINES) continue;
    if (!Object.hasOwn(fields, key)) continue;
    const value = fields[key];
    next = setOrRemoveFrontmatterField(
      next,
      key,
      value === undefined
        ? undefined
        : serializeFrontmatterPatchValue(key, value),
    );
  }
  return next;
}

export function replaceJobResourceBody(content: string, body: string): string {
  const { newline, closer, end } = jobFrontmatterBounds(content);
  return `${content.slice(0, end + closer.length)}${newline}${newline}${body}`;
}
