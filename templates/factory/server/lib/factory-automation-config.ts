import { createHash } from "node:crypto";

import {
  FACTORY_ALIGNMENT_REVISION,
  managedReviewSkillAlignment,
  managedReviewSkillAlignmentMarkers,
  type FactoryAutomationName,
} from "../triage/review-skill-alignment.js";
import {
  factoryAutomationLeafName,
  readAutomationDisplayName,
  setAutomationFrontmatterField,
} from "./factory-scope.js";

export const FACTORY_INBOX_LIMIT_MAX = 50;
export const FACTORY_WORK_LIMIT_MAX = 10;
export const FACTORY_INBOX_LIMIT_DEFAULT = 25;
export const FACTORY_INTERVAL_MINUTES = [5, 10, 15, 30, 60] as const;

export type FactoryAutomationSource = "slack" | "github" | "sentry";
export type FactoryAutomationAuthorMode = "include" | "exclude";
export type FactoryAutomationScheduleMode = "interval" | "daily";
export type FactoryAutomationTemplateId =
  | "blank"
  | "slack-feedback"
  | "github-issues"
  | "pr-governance"
  | "pr-babysit"
  | "sentry-errors";

export const GUARDRAILS_START = "<!-- factory-guardrails:start -->";
export const GUARDRAILS_END = "<!-- factory-guardrails:end -->";

export type FactoryAutomationConfig = {
  source: FactoryAutomationSource;
  template: FactoryAutomationTemplateId;
  slackWorkspace: "primary" | "secondary";
  slackChannelId: string | null;
  slackChannelName: string | null;
  repository: string | null;
  sentryOrgSlug: string | null;
  sentryProjectSlug: string | null;
  sentryEnvironment: string | null;
  authorMode: FactoryAutomationAuthorMode;
  authorIds: string[];
  scheduleMode: FactoryAutomationScheduleMode;
  intervalMinutes: number;
  dailyHour: number;
  dailyMinute: number;
  timezone: string | null;
  inboxLimit: number;
  workLimit: number;
};

const SLACK_MEMBER_ID = /^[UW][A-Z0-9]+$/i;
const GITHUB_USER_ID = /^[1-9][0-9]*$/;
const LEAF_SOURCE: Record<string, FactoryAutomationSource> = {
  "factory-slack-feedback": "slack",
  "factory-sentry-errors": "sentry",
  "factory-github-issues": "github",
  "factory-pr-governance": "github",
  "factory-pr-babysit": "github",
};
const TEMPLATE_SOURCE: Record<
  Exclude<FactoryAutomationTemplateId, "blank">,
  FactoryAutomationSource
> = {
  "slack-feedback": "slack",
  "github-issues": "github",
  "pr-governance": "github",
  "pr-babysit": "github",
  "sentry-errors": "sentry",
};
const NUMERIC_LEAF_SUFFIX = /-\d+$/;
const SLUG_SOURCE_PREFIX = /^factory-(slack|github|sentry)-/;

function asAutomationSource(
  value: string | undefined,
): FactoryAutomationSource | null {
  if (value === "slack" || value === "github" || value === "sentry") {
    return value;
  }
  return null;
}

export function canonicalSeedLeafName(nameOrPath: string): string | null {
  const leaf = factoryAutomationLeafName(nameOrPath);
  if (LEAF_SOURCE[leaf]) return leaf;
  const stripped = leaf.replace(NUMERIC_LEAF_SUFFIX, "");
  if (stripped !== leaf && LEAF_SOURCE[stripped]) return stripped;
  return null;
}

function sourceFromLeaf(nameOrPath: string): FactoryAutomationSource | null {
  const leaf = factoryAutomationLeafName(nameOrPath);
  const seed = canonicalSeedLeafName(leaf);
  if (seed) return LEAF_SOURCE[seed] ?? null;
  const slug = leaf.match(SLUG_SOURCE_PREFIX);
  return slug ? asAutomationSource(slug[1]) : null;
}

function sourceFromDestination(
  content: string,
): FactoryAutomationSource | null {
  if (readFrontmatterValue(content, "repository")) return "github";
  if (
    readFrontmatterValue(content, "sentryOrgSlug") &&
    readFrontmatterValue(content, "sentryProjectSlug")
  ) {
    return "sentry";
  }
  if (readFrontmatterValue(content, "slackChannelId")) return "slack";
  return null;
}

export function defaultWorkLimit(source: FactoryAutomationSource): number {
  return source === "slack" ? 5 : 3;
}

export function defaultInboxLimit(): number {
  return FACTORY_INBOX_LIMIT_DEFAULT;
}

export function clampInboxLimit(value: number): number {
  if (!Number.isInteger(value)) return FACTORY_INBOX_LIMIT_DEFAULT;
  return Math.min(FACTORY_INBOX_LIMIT_MAX, Math.max(1, value));
}

export function clampWorkLimit(
  value: number,
  source: FactoryAutomationSource,
): number {
  if (!Number.isInteger(value)) return defaultWorkLimit(source);
  return Math.min(FACTORY_WORK_LIMIT_MAX, Math.max(1, value));
}

export function cronForInterval(minutes: number): string {
  if (minutes === 60) return "0 * * * *";
  return `*/${minutes} * * * *`;
}

export function cronForDaily(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

export function scheduleCron(config: FactoryAutomationConfig): string {
  if (config.scheduleMode === "daily") {
    return cronForDaily(config.dailyHour, config.dailyMinute);
  }
  return cronForInterval(config.intervalMinutes);
}

export function parseScheduleFromCron(
  schedule: string,
  timezone?: string | null,
): Pick<
  FactoryAutomationConfig,
  "scheduleMode" | "intervalMinutes" | "dailyHour" | "dailyMinute" | "timezone"
> {
  const trimmed = schedule.trim();
  const interval = trimmed.match(/^\*\/(5|10|15|30) \* \* \* \*$/);
  if (interval) {
    return {
      scheduleMode: "interval",
      intervalMinutes: Number(interval[1]),
      dailyHour: 9,
      dailyMinute: 0,
      timezone: timezone?.trim() || null,
    };
  }
  if (trimmed === "0 * * * *") {
    return {
      scheduleMode: "interval",
      intervalMinutes: 60,
      dailyHour: 9,
      dailyMinute: 0,
      timezone: timezone?.trim() || null,
    };
  }
  const daily = trimmed.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) {
    const minute = Number(daily[1]);
    const hour = Number(daily[2]);
    if (minute <= 59 && hour <= 23) {
      return {
        scheduleMode: "daily",
        intervalMinutes: 5,
        dailyHour: hour,
        dailyMinute: minute,
        timezone: timezone?.trim() || null,
      };
    }
  }
  return {
    scheduleMode: "interval",
    intervalMinutes: 5,
    dailyHour: 9,
    dailyMinute: 0,
    timezone: timezone?.trim() || null,
  };
}

export function inferAutomationSource(
  nameOrPath: string,
  content?: string,
): FactoryAutomationSource | null {
  const templateRaw = content
    ? readFrontmatterValue(content, "template")
    : undefined;
  if (
    templateRaw &&
    templateRaw !== "blank" &&
    templateRaw in TEMPLATE_SOURCE
  ) {
    return TEMPLATE_SOURCE[
      templateRaw as Exclude<FactoryAutomationTemplateId, "blank">
    ];
  }
  const leafSource = sourceFromLeaf(nameOrPath);
  if (leafSource) return leafSource;
  if (content) {
    const destSource = sourceFromDestination(content);
    if (destSource) return destSource;
  }
  return content
    ? asAutomationSource(readFrontmatterValue(content, "source"))
    : null;
}

export function defaultAutomationConfig(
  source: FactoryAutomationSource,
  template: FactoryAutomationTemplateId = "blank",
): FactoryAutomationConfig {
  const schedule = parseScheduleFromCron(
    template === "sentry-errors"
      ? "0 9 * * *"
      : template === "pr-governance"
        ? "*/10 * * * *"
        : template === "github-issues"
          ? "0 * * * *"
          : "*/5 * * * *",
    template === "sentry-errors" ? "America/Los_Angeles" : null,
  );
  return {
    source,
    template,
    slackWorkspace: "primary",
    slackChannelId: null,
    slackChannelName: null,
    repository: null,
    sentryOrgSlug: null,
    sentryProjectSlug: null,
    sentryEnvironment: null,
    authorMode: "exclude",
    authorIds: [],
    ...schedule,
    inboxLimit: defaultInboxLimit(),
    workLimit: defaultWorkLimit(source),
  };
}

export function validateAuthorIds(
  source: FactoryAutomationSource,
  ids: readonly string[],
): string[] {
  const unique = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (source === "slack" && !SLACK_MEMBER_ID.test(id)) {
      throw new Error(
        `Slack author ids must look like U01234567, not names. Received "${id}".`,
      );
    }
    if (source === "github" && !GITHUB_USER_ID.test(id)) {
      throw new Error(
        `GitHub author ids must be numeric user ids, not logins. Received "${id}".`,
      );
    }
    unique.add(source === "slack" ? id.toUpperCase() : id);
  }
  return [...unique];
}

export function assertAuthorFilter(
  source: FactoryAutomationSource,
  authorMode: FactoryAutomationAuthorMode,
  authorIds: readonly string[],
): string[] {
  if (source === "sentry") return [];
  const ids = validateAuthorIds(source, authorIds);
  if (authorMode === "include" && ids.length === 0) {
    throw new Error("Include mode requires at least one author id.");
  }
  return ids;
}

export function authorMatchesFilter(
  authorId: string | null | undefined,
  mode: FactoryAutomationAuthorMode,
  ids: readonly string[],
): boolean {
  if (ids.length === 0) return mode === "exclude";
  const value = (authorId ?? "").trim();
  if (!value) return mode === "exclude";
  const normalized = ids.map((id) => id.trim().toUpperCase());
  const present = normalized.includes(value.toUpperCase());
  return mode === "include" ? present : !present;
}

export function destinationKey(config: FactoryAutomationConfig): string {
  if (config.source === "slack") {
    return config.slackChannelId?.trim() || "";
  }
  if (config.source === "github") {
    return config.repository?.trim() || "";
  }
  return [config.sentryOrgSlug, config.sentryProjectSlug]
    .map((value) => value?.trim() || "")
    .join("/");
}

export function readFrontmatterValue(
  content: string,
  key: string,
): string | undefined {
  if (!content.startsWith("---\n")) return undefined;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const match = content
    .slice(4, end)
    .match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^["']|["']$/g, "");
}

export function readPromptVersion(content: string): number {
  const raw = readFrontmatterValue(content, "promptVersion");
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function readConfigSavedAt(content: string): string | null {
  return readFrontmatterValue(content, "configSavedAt") ?? null;
}

export function readAlignmentRevision(content: string): number {
  const raw = readFrontmatterValue(content, "alignmentRevision");
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function splitAutomationFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  if (!content.startsWith("---\n")) {
    return { frontmatter: "", body: content.trim() };
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: "", body: content.trim() };
  }
  return {
    frontmatter: content.slice(0, end + 4),
    body: content.slice(end + 4).trim(),
  };
}

export function assembleAutomationContent(
  frontmatter: string,
  body: string,
): string {
  const trimmedBody = body.trim();
  if (!frontmatter.trim()) {
    return trimmedBody ? `${trimmedBody}\n` : "";
  }
  return trimmedBody
    ? `${frontmatter}\n\n${trimmedBody}\n`
    : `${frontmatter}\n`;
}

export function parseAuthorIdsField(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    } catch {
      throw new Error("authorIds is not valid JSON.");
    }
  }
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readFactoryAutomationConfig(
  content: string,
  nameOrPath?: string,
): FactoryAutomationConfig {
  const source = inferAutomationSource(nameOrPath ?? "", content) ?? "slack";
  const templateRaw = readFrontmatterValue(content, "template");
  const template = (
    templateRaw === "slack-feedback" ||
    templateRaw === "github-issues" ||
    templateRaw === "pr-governance" ||
    templateRaw === "pr-babysit" ||
    templateRaw === "sentry-errors" ||
    templateRaw === "blank"
      ? templateRaw
      : "blank"
  ) as FactoryAutomationTemplateId;
  const defaults = defaultAutomationConfig(source, template);
  const schedule = parseScheduleFromCron(
    readFrontmatterValue(content, "schedule") ?? scheduleCron(defaults),
    readFrontmatterValue(content, "timezone"),
  );
  const authorModeRaw = readFrontmatterValue(content, "authorMode");
  const slackWorkspaceRaw = readFrontmatterValue(content, "slackWorkspace");
  return {
    ...defaults,
    slackWorkspace: slackWorkspaceRaw === "secondary" ? "secondary" : "primary",
    slackChannelId: readFrontmatterValue(content, "slackChannelId") || null,
    slackChannelName: readFrontmatterValue(content, "slackChannelName") || null,
    repository: readFrontmatterValue(content, "repository") || null,
    sentryOrgSlug: readFrontmatterValue(content, "sentryOrgSlug") || null,
    sentryProjectSlug:
      readFrontmatterValue(content, "sentryProjectSlug") || null,
    sentryEnvironment:
      readFrontmatterValue(content, "sentryEnvironment") || null,
    authorMode: authorModeRaw === "include" ? "include" : "exclude",
    authorIds: parseAuthorIdsField(readFrontmatterValue(content, "authorIds")),
    ...schedule,
    inboxLimit: clampInboxLimit(
      Number(
        readFrontmatterValue(content, "inboxLimit") ?? defaults.inboxLimit,
      ),
    ),
    workLimit: clampWorkLimit(
      Number(readFrontmatterValue(content, "workLimit") ?? defaults.workLimit),
      source,
    ),
  };
}

export const OPTIONAL_DESTINATION_FRONTMATTER_FIELDS = new Set([
  "slackChannelId",
  "slackChannelName",
  "repository",
  "sentryOrgSlug",
  "sentryProjectSlug",
  "sentryEnvironment",
]);

export function restoreFactoryAutomationIdentityFields(
  originalContent: string,
  repairedContent: string,
  nameOrPath: string,
): string {
  let next = repairedContent;
  const displayName = readAutomationDisplayName(originalContent);
  if (displayName && !readAutomationDisplayName(next)) {
    next = setAutomationFrontmatterField(next, "displayName", displayName);
  }
  const original = readFactoryAutomationConfig(originalContent, nameOrPath);
  const repaired = readFactoryAutomationConfig(next, nameOrPath);
  for (const key of ["slackChannelId", "slackChannelName"] as const) {
    const saved = original[key]?.trim();
    if (saved && !repaired[key]?.trim()) {
      next = setAutomationFrontmatterField(next, key, saved);
    }
  }
  if (original.authorIds.length > 0 && repaired.authorIds.length === 0) {
    next = setAutomationFrontmatterField(
      next,
      "authorMode",
      original.authorMode,
    );
    next = setAutomationFrontmatterField(
      next,
      "authorIds",
      original.authorIds.join(","),
    );
  }
  return next;
}

export function applyAutomationConfigFrontmatter(
  content: string,
  config: FactoryAutomationConfig,
): string {
  let next = content;
  const fields: Array<[string, string | null]> = [
    ["source", config.source],
    ["template", config.template],
    ["slackWorkspace", config.slackWorkspace],
    ["slackChannelId", config.slackChannelId],
    ["slackChannelName", config.slackChannelName],
    ["repository", config.repository],
    ["sentryOrgSlug", config.sentryOrgSlug],
    ["sentryProjectSlug", config.sentryProjectSlug],
    ["sentryEnvironment", config.sentryEnvironment],
    ["authorMode", config.authorMode],
    ["authorIds", config.authorIds.join(",")],
    ["scheduleMode", config.scheduleMode],
    ["intervalMinutes", String(config.intervalMinutes)],
    [
      "dailyTime",
      `${String(config.dailyHour).padStart(2, "0")}:${String(config.dailyMinute).padStart(2, "0")}`,
    ],
    ["timezone", config.timezone ?? ""],
    ["inboxLimit", String(config.inboxLimit)],
    ["workLimit", String(config.workLimit)],
    ["schedule", scheduleCron(config)],
  ];
  for (const [key, value] of fields) {
    if (OPTIONAL_DESTINATION_FRONTMATTER_FIELDS.has(key) && value == null) {
      continue;
    }
    next = setAutomationFrontmatterField(next, key, value ?? "");
  }
  return next;
}

export function factoryScopeInstruction(factoryId: string): string {
  return `This automation runs for factory \`${factoryId}\`. Pass \`factoryId: "${factoryId}"\` on every Factory triage, poll, and config action in this run.`;
}

export function buildGuardrailsText(
  factoryId: string,
  config: FactoryAutomationConfig,
  extra?: string,
): string {
  const lines = [
    factoryScopeInstruction(factoryId),
    `Each run adds at most ${config.inboxLimit} items to the inbox and works on at most ${config.workLimit} items. Do not pass a larger list-triage-items limit.`,
  ];
  if (config.source === "slack") {
    lines.push(
      "Call poll-slack-channel before listing Slack items. Never use the default page size.",
    );
  }
  if (config.source === "github") {
    lines.push(
      "Call poll-github-sources before listing GitHub items. Never use the default page size.",
    );
  }
  if (config.source === "sentry") {
    lines.push(
      "Call poll-sentry-errors before listing Sentry items. Never use the default page size.",
    );
  }
  if (config.template !== "pr-governance" && config.template !== "pr-babysit") {
    lines.push(
      "After classifying each item this run works on, call dispatch-factory-item with clearBug true or false, risk, confidence, and a short reason so the skip or start is recorded; Builder is only tagged when clearBug is true, risk is low, and confidence is high.",
    );
  }
  if (config.source === "slack") {
    lines.push(
      "Never post Slack messages, reactions, or plaintext @handles. Pass reaction on dispatch-factory-item only when the prompt says to mark that item; omit it on skips. That action adds it on the source when possible.",
    );
  }
  const extraText = extra?.trim();
  if (extraText) lines.push(extraText);
  return lines.join("\n\n");
}

export function wrapGuardrails(text: string): string {
  return `${GUARDRAILS_START}\n${text.trim()}\n${GUARDRAILS_END}`;
}

export function extractGuardrails(content: string): string {
  const start = content.indexOf(GUARDRAILS_START);
  const end = content.indexOf(GUARDRAILS_END);
  if (start === -1 || end === -1 || end < start) return "";
  return content.slice(start + GUARDRAILS_START.length, end).trim();
}

const { start: ALIGNMENT_START, end: ALIGNMENT_END } =
  managedReviewSkillAlignmentMarkers();

function stripInjectedBlocksOnce(text: string): {
  next: string;
  changed: boolean;
} {
  let next = text;
  let changed = false;
  const guardStart = next.indexOf(GUARDRAILS_START);
  const guardEnd = next.indexOf(GUARDRAILS_END);
  if (guardStart !== -1 && guardEnd !== -1 && guardEnd > guardStart) {
    next = `${next.slice(0, guardStart)}${next.slice(guardEnd + GUARDRAILS_END.length)}`;
    changed = true;
  }
  const alignStart = next.indexOf(ALIGNMENT_START);
  const alignEnd = next.indexOf(ALIGNMENT_END);
  if (alignStart !== -1 && alignEnd !== -1 && alignEnd > alignStart) {
    next = `${next.slice(0, alignStart)}${next.slice(alignEnd + ALIGNMENT_END.length)}`;
    changed = true;
  }
  const scopeStripped = next.replace(
    /This automation runs for factory `[^`]+`\. Pass `factoryId: "[^"]+"` on every Factory triage, poll, and config action in this run\.\n*/g,
    "",
  );
  if (scopeStripped !== next) {
    next = scopeStripped;
    changed = true;
  }
  return { next, changed };
}

export function stripInjectedAutomationBlocks(content: string): string {
  const { frontmatter, body } = splitAutomationFrontmatter(content);
  let next = body;
  for (let attempt = 0; attempt < 20; attempt++) {
    const { next: stripped, changed } = stripInjectedBlocksOnce(next);
    next = stripped;
    if (!changed) break;
  }
  const normalized = next.trim();
  return frontmatter ? normalized : normalized;
}

export function normalizeUserPrompt(input: string): string {
  if (input.startsWith("---\n")) {
    return stripInjectedAutomationBlocks(input);
  }
  let next = input;
  for (let attempt = 0; attempt < 20; attempt++) {
    const { next: stripped, changed } = stripInjectedBlocksOnce(next);
    next = stripped;
    if (!changed) break;
  }
  return next.trim();
}

export function countSkillAlignmentBlocks(content: string): number {
  const { body } = splitAutomationFrontmatter(content);
  if (!body.includes(ALIGNMENT_START)) return 0;
  return body.split(ALIGNMENT_START).length - 1;
}

export function needsAutomationBodyRepair(content: string): boolean {
  const alignmentBlocks = countSkillAlignmentBlocks(content);
  if (alignmentBlocks > 1) return true;
  const revision = readAlignmentRevision(content);
  if (revision >= FACTORY_ALIGNMENT_REVISION) return false;
  return alignmentBlocks === 1;
}

function resolveManagedAutomationName(
  automationName: string,
): FactoryAutomationName | null {
  const seed = canonicalSeedLeafName(automationName);
  if (!seed) return null;
  if (
    seed === "factory-slack-feedback" ||
    seed === "factory-sentry-errors" ||
    seed === "factory-github-issues" ||
    seed === "factory-pr-governance" ||
    seed === "factory-pr-babysit"
  ) {
    return seed;
  }
  return null;
}

export function buildSkillAlignmentBlock(automationName: string): string {
  const managedName = resolveManagedAutomationName(automationName);
  if (!managedName) return "";
  const alignment = managedReviewSkillAlignment(managedName);
  if (!alignment) return "";
  return `${ALIGNMENT_START}\n${alignment.trim()}\n${ALIGNMENT_END}`;
}

export function composeFactoryAutomationBody(options: {
  userPrompt: string;
  automationName: string;
  factoryId: string;
  config: FactoryAutomationConfig;
}): string {
  const userText = normalizeUserPrompt(options.userPrompt);
  const guardrails = wrapGuardrails(
    buildGuardrailsText(options.factoryId, options.config),
  );
  const alignmentBlock = buildSkillAlignmentBlock(options.automationName);
  const parts = [guardrails, alignmentBlock, userText].filter(Boolean);
  return `${parts.join("\n\n")}\n`;
}

function stripAlignmentMarkers(block: string): string {
  return block.replace(ALIGNMENT_START, "").replace(ALIGNMENT_END, "").trim();
}

export function previewAutomationInstructions(options: {
  factoryId: string;
  config: FactoryAutomationConfig;
  automationName: string;
}): { guardrails: string; skillAlignment: string | null } {
  const guardrails = buildGuardrailsText(options.factoryId, options.config);
  const alignmentBlock = buildSkillAlignmentBlock(options.automationName);
  return {
    guardrails,
    skillAlignment: alignmentBlock
      ? stripAlignmentMarkers(alignmentBlock)
      : null,
  };
}

export function computeExecutionPromptHash(body: string): string {
  return createHash("sha256").update(body.trim()).digest("hex");
}

export function replaceAutomationContentWithUserPrompt(
  content: string,
  userPrompt: string,
  automationName: string,
): string {
  const { frontmatter } = splitAutomationFrontmatter(content);
  if (!frontmatter) {
    return normalizeUserPrompt(userPrompt);
  }
  const factoryId = readFrontmatterValue(content, "factoryId") ?? "";
  const config = readFactoryAutomationConfig(content, automationName);
  const body = composeFactoryAutomationBody({
    userPrompt,
    automationName,
    factoryId,
    config,
  });
  return assembleAutomationContent(frontmatter, body);
}

function inferAutomationNameFromContent(content: string): string {
  const templateRaw = readFrontmatterValue(content, "template");
  if (
    templateRaw === "slack-feedback" ||
    templateRaw === "github-issues" ||
    templateRaw === "pr-governance" ||
    templateRaw === "pr-babysit" ||
    templateRaw === "sentry-errors"
  ) {
    return seedNameForTemplate(templateRaw) ?? "factory-slack-feedback";
  }
  return "factory-slack-feedback";
}

/** @deprecated Use replaceAutomationContentWithUserPrompt */
export function replaceUserPrompt(content: string, prompt: string): string {
  return replaceAutomationContentWithUserPrompt(
    content,
    prompt,
    inferAutomationNameFromContent(content),
  );
}

export function templateIdForSeedName(
  name: string,
): FactoryAutomationTemplateId {
  switch (canonicalSeedLeafName(name) ?? factoryAutomationLeafName(name)) {
    case "factory-slack-feedback":
      return "slack-feedback";
    case "factory-github-issues":
      return "github-issues";
    case "factory-pr-governance":
      return "pr-governance";
    case "factory-pr-babysit":
      return "pr-babysit";
    case "factory-sentry-errors":
      return "sentry-errors";
    default:
      return "blank";
  }
}

export function seedNameForTemplate(
  template: FactoryAutomationTemplateId,
): string | null {
  switch (template) {
    case "slack-feedback":
      return "factory-slack-feedback";
    case "github-issues":
      return "factory-github-issues";
    case "pr-governance":
      return "factory-pr-governance";
    case "pr-babysit":
      return "factory-pr-babysit";
    case "sentry-errors":
      return "factory-sentry-errors";
    default:
      return null;
  }
}

export function sourceForTemplate(
  template: FactoryAutomationTemplateId,
): FactoryAutomationSource | null {
  if (template === "blank") return null;
  return TEMPLATE_SOURCE[template];
}

export function slugifyAutomationLeaf(
  source: FactoryAutomationSource,
  name: string,
): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = normalized || "custom";
  return `factory-${source}-${base}`.slice(0, 80);
}
