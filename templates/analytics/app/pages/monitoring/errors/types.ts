/**
 * Client-side mirrors of the error-capture server types
 * (`server/lib/error-capture.ts`). Kept as plain structural types so the panel
 * stays decoupled from the server module.
 */
export type ExceptionLevel = "fatal" | "error" | "warning" | "info" | "debug";

export type IssueStatus = "unresolved" | "resolved" | "ignored";

export type StatusFilter = IssueStatus | "all";

export interface ParsedStackFrame {
  function: string | null;
  file: string | null;
  lineno: number | null;
  colno: number | null;
  inApp: boolean;
  raw: string;
  sourceContext?: SourceContextLine[];
}

export interface SourceContextLine {
  line: number;
  text: string;
  highlight: boolean;
}

export interface ErrorIssueSummary {
  id: string;
  fingerprint: string;
  type: string;
  title: string;
  culprit: string | null;
  level: ExceptionLevel;
  status: IssueStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  usersAffected: number;
  lastSessionRecordingId: string | null;
  lastSessionRecordingPath: string | null;
  assignee: string | null;
  app: string | null;
  template: string | null;
  sparkline: number[];
}

export interface ErrorEventDetail {
  id: string;
  type: string;
  message: string;
  culprit: string | null;
  level: ExceptionLevel;
  stack: ParsedStackFrame[];
  rawStack: string | null;
  handled: boolean;
  url: string | null;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  sessionId: string | null;
  sessionRecordingId: string | null;
  sessionRecordingPath: string | null;
  release: string | null;
  environment: string | null;
  tags: Record<string, unknown>;
  extra: Record<string, unknown>;
  breadcrumbs: unknown[];
  occurredAt: string;
}

export interface ErrorBreadcrumb {
  timestamp?: string;
  category?: string;
  message?: string;
  level?: ExceptionLevel;
}

export interface ErrorIssueDetail {
  issue: ErrorIssueSummary;
  events: ErrorEventDetail[];
  sessions: Array<{ recordingId: string; path: string }>;
}
