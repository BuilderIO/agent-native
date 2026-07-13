import type { Icon } from "@tabler/icons-react";
import {
  IconBrain,
  IconBook2,
  IconChecks,
  IconDatabase,
  IconFileText,
  IconMessageQuestion,
  IconSettings,
} from "@tabler/icons-react";

export type BrainView =
  | "ask"
  | "extensions"
  | "search"
  | "knowledge"
  | "review"
  | "sources"
  | "ops"
  | "agent"
  | "settings";

export type KnowledgeStatus = "approved" | "needs_review" | "draft" | "stale";
export type SourceHealth = "healthy" | "degraded" | "paused" | "error";
export type ReviewPriority = "high" | "medium" | "low";

export interface Citation {
  id: string;
  title: string;
  sourceName: string;
  excerpt: string;
  confidence?: number;
  url?: string | null;
  updatedAt?: string | null;
}

export interface AskBrainResponse {
  answer: string;
  citations: Citation[];
  followUps?: string[];
}

export interface BrainMetric {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}

export interface KnowledgeRow {
  id: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  sourceName?: string;
  sourceId?: string;
  sourceType?: string;
  topic?: string;
  status: KnowledgeStatus | "published" | "redacted" | "archived";
  confidence?: number;
  citations?: number;
  evidence?: Array<{
    captureId?: string | null;
    captureTitle?: string | null;
    quote?: string | null;
    note?: string | null;
    sourceUrl?: string | null;
    url?: string | null;
    timestampMs?: number | null;
  }>;
  publishedResourcePath?: string | null;
  publishTier?: "private" | "team" | "company" | string;
  updatedAt?: string | null;
  owner?: string | null;
}

export interface ReviewItem {
  id: string;
  knowledgeId?: string | null;
  title: string;
  proposedAnswer?: string;
  body?: string;
  sourceName?: string;
  sourceId?: string | null;
  captureId?: string | null;
  reason?: string;
  rationale?: string | null;
  priority?: ReviewPriority;
  proposedAction?: "create" | "update" | "archive";
  payload?: Record<string, unknown>;
  evidence?: Array<{
    captureId?: string | null;
    captureTitle?: string | null;
    quote?: string | null;
    note?: string | null;
    sourceUrl?: string | null;
    url?: string | null;
    timestampMs?: number | null;
  }>;
  status?: "pending" | "queued" | "approved" | "rejected" | "needs_changes";
  visibility?: string;
  reviewerNotes?: string | null;
  createdBy?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface BrainSource {
  id: string;
  name?: string;
  title?: string;
  type?: string;
  provider?: string;
  description?: string;
  health?: SourceHealth;
  status?: "active" | "paused" | "archived" | "error";
  enabled?: boolean;
  recordCount?: number;
  coverage?: number;
  lastSyncAt?: string | null;
  lastSyncedAt?: string | null;
  nextSyncAt?: string | null;
  reviewRequired?: boolean;
  config?: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  lastError?: string | null;
  latestRun?: {
    id: string;
    status: "running" | "success" | "error";
    stats?: Record<string, unknown>;
    error?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  } | null;
}

export interface BrainOverviewResponse {
  metrics?: BrainMetric[];
  reviewQueue?: ReviewItem[];
  sources?: BrainSource[];
  knowledge?: KnowledgeRow[];
}

export interface KnowledgeResponse {
  rows?: KnowledgeRow[];
  knowledge?: KnowledgeRow[];
  facets?: {
    sourceTypes?: string[];
    sources?: string[];
    statuses?: KnowledgeStatus[];
  };
}

export type SearchResultType = "knowledge" | "capture" | "source" | string;

export interface SearchEverythingResult {
  id: string;
  type: SearchResultType;
  title: string;
  snippet?: string | null;
  summary?: string | null;
  provider?: string | null;
  source?: {
    id: string;
    title: string;
    provider: string;
    status?: string | null;
  } | null;
  sourceTitle?: string | null;
  sourceProvider?: string | null;
  sourceUrl?: string | null;
  citation?: {
    captureId?: string | null;
    captureTitle?: string | null;
    quote?: string | null;
    sourceUrl?: string | null;
  } | null;
  status?: string | null;
  url?: string | null;
  confidence?: number | null;
  updatedAt?: string | null;
  score?: number | null;
}

export interface SearchEverythingResponse {
  count?: number;
  results?: SearchEverythingResult[];
  items?: SearchEverythingResult[];
  rows?: SearchEverythingResult[];
  knowledge?: KnowledgeRow[];
  facets?: {
    types?: string[];
    providers?: string[];
    statuses?: string[];
  };
}

export interface ReviewQueueResponse {
  count?: number;
  items?: ReviewItem[];
  proposals?: ReviewItem[];
}

export interface SourcesResponse {
  sources?: BrainSource[];
}

export type BrainSourceHealthState =
  | "healthy"
  | "needs_setup"
  | "needs_sync"
  | "stale"
  | "paused"
  | "error";

export interface BrainHealthStep {
  id: string;
  label: string;
  detail: string;
  status: "done" | "next" | "todo";
  href?: string;
  action?: string;
}

export interface BrainHealthResponse {
  generatedAt: string;
  sources: {
    total: number;
    configured: number;
    active: number;
    healthy: number;
    needsSetup: number;
    needsSync: number;
    stale: number;
    paused: number;
    error: number;
    lastSyncedAt?: string | null;
    latestRunAt?: string | null;
    byProvider?: Array<{ provider: string; count: number }>;
    attention?: Array<{
      id: string;
      title: string;
      provider: string;
      status: string;
      health: BrainSourceHealthState;
      demo?: boolean;
      autoSync?: boolean;
      reviewRequired?: boolean;
      hasChannelAllowList?: boolean | null;
      lastSyncedAt?: string | null;
      nextSyncAt?: string | null;
      lastError?: string | null;
      latestRun?: {
        id: string;
        status: "running" | "success" | "error" | string;
        startedAt?: string | null;
        completedAt?: string | null;
        error?: string | null;
      } | null;
    }>;
  };
  connections: {
    available: boolean;
    error?: string | null;
    connectedProviders: number;
    configuredProviders: number;
    providers?: Array<{
      id: string;
      label: string;
      configuredSources: number;
      connected: boolean;
      grantState: string;
      activeConnectionCount: number;
      grantedConnectionCount: number;
      unhealthyGrantedConnectionCount: number;
    }>;
  };
  captures: {
    total: number;
    lastCapturedAt?: string | null;
    counts?: Record<string, number>;
  };
  proposals: {
    pending: number;
    approved: number;
    rejected: number;
    total: number;
    counts?: Record<string, number>;
  };
  knowledge: {
    published: number;
    draft: number;
    redacted: number;
    archived: number;
    total: number;
    counts?: Record<string, number>;
  };
  distillationQueue: {
    pending: number;
    failed: number;
    stale: number;
    total: number;
    counts?: Record<string, number>;
  };
  retrieval: {
    lastEval?: {
      mode: "product-demo" | "retrieval" | string;
      seedId?: string;
      dataset?: string;
      dataMode?: string;
      ok: boolean;
      passed: number;
      total: number;
      score: number;
      workspaceHadSupport?: boolean;
      fallbackSeeded?: boolean;
      ranAt: string;
    } | null;
    suggestedQuestions?: string[];
  };
  setup: {
    firstRun: boolean;
    completed: number;
    total: number;
    steps: BrainHealthStep[];
    nextSteps: string[];
  };
}

export interface BrainConnectionProviderCredentialKey {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export type BrainWorkspaceConnectionGrantState =
  | "connected"
  | "granted"
  | "needs_grant"
  | "not_connected";

export type BrainWorkspaceConnectionStatus =
  | "connected"
  | "checking"
  | "needs_reauth"
  | "error"
  | "disabled";

export interface BrainWorkspaceCredentialRef {
  key: string;
  scope?: "user" | "org" | "workspace";
  provider?: string;
  label?: string;
  source?: "connection" | "grant";
}

export type BrainWorkspaceConnectionAppAccessMode =
  | "all-apps"
  | "allowed-app"
  | "explicit-grant"
  | "unavailable";

export interface BrainWorkspaceConnectionAppAccess {
  appId: "brain";
  available: boolean;
  mode: BrainWorkspaceConnectionAppAccessMode;
  reason: string;
  grantId: string | null;
}

export interface BrainWorkspaceConnectionSummaryConnection {
  id: string;
  label: string;
  provider: string;
  accountId: string | null;
  accountLabel: string | null;
  status: BrainWorkspaceConnectionStatus;
  grantedToApp: boolean;
  grantScope: "all-apps" | "selected-apps";
  appAccess?: BrainWorkspaceConnectionAppAccess;
  allowedApps: string[];
  credentialRefs: BrainWorkspaceCredentialRef[];
  lastCheckedAt: string | null;
  lastError: string | null;
  explicitGrant: {
    id: string;
    appId: string;
    scopes: string[];
    credentialRefs: BrainWorkspaceCredentialRef[];
    updatedAt: string;
  } | null;
}

export interface BrainWorkspaceConnectionSummary {
  appId: "brain";
  grantState: BrainWorkspaceConnectionGrantState;
  grantAvailability?: "available" | "needs_grant" | "not_connected";
  grantAvailabilityMessage?: string;
  connectionCount: number;
  grantedConnectionCount: number;
  activeConnectionCount: number;
  ungrantedConnectionCount?: number;
  unhealthyGrantedConnectionCount?: number;
  explicitGrantCount?: number;
  credentialRefCount: number;
  hasWorkspaceConnection: boolean;
  hasGrantedWorkspaceConnection: boolean;
  hasActiveWorkspaceConnection: boolean;
  statuses: BrainWorkspaceConnectionStatus[];
  connections: BrainWorkspaceConnectionSummaryConnection[];
}

export interface BrainCredentialProvenance {
  source: "workspace_connection" | "brain_local" | "registered_secret";
  key: string;
  provider: string;
  scope?: "user" | "org" | "workspace";
  connectionId?: string;
  connectionLabel?: string;
  grantId?: string | null;
  appAccessMode?: BrainWorkspaceConnectionAppAccessMode;
  credentialRefLabel?: string;
}

export interface BrainCredentialAvailability {
  provider: string;
  key: string;
  available: boolean;
  provenance: BrainCredentialProvenance | null;
  checked: Array<{
    source: "workspace_connection" | "brain_local" | "registered_secret";
    key: string;
    status: "available" | "missing" | "not_granted" | "unhealthy" | "error";
    message: string;
    scope?: "user" | "org" | "workspace";
    connectionId?: string;
    connectionLabel?: string;
    grantId?: string | null;
    appAccessMode?: BrainWorkspaceConnectionAppAccessMode;
  }>;
  missingMessage: string | null;
}

export interface BrainCredentialHealth {
  status: "available" | "missing" | "not_required" | "unavailable";
  available: boolean;
  requiredKeyCount: number;
  availableKeyCount: number;
  missingCredentialKeys: string[];
  missingMessages: string[];
  details: BrainCredentialAvailability[];
}

export interface BrainProviderHealth {
  status:
    | "ready"
    | "needs_grant"
    | "unhealthy"
    | "missing_credentials"
    | "unsupported";
  message: string;
}

export interface BrainConnectionProvider {
  id: string;
  label: string;
  description: string;
  capabilities: string[];
  credentialKeys: BrainConnectionProviderCredentialKey[];
  configuredSourceCount: number;
  hasConfiguredSources: boolean;
  sourceProviderSupported: boolean;
  credentialHealth?: BrainCredentialHealth;
  providerHealth?: BrainProviderHealth;
  workspaceConnection?: BrainWorkspaceConnectionSummary;
}

export interface ConnectionProvidersResponse {
  count?: number;
  appId?: "brain";
  workspaceConnections?: {
    appId: "brain";
    available: boolean;
    error: string | null;
  };
  providers?: BrainConnectionProvider[];
}

export type BrainCaptureReviewStatus =
  | "queued"
  | "distilling"
  | "distilled"
  | "ignored";

export interface BrainDistillationQueue {
  id: string;
  sourceId?: string | null;
  captureId?: string | null;
  status: "queued" | "processing" | "done" | "failed";
  priority?: number;
  attempts?: number;
  error?: string | null;
  runAfter?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type BrainDistillationQueueStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed";

export interface BrainOpsQueueItem {
  id: string;
  sourceId: string | null;
  captureId: string | null;
  status: BrainDistillationQueueStatus;
  priority: number;
  attempts: number;
  lastError?: string | null;
  runAfter?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  staleProcessing: boolean;
  retryable: boolean;
  source: {
    id: string | null;
    title: string;
    provider: string;
    status: string;
  };
  capture: {
    id: string | null;
    title: string;
    status: string;
  };
}

export interface BrainOpsQueueSummary {
  total: number;
  queued: number;
  processing: number;
  done: number;
  failed: number;
  staleProcessing: number;
  retryable: number;
}

export interface BrainOpsQueueResponse {
  count?: number;
  staleProcessingCutoff?: string;
  summary?: BrainOpsQueueSummary;
  items?: BrainOpsQueueItem[];
}

export interface RetryDistillationResponse {
  retried: boolean;
  staleProcessing: boolean;
  queueItem: BrainDistillationQueue | null;
  capture: {
    id: string;
    sourceId: string;
    title: string;
    status: "distilling";
  };
}

export type EnqueueCapturesDistillationOutcome =
  | "queued"
  | "existing"
  | "error";

export interface EnqueueCapturesDistillationResult {
  captureId: string;
  sourceId?: string | null;
  outcome: EnqueueCapturesDistillationOutcome;
  existing?: boolean;
  queueItem?: BrainDistillationQueue;
  captureStatus?: BrainCaptureReviewStatus;
  code?:
    | "inaccessible"
    | "already-distilled"
    | "already-ignored"
    | "queue-failed"
    | string;
  error?: string;
}

export interface EnqueueCapturesDistillationResponse {
  requested: number;
  queued: number;
  existing: number;
  errors: number;
  results: EnqueueCapturesDistillationResult[];
  guidance?: NonNullable<SettingsResponse["guidance"]>["distillation"];
}

export interface BrainCaptureReviewItem {
  id: string;
  sourceId: string;
  source?: {
    id: string;
    title: string;
    provider: string;
    status: string;
  };
  externalId?: string | null;
  title: string;
  kind: string;
  status: BrainCaptureReviewStatus;
  capturedAt: string;
  sourceUrl?: string | null;
  distillationQueue?: BrainDistillationQueue | null;
  preview?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CapturesResponse {
  count?: number;
  captures?: BrainCaptureReviewItem[];
}

export interface SlackConnectionResponse {
  ok: boolean;
  sourceId?: string | null;
  team?: string | null;
  teamId?: string | null;
  workspaceUrl?: string | null;
  botUser?: string | null;
  checkedChannels: number;
  historyRead: false;
  channels: Array<{
    ref: string;
    id?: string;
    name?: string;
    status: "ok" | "excluded" | "missing" | "skipped";
    message: string;
    directExcluded?: boolean;
    archived?: boolean;
    privateChannel?: boolean;
  }>;
}

export interface SlackPilotReport {
  sourceId: string;
  sourceTitle: string;
  ok: boolean;
  status: "validated" | "blocked" | "synced" | "error";
  historyRead: boolean;
  credential: {
    ok: boolean;
    team?: string | null;
    teamId?: string | null;
    workspaceUrl?: string | null;
    botUser?: string | null;
    error?: string | null;
  };
  guardrails: {
    historyReadRequested: boolean;
    maxChannels: number;
    historyLimit: number;
    pagesPerChannel: number;
    permalinkLimit: number;
    autoSync: false;
    oldest?: string;
  };
  channelValidation: {
    requested: number;
    checked: number;
    ok: number;
    excluded: number;
    missing: number;
    skipped: number;
    channels: Array<{
      ref: string;
      id?: string;
      name?: string;
      status: "ok" | "excluded" | "missing" | "skipped";
      message: string;
      directExcluded?: boolean;
      archived?: boolean;
      privateChannel?: boolean;
    }>;
  };
  sync?: {
    runId: string;
    status: "success" | "error";
    message: string;
    stats?: Record<string, unknown>;
  };
  capturesCreated: number;
  captures: Array<{
    id: string;
    title: string;
    capturedAt: string;
    sourceUrl?: string | null;
  }>;
  proposals: {
    total: number;
    pending: number;
    recent: Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
    }>;
  };
  currentKnowledge: {
    total: number;
    published: number;
    draft: number;
    redacted: number;
    archived: number;
    recent: Array<{
      id: string;
      title: string;
      status: string;
      updatedAt: string;
    }>;
  };
  privacyExclusions: string[];
  nextSteps: string[];
}

export interface BrainPilotReportStatusCounts {
  total: number;
  other: number;
  queued?: number;
  distilling?: number;
  distilled?: number;
  ignored?: number;
  processing?: number;
  done?: number;
  failed?: number;
  published?: number;
  redacted?: number;
  draft?: number;
  archived?: number;
  pending?: number;
  approved?: number;
  rejected?: number;
}

export interface BrainPilotReport {
  source: BrainSource;
  accessRole: string;
  generatedAt: string;
  latestSyncRun: {
    id: string;
    provider: string;
    status: "running" | "success" | "error" | string;
    stats?: Record<string, unknown>;
    error?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  } | null;
  captures: {
    counts: BrainPilotReportStatusCounts;
    recent?: Array<{
      id: string;
      title: string;
      kind: string;
      status: BrainCaptureReviewStatus;
      capturedAt: string;
      sourceUrl?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
    }>;
  };
  distillationQueue: {
    counts: BrainPilotReportStatusCounts;
    stale: {
      total: number;
      processing: number;
      overdueQueued: number;
    };
    recent?: Array<{
      id: string;
      captureId?: string | null;
      status: BrainDistillationQueueStatus;
      attempts?: number;
      error?: string | null;
      runAfter?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
    }>;
  };
  knowledge: {
    counts: BrainPilotReportStatusCounts;
    recent?: Array<{
      id: string;
      title: string;
      kind: string;
      status: KnowledgeStatus | "published" | "redacted" | "archived";
      confidence?: number | null;
      summary?: string | null;
      sourceUrl?: string | null;
      publishedResourcePath?: string | null;
      publishedAt?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
    }>;
  };
  proposals: {
    counts: BrainPilotReportStatusCounts;
    recent?: Array<{
      id: string;
      knowledgeId?: string | null;
      captureId?: string | null;
      title: string;
      proposedAction?: string | null;
      status: "pending" | "approved" | "rejected" | string;
      rationale?: string | null;
      sourceUrl?: string | null;
      reviewerNotes?: string | null;
      reviewedAt?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
    }>;
  };
  privacyNotes: string[];
  recommendedNextSteps: string[];
  pilotTrustLane?: {
    targetChannel: string;
    status:
      | "blocked"
      | "ready-to-sample"
      | "needs-distillation"
      | "needs-review"
      | "needs-eval"
      | "ready-to-expand";
    label: string;
    summary: string;
    checks: Array<{
      id: string;
      label: string;
      status: "ok" | "pending" | "attention";
      detail: string;
    }>;
    nextActions: Array<{
      action: string;
      args: Record<string, unknown>;
      why: string;
    }>;
    evalQuestions: string[];
  };
}

export interface BrainSettings {
  companyName?: string;
  assistantName?: string;
  assistantTone?: "direct" | "friendly" | "formal" | "technical";
  sourcePolicy?: "strict" | "balanced" | "exploratory";
  requireApprovalForCompanyKnowledge?: boolean;
  autoRedactEmails?: boolean;
  defaultPublishTier?: "private" | "team" | "company";
  distillationInstructions?: string;
  captureSanitizationEnabled?: boolean;
  captureSanitizationModel?: string;
  captureSanitizationInstructions?: string;
  connectorPollMinutes?: number;
  requireCitations?: boolean;
  autoArchiveResolved?: boolean;
  notifyOnSourceErrors?: boolean;
}

export interface SettingsResponse {
  settings?: BrainSettings;
  guidance?: {
    identity: {
      assistantName: string;
      companyName: string | null;
      tone: NonNullable<BrainSettings["assistantTone"]>;
    };
    retrieval: {
      sourcePolicy: NonNullable<BrainSettings["sourcePolicy"]>;
      requireCitations: boolean;
      approvedKnowledgeFirst: boolean;
      rawCaptureFallback: "never-answer" | "thin-results" | "allowed-leads";
      instructions: string[];
    };
    distillation: {
      defaultPublishTier: NonNullable<BrainSettings["defaultPublishTier"]>;
      requireApprovalForCompanyKnowledge: boolean;
      autoRedactEmails: boolean;
      instructions: string;
      rules: string[];
    };
    captureSanitization: {
      enabled: boolean;
      model: string | null;
      instructions: string;
      rules: string[];
    };
    response: {
      toneInstruction: string;
      citationInstruction: string;
    };
  };
}

export const navItems: Array<{
  view: BrainView;
  label: string;
  href: string;
  icon: Icon;
}> = [
  { view: "ask", label: "Ask", href: "/", icon: IconMessageQuestion },
  { view: "sources", label: "Sources", href: "/sources", icon: IconDatabase },
  { view: "review", label: "Review", href: "/review", icon: IconChecks },
  {
    view: "knowledge",
    label: "Knowledge",
    href: "/knowledge",
    icon: IconBook2,
  },
  {
    view: "settings",
    label: "Settings",
    href: "/settings",
    icon: IconSettings,
  },
  {
    view: "agent",
    label: "Agent settings",
    href: "/agent",
    icon: IconBrain,
  },
];

export const defaultSettings: BrainSettings = {
  companyName: "",
  assistantName: "Brain",
  assistantTone: "direct",
  sourcePolicy: "balanced",
  requireApprovalForCompanyKnowledge: true,
  autoRedactEmails: true,
  defaultPublishTier: "company",
  distillationInstructions:
    "Distill durable, reusable institutional knowledge. Preserve short direct quotes as evidence.",
  captureSanitizationEnabled: true,
  captureSanitizationModel: "",
  captureSanitizationInstructions:
    "Keep durable company-relevant information and remove personal, recruiting, hiring, candidate-evaluation, sensitive, or casual content before storage.",
  connectorPollMinutes: 60,
  requireCitations: true,
  autoArchiveResolved: true,
  notifyOnSourceErrors: true,
};

export function viewFromPath(pathname: string): BrainView {
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/sources")) return "sources";
  if (pathname.startsWith("/ops")) return "ops";
  if (pathname.startsWith("/agent")) return "agent";
  if (pathname.startsWith("/settings")) return "settings";
  return "ask";
}

export function pathFromView(view?: string): string {
  switch (view) {
    case "extensions":
      return "/extensions";
    case "search":
      return "/search";
    case "knowledge":
      return "/knowledge";
    case "review":
      return "/review";
    case "sources":
      return "/sources";
    case "ops":
      return "/ops";
    case "agent":
      return "/agent";
    case "settings":
      return "/settings";
    case "ask":
    default:
      return "/";
  }
}

export function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  const pct = value > 1 ? value : value * 100;
  return `${Math.round(pct)}%`;
}

export function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

export function sourceName(source: BrainSource) {
  return source.name ?? source.title ?? "Untitled source";
}

export function sourceType(source: BrainSource) {
  return source.type ?? source.provider ?? "generic";
}

export function sourceDescription(source: BrainSource) {
  if (source.description) return source.description;
  switch (source.provider) {
    case "slack":
      return "Approved Slack channels for product decisions, launches, support signals, and operating context.";
    case "granola":
      return "Granola Team-space notes and transcripts imported through the Enterprise API.";
    case "github":
      return "GitHub repository issues and pull requests imported as company context.";
    case "clips":
      return "Meeting recordings and transcripts exported from Clips into Brain.";
    case "generic":
      return "Signed webhook or manual API source for transcripts and structured context.";
    case "manual":
      return "Direct imports created from the agent or UI.";
    default:
      return "Company knowledge source.";
  }
}

export function sourceHealth(source: BrainSource): SourceHealth {
  if (source.health) return source.health;
  if (sourceRetryAfter(source)) return "degraded";
  if (source.status === "active")
    return source.lastError ? "degraded" : "healthy";
  if (source.status === "error") return "error";
  if (source.status === "paused" || source.status === "archived")
    return "paused";
  return source.enabled === false ? "paused" : "healthy";
}

export function sourceEnabled(source: BrainSource) {
  if (typeof source.enabled === "boolean") return source.enabled;
  return source.status !== "paused" && source.status !== "archived";
}

export function sourceReviewRequired(source: BrainSource) {
  if (typeof source.reviewRequired === "boolean") return source.reviewRequired;
  const value = source.config?.reviewRequired;
  return typeof value === "boolean" ? value : true;
}

export function sourceAutoSync(source: BrainSource) {
  const value = source.config?.autoSync;
  if (typeof value === "boolean") return value;
  return (
    source.provider === "slack" ||
    source.provider === "granola" ||
    source.provider === "github"
  );
}

export function sourceRetryAfter(source: BrainSource) {
  const retry = source.cursor?.retry;
  if (!retry || typeof retry !== "object") return null;
  const retryAfterAt = (retry as Record<string, unknown>).retryAfterAt;
  return typeof retryAfterAt === "string" ? retryAfterAt : null;
}

export function sourceLastSync(source: BrainSource) {
  return source.lastSyncAt ?? source.lastSyncedAt ?? null;
}

export { IconFileText };
