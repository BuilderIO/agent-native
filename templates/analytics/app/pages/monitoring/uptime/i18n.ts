/**
 * Self-contained i18n for the uptime monitoring feature. English is the source
 * of truth; other locales fall back to English per key. Do NOT move these into
 * the shared app i18n — this feature owns its copy.
 */
import { useLocale } from "@agent-native/core/client";

const MESSAGES = {
  "en-US": {
    // Toolbar / list
    searchPlaceholder: "Search monitors…", // i18n-ignore feature-local i18n source
    addMonitor: "Add monitor",
    refresh: "Refresh",
    emptyTitle: "No monitors yet", // i18n-ignore feature-local i18n source
    emptyDescription: // i18n-ignore feature-local i18n source
      "Create a monitor to ping a URL on a schedule and get alerted when it goes down, is too slow, or returns the wrong content.", // i18n-ignore feature-local i18n source
    emptyCta: "Create your first monitor",
    noSearchResults: "No monitors match your search.",
    upCount: "{count} up",
    downCount: "{count} down",
    degradedCount: "{count} degraded",
    checkNow: "Check now",
    lastChecked: "Checked {time}",
    neverChecked: "Never checked",
    latency: "Latency",
    uptime24h: "24h",
    uptime7d: "7d",
    enableLabel: "Toggle {name}",
    ms: "{value} ms",
    // Status labels
    statusUp: "Up",
    statusDown: "Down",
    statusDegraded: "Degraded",
    statusError: "Error",
    statusRunning: "Checking",
    statusUnknown: "Pending",
    // Detail
    back: "Back to monitors",
    edit: "Edit",
    delete: "Delete",
    open: "Open URL",
    runningCheck: "Running check…",
    detailOverview: "Overview",
    currentStatus: "Current status",
    responseTime: "Response time",
    responseTimeSubtitle: "Recent check latency",
    uptimeTimeline: "Uptime",
    uptimeTimelineSubtitle: "Most recent checks (newest on the right)",
    recentChecks: "Recent checks",
    incidents: "Incidents",
    noIncidents: "No incidents recorded. ",
    noChecks: "No checks recorded yet. Run a check to get started.",
    ongoing: "Ongoing",
    resolved: "Resolved",
    duration: "Duration",
    cause: "Cause",
    started: "Started",
    checksFailedLabel: "{count} failed checks",
    configTitle: "Check configuration",
    configInterval: "Interval",
    configTimeout: "Timeout",
    configMethod: "Method",
    configExpected: "Expected status",
    configAssertions: "Assertions",
    configRedirects: "Follow redirects",
    configChannels: "Alert channels",
    configSeverity: "Severity",
    configCooldown: "Cooldown",
    yes: "Yes",
    no: "No",
    noAssertions: "None",
    // Result table
    colTime: "Time",
    colStatus: "Status",
    colCode: "Code",
    colLatency: "Latency",
    colDetails: "Details",
    ok: "OK",
    // Assertion / matcher summaries
    matcherClass: "{classes} responses",
    matcherList: "Status in {codes}",
    matcherRange: "Status {min}–{max}",
    assertBodyContains: "Body contains “{value}”",
    assertBodyAbsent: "Body must not contain “{value}”",
    assertHeaderContains: "Header {header} contains “{value}”",
    assertHeaderEquals: "Header {header} equals “{value}”",
    assertMaxLatency: "Response under {value} ms",
    // Dialog
    dialogCreateTitle: "New monitor",
    dialogEditTitle: "Edit monitor",
    dialogDescription:
      "Probe a URL on a schedule and alert when it fails, is too slow, or the response body is wrong.",
    fieldName: "Name",
    fieldNamePlaceholder: "Marketing site",
    fieldUrl: "URL",
    fieldUrlPlaceholder: "https://example.com/health",
    fieldMethod: "Method",
    fieldInterval: "Check interval",
    fieldTimeout: "Timeout (seconds)",
    fieldExpectedStatus: "Expected status",
    matcherModeClass: "Status class",
    matcherModeList: "Exact codes",
    matcherModeRange: "Range",
    classLabel2xx: "2xx Success",
    classLabel3xx: "3xx Redirect",
    classLabel4xx: "4xx Client error",
    classLabel5xx: "5xx Server error",
    fieldCodes: "Accepted codes",
    fieldCodesPlaceholder: "200, 204",
    fieldRangeMin: "Min",
    fieldRangeMax: "Max",
    fieldAssertions: "Assertions",
    addAssertion: "Add assertion",
    assertionType: "Type",
    assertionValue: "Value",
    assertionHeader: "Header",
    removeAssertion: "Remove assertion",
    assertionsHint:
      "All assertions must pass. Text checks read up to the first 512 KB of the response body.",
    typeBodyContains: "Body contains",
    typeBodyAbsent: "Body absent",
    typeHeaderContains: "Header contains",
    typeHeaderEquals: "Header equals",
    typeMaxLatency: "Max latency (ms)",
    fieldFollowRedirects: "Follow redirects",
    fieldFollowRedirectsHint: "Follow 3xx redirects to allowed hosts.",
    fieldSeverity: "Alert severity",
    severityWarning: "Warning",
    severityCritical: "Critical",
    fieldChannels: "Notify via",
    channelInbox: "Inbox",
    channelEmail: "Email",
    channelSlack: "Slack",
    channelWebhook: "Webhook",
    fieldEmailRecipients: "Email recipients",
    fieldEmailRecipientsPlaceholder: "alerts@example.com, oncall@example.com",
    fieldCooldown: "Alert cooldown (minutes)",
    fieldEnabled: "Enabled",
    fieldEnabledHint: "Run this monitor on its schedule.",
    cancel: "Cancel",
    save: "Save monitor",
    create: "Create monitor",
    saving: "Saving…",
    // Delete dialog
    deleteTitle: "Delete monitor?",
    deleteDescription:
      "This permanently removes “{name}”, its check history, and incident records.",
    deleteConfirm: "Delete",
    // Toasts / validation
    nameRequired: "Give the monitor a name.",
    urlRequired: "Enter an absolute http(s) URL.",
    urlInvalid: "Enter a valid http(s) URL (e.g. https://example.com).",
    channelRequired: "Select at least one alert channel.",
    classRequired: "Select at least one status class.",
    codesRequired: "Enter at least one status code.",
    saved: "Monitor saved.",
    saveFailed: "Could not save monitor: {message}",
    deleted: "Monitor deleted.",
    deleteFailed: "Could not delete monitor: {message}",
    checkStarted: "Running check…",
    checkOk: "{name} is up ({latency} ms).",
    checkDown: "{name} is {status}.",
    checkFailed: "Check failed: {message}",
    enabledToast: "Monitor enabled.",
    disabledToast: "Monitor paused.",
    intervals: {
      "30": "Every 30 seconds",
      "60": "Every minute",
      "300": "Every 5 minutes",
      "600": "Every 10 minutes",
      "900": "Every 15 minutes",
      "1800": "Every 30 minutes",
      "3600": "Every hour",
      "21600": "Every 6 hours",
      "86400": "Daily",
    } as Record<string, string>,
  },
} as const;

type UptimeMessages = (typeof MESSAGES)["en-US"];

export function useUptimeT(): UptimeMessages {
  const { locale } = useLocale();
  return {
    ...MESSAGES["en-US"],
    ...((MESSAGES as Record<string, Partial<UptimeMessages>>)[locale] ?? {}),
  };
}

/** Interpolate {placeholders} in a message template. */
export function fmt(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match,
  );
}
