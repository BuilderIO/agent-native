import {
  factoryAutomationLeafName,
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
  const fromContent = content
    ? (readFrontmatterValue(content, "source") as FactoryAutomationSource)
    : null;
  if (
    fromContent === "slack" ||
    fromContent === "github" ||
    fromContent === "sentry"
  ) {
    return fromContent;
  }
  return LEAF_SOURCE[factoryAutomationLeafName(nameOrPath)] ?? null;
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

function readFrontmatterValue(
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
  const source =
    inferAutomationSource(nameOrPath ?? "", content) ??
    (readFrontmatterValue(content, "source") as FactoryAutomationSource) ??
    "slack";
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

export function applyAutomationConfigFrontmatter(
  content: string,
  config: FactoryAutomationConfig,
): string {
  let next = content;
  const fields: Array<[string, string]> = [
    ["source", config.source],
    ["template", config.template],
    ["slackWorkspace", config.slackWorkspace],
    ["slackChannelId", config.slackChannelId ?? ""],
    ["slackChannelName", config.slackChannelName ?? ""],
    ["repository", config.repository ?? ""],
    ["sentryOrgSlug", config.sentryOrgSlug ?? ""],
    ["sentryProjectSlug", config.sentryProjectSlug ?? ""],
    ["sentryEnvironment", config.sentryEnvironment ?? ""],
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
    next = setAutomationFrontmatterField(next, key, value);
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
      "After classifying each item this run works on, call dispatch-factory-item with clearBug true or false and a short reason so the skip or start is recorded.",
    );
  }
  if (config.source === "slack") {
    lines.push(
      "Never post Slack messages, reactions, or plaintext @handles. If the prompt names a reaction, pass it as reaction on dispatch-factory-item; that action adds it on the source when possible.",
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

export function stripInjectedAutomationBlocks(content: string): string {
  let next = content;
  const guardStart = next.indexOf(GUARDRAILS_START);
  const guardEnd = next.indexOf(GUARDRAILS_END);
  if (guardStart !== -1 && guardEnd !== -1 && guardEnd > guardStart) {
    next = `${next.slice(0, guardStart)}${next.slice(guardEnd + GUARDRAILS_END.length)}`;
  }
  const alignStart = next.indexOf("<!-- factory-skill-alignment:start -->");
  const alignEnd = next.indexOf("<!-- factory-skill-alignment:end -->");
  if (alignStart !== -1 && alignEnd !== -1 && alignEnd > alignStart) {
    next = `${next.slice(0, alignStart)}${next.slice(alignEnd + "<!-- factory-skill-alignment:end -->".length)}`;
  }
  next = next.replace(
    /This automation runs for factory `[^`]+`\. Pass `factoryId: "[^"]+"` on every Factory triage, poll, and config action in this run\.\n*/g,
    "",
  );
  const bodyStart = next.startsWith("---\n") ? next.indexOf("\n---", 4) + 4 : 0;
  if (bodyStart > 3 && next.startsWith("---\n")) {
    return next.slice(bodyStart).trim();
  }
  return next.trim();
}

export function replaceUserPrompt(content: string, prompt: string): string {
  if (!content.startsWith("---\n")) return prompt;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return prompt;
  const frontmatter = content.slice(0, end + 4);
  const factoryId = readFrontmatterValue(content, "factoryId") ?? "";
  const config = readFactoryAutomationConfig(content);
  const guardrails = buildGuardrailsText(factoryId, config);
  const alignmentStart = content.indexOf(
    "<!-- factory-skill-alignment:start -->",
  );
  const alignmentEnd = content.indexOf("<!-- factory-skill-alignment:end -->");
  const alignment =
    alignmentStart !== -1 && alignmentEnd !== -1
      ? content
          .slice(
            alignmentStart,
            alignmentEnd + "<!-- factory-skill-alignment:end -->".length,
          )
          .trim()
      : "";
  const parts = [wrapGuardrails(guardrails), alignment, prompt.trim()].filter(
    Boolean,
  );
  return `${frontmatter}\n\n${parts.join("\n\n")}\n`;
}

export function templateIdForSeedName(
  name: string,
): FactoryAutomationTemplateId {
  switch (factoryAutomationLeafName(name)) {
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
  switch (template) {
    case "slack-feedback":
      return "slack";
    case "github-issues":
    case "pr-governance":
    case "pr-babysit":
      return "github";
    case "sentry-errors":
      return "sentry";
    default:
      return null;
  }
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
