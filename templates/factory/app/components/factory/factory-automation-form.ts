export type AutomationSource = "slack" | "github" | "sentry";
export type AutomationAuthorFilter = "none" | "include" | "exclude";
export type AutomationAuthorMode = "include" | "exclude";
export type AutomationScheduleMode = "interval" | "daily";
export type AutomationTemplateId =
  | "blank"
  | "slack-feedback"
  | "github-issues"
  | "pr-governance"
  | "pr-babysit"
  | "sentry-errors";

export const INTERVAL_MINUTES = [5, 10, 15, 30, 60] as const;

export type FactoryAutomationConnections = {
  slack: boolean;
  slackSecondary?: boolean;
  github: boolean;
  sentry: boolean;
};

export type FactoryAutomationFormState = {
  displayName: string;
  source: AutomationSource | null;
  template: AutomationTemplateId;
  slackWorkspace: "primary" | "secondary";
  slackChannelId: string;
  slackChannelName: string;
  repository: string;
  sentryOrgSlug: string;
  sentryProjectSlug: string;
  sentryEnvironment: string;
  authorFilter: AutomationAuthorFilter;
  authorIds: string[];
  scheduleMode: AutomationScheduleMode;
  intervalMinutes: (typeof INTERVAL_MINUTES)[number];
  dailyTime: string;
  timezone: string;
  inboxLimit: number;
  workLimit: number;
  prompt: string;
  enabled: boolean;
};

export function defaultWorkLimit(source: AutomationSource | null): number {
  return source === "slack" ? 5 : 3;
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function emptyAutomationForm(
  source: AutomationSource | null = null,
): FactoryAutomationFormState {
  return {
    displayName: "",
    source,
    template: "blank",
    slackWorkspace: "primary",
    slackChannelId: "",
    slackChannelName: "",
    repository: "",
    sentryOrgSlug: "",
    sentryProjectSlug: "",
    sentryEnvironment: "",
    authorFilter: "none",
    authorIds: [],
    scheduleMode: "interval",
    intervalMinutes: 5,
    dailyTime: "09:00",
    timezone: browserTimezone(),
    inboxLimit: 25,
    workLimit: defaultWorkLimit(source),
    prompt: "",
    enabled: false,
  };
}

export function formAuthorFilter(
  mode: AutomationAuthorMode | null | undefined,
  ids: readonly string[] | undefined,
): AutomationAuthorFilter {
  const authorIds = ids ?? [];
  if (mode === "include" && authorIds.length > 0) return "include";
  if (mode === "exclude" && authorIds.length > 0) return "exclude";
  return "none";
}

export function persistAuthorFilter(
  filter: AutomationAuthorFilter,
  ids: readonly string[],
): { authorMode: AutomationAuthorMode; authorIds: string[] } {
  if (filter === "include") {
    return { authorMode: "include", authorIds: [...ids] };
  }
  if (filter === "exclude") {
    return { authorMode: "exclude", authorIds: [...ids] };
  }
  return { authorMode: "exclude", authorIds: [] };
}

export function parseDailyTime(value: string): {
  dailyHour: number;
  dailyMinute: number;
} {
  const [hour = "9", minute = "0"] = value.split(":");
  return {
    dailyHour: Math.min(23, Math.max(0, Number(hour) || 0)),
    dailyMinute: Math.min(59, Math.max(0, Number(minute) || 0)),
  };
}

export function formatDailyTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isDestinationReady(
  source: AutomationSource | null,
  connections?: FactoryAutomationConnections,
  slackWorkspace: "primary" | "secondary" = "primary",
): boolean {
  if (!source || !connections) return false;
  if (source === "slack") {
    return slackWorkspace === "secondary"
      ? connections.slackSecondary === true
      : connections.slack === true;
  }
  return connections[source] === true;
}

export function isConnectorExplicitlyMissing(
  source: AutomationSource | null,
  connections?: FactoryAutomationConnections,
  slackWorkspace: "primary" | "secondary" = "primary",
): boolean {
  if (!source || !connections) return false;
  if (source === "slack") {
    return slackWorkspace === "secondary"
      ? connections.slackSecondary === false
      : connections.slack === false;
  }
  return connections[source] === false;
}

export function isDestinationFilled(
  form: Pick<
    FactoryAutomationFormState,
    | "source"
    | "slackChannelId"
    | "repository"
    | "sentryOrgSlug"
    | "sentryProjectSlug"
  >,
): boolean {
  if (form.source === "slack") return Boolean(form.slackChannelId.trim());
  if (form.source === "github") return Boolean(form.repository.trim());
  if (form.source === "sentry") {
    return (
      Boolean(form.sentryOrgSlug.trim()) &&
      Boolean(form.sentryProjectSlug.trim())
    );
  }
  return false;
}

type FactoryAutomationConfigQuery = {
  error?: unknown;
  data?: {
    connections?: FactoryAutomationConnections;
    readinessError?: string | null;
  };
};

export function factoryAutomationConnectionsFromConfig(
  query: FactoryAutomationConfigQuery,
): FactoryAutomationConnections | undefined {
  if (query.error || query.data?.readinessError) return undefined;
  return query.data?.connections;
}

export function factoryAutomationReadinessFailed(
  query: FactoryAutomationConfigQuery,
): boolean {
  return Boolean(query.error || query.data?.readinessError);
}

export function canCreateFactoryAutomation(
  form: FactoryAutomationFormState,
  connections?: FactoryAutomationConnections,
): boolean {
  if (!form.source || !form.displayName.trim()) return false;
  if (form.authorFilter === "include" && form.authorIds.length === 0) {
    return false;
  }
  if (!isDestinationFilled(form)) return false;
  if (!form.enabled) return true;
  return isDestinationReady(form.source, connections, form.slackWorkspace);
}

export function canSaveFactoryAutomation(
  form: FactoryAutomationFormState,
  connections?: FactoryAutomationConnections,
): boolean {
  if (!form.displayName.trim()) return false;
  if (!form.enabled) return true;
  return canCreateFactoryAutomation(form, connections);
}

function stripDispatchLeaf(href: string): string {
  return href.replace(/\/(?:overview|apps)\/?$/, "");
}

export function dispatchIntegrationsHref(apps: unknown): string {
  const list = Array.isArray(apps) ? apps : [];
  const dispatch = list.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "isDispatch" in entry &&
      (entry as { isDispatch?: boolean }).isDispatch === true,
  ) as
    | {
        href?: string | null;
        url?: string | null;
        path?: string | null;
      }
    | undefined;
  const raw =
    dispatch?.href?.trim() ||
    dispatch?.url?.trim() ||
    dispatch?.path?.trim() ||
    "/dispatch";
  try {
    const absolute = /^https?:\/\//.test(raw);
    const url = new URL(raw, "https://workspace.local");
    const basePath = stripDispatchLeaf(url.pathname).replace(/\/+$/, "");
    url.pathname = `${basePath || (absolute ? "" : "/dispatch")}/admin/integrations`;
    url.search = "";
    url.hash = "";
    if (absolute) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const basePath = stripDispatchLeaf(raw).replace(/\/+$/, "");
    return `${basePath || "/dispatch"}/admin/integrations`;
  }
}

export function timezoneOptions(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;
  const supported = supportedValuesOf ? supportedValuesOf("timeZone") : [];
  const detected = browserTimezone();
  return [...new Set([detected, ...supported])];
}
