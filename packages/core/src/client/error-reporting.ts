import {
  getFeedbackClientContext,
  type FeedbackClientContext,
  type FeedbackClientContextOptions,
} from "./feedback-context.js";

const GITHUB_ISSUE_URL = "https://github.com/BuilderIO/agent-native/issues/new";

export interface ErrorReportDebugItem {
  label: string;
  value?: unknown;
}

export interface ErrorReportTemplateOptions {
  title?: string | null;
  details?: string | null;
  status?: number | string | null;
  appName?: string | null;
  prompt?: string;
  issueTitle?: string;
  feedbackContext?: FeedbackClientContext;
  contextOptions?: FeedbackClientContextOptions;
  extraDebug?: ErrorReportDebugItem[];
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function resolveContext(
  options: ErrorReportTemplateOptions,
): FeedbackClientContext {
  return (
    options.feedbackContext ?? getFeedbackClientContext(options.contextOptions)
  );
}

function debugLines(options: ErrorReportTemplateOptions): string[] {
  const context = resolveContext(options);
  const lines: string[] = [];
  const appName = cleanText(options.appName);
  const title = cleanText(options.title);
  const details = cleanText(options.details);
  const status = cleanText(options.status);

  if (appName) lines.push(`App: ${appName}`);
  if (status) lines.push(`Status: ${status}`);
  if (title) lines.push(`Screen: ${title}`);
  if (details && details !== title) lines.push(`Error: ${details}`);
  if (context.pageUrl) lines.push(`Page: ${context.pageUrl}`);
  if (context.clientSurface) lines.push(`Source: ${context.clientSurface}`);
  if (context.activeRunId) lines.push(`Run: ${context.activeRunId}`);
  if (context.chatSessionIds.length === 1) {
    lines.push(`Chat session: ${context.chatSessionIds[0]}`);
  } else if (context.chatSessionIds.length > 1) {
    lines.push(`Chat sessions: ${context.chatSessionIds.join(", ")}`);
  }
  for (const item of options.extraDebug ?? []) {
    const value = cleanText(item.value);
    if (value) lines.push(`${item.label}: ${value}`);
  }
  return lines;
}

export function buildErrorReportTemplate(
  options: ErrorReportTemplateOptions,
): string {
  const lines = debugLines(options);
  return [
    options.prompt ?? "Describe what happened here:",
    "",
    "",
    "---",
    "Debug info:",
    ...(lines.length ? lines : ["No client debug info available."]),
  ].join("\n");
}

export function buildGitHubIssueUrl(
  options: ErrorReportTemplateOptions,
): string {
  const title =
    cleanText(options.issueTitle) ??
    [
      cleanText(options.appName) ?? "Agent Native",
      cleanText(options.title) ?? "Error screen",
    ].join(": ");
  const url = new URL(GITHUB_ISSUE_URL);
  url.searchParams.set("title", title.slice(0, 180));
  url.searchParams.set(
    "body",
    buildErrorReportTemplate({
      ...options,
      prompt: options.prompt ?? "Describe your issue here:",
    }),
  );
  return url.toString();
}
