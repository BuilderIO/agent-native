/**
 * Self-contained i18n for the Error capture feature. English is the source of
 * truth; other locales fall back to English per key. Do NOT move these into the
 * shared app i18n — this feature owns its copy.
 */
import { useLocale } from "@agent-native/core/client";

const MESSAGES = {
  "en-US": {
    // Toolbar / list
    searchPlaceholder: "Search errors…", // i18n-ignore feature-local i18n source
    refresh: "Refresh",
    sendTestError: "Send test error",
    sending: "Sending…",
    // Filter tabs
    tabUnresolved: "Unresolved",
    tabResolved: "Resolved",
    tabIgnored: "Ignored",
    tabAll: "All",
    // Status labels
    statusUnresolved: "Unresolved",
    statusResolved: "Resolved",
    statusIgnored: "Ignored",
    // Level labels
    levelFatal: "Fatal",
    levelError: "Error",
    levelWarning: "Warning",
    levelInfo: "Info",
    levelDebug: "Debug",
    // List columns / meta
    events: "events",
    users: "users",
    eventCount: "{count} events",
    usersAffected: "{count} users",
    lastSeen: "Last seen {time}",
    firstSeen: "First seen {time}",
    handled: "Handled",
    unhandled: "Unhandled",
    // Empty state
    emptyTitle: "No errors captured yet", // i18n-ignore feature-local i18n source
    emptyDescription:
      "Your app's analytics SDK automatically captures uncaught exceptions and unhandled promise rejections, groups them into issues, and links each one to the session replay where it happened.",
    emptySearch: "No errors match your filter.",
    installTitle: "Enable error capture",
    docs: "Docs",
    // Detail
    back: "Back to errors",
    resolve: "Resolve",
    reopen: "Reopen",
    ignore: "Ignore",
    unignore: "Unignore",
    watchReplay: "Watch session replay",
    overview: "Overview",
    metaFirstSeen: "First seen",
    metaLastSeen: "Last seen",
    metaEvents: "Events",
    metaUsers: "Users affected",
    metaEnvironment: "Environment",
    metaRelease: "Release",
    frequency: "Error frequency",
    frequencyWindow: "Last {days} days",
    frequencyBarLabel: "{count} occurrences on {date}",
    recentOccurrences: "recent",
    noRecentVolume: "No recent volume",
    latestOccurrence: "Latest occurrence",
    message: "Message",
    url: "URL",
    occurrenceTime: "Occurred",
    stackTrace: "Stack trace",
    stackFrameCount: "{count} frames",
    rawStack: "Raw stack",
    noStack: "No stack trace was captured for this error.",
    inApp: "In app",
    vendor: "Vendor",
    breadcrumbs: "Breadcrumbs",
    noBreadcrumbs: "No breadcrumbs were captured before this error.",
    occurrences: "Recent occurrences",
    noOccurrences: "No occurrences recorded yet.",
    occurredAt: "Occurred {time}",
    anonymous: "Anonymous",
    tags: "Tags",
    additionalData: "Additional data",
    loadFailed: "Could not load errors: {message}",
    detailLoadFailed: "Could not load this error: {message}",
    // Cross-links from session recordings
    viewIssue: "View issue",
    viewIssueTooltip:
      "Open this error's issue — how many users hit it, the stack trace, and recent occurrences",
    searchIssues: "Find similar",
    searchIssuesTooltip:
      "Search Monitoring for all captured issues matching this console error",
    // Toasts
    resolvedToast: "Issue resolved.",
    reopenedToast: "Issue reopened.",
    ignoredToast: "Issue ignored.",
    updateFailed: "Could not update issue: {message}",
    testSentToast: "Sent a test error. It should appear in the list shortly.",
    testFailed: "Could not send a test error: {message}",
  },
} as const;

type ErrorMessages = (typeof MESSAGES)["en-US"];

export function useErrorsT(): ErrorMessages {
  const { locale } = useLocale();
  return {
    ...MESSAGES["en-US"],
    ...((MESSAGES as Record<string, Partial<ErrorMessages>>)[locale] ?? {}),
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
