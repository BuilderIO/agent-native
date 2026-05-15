import type { Icon } from "@tabler/icons-react";
import {
  IconBook2,
  IconChecks,
  IconDatabase,
  IconFileText,
  IconMessageQuestion,
  IconSettings,
} from "@tabler/icons-react";

export type BrainView = "ask" | "knowledge" | "review" | "sources" | "settings";

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
  updatedAt?: string | null;
  owner?: string | null;
}

export interface ReviewItem {
  id: string;
  title: string;
  proposedAnswer?: string;
  body?: string;
  sourceName?: string;
  sourceId?: string | null;
  reason?: string;
  rationale?: string | null;
  priority?: ReviewPriority;
  status?: "queued" | "approved" | "rejected" | "needs_changes";
  createdAt?: string | null;
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

export interface ReviewQueueResponse {
  items?: ReviewItem[];
  proposals?: ReviewItem[];
}

export interface SourcesResponse {
  sources?: BrainSource[];
}

export interface BrainSettings {
  requireApprovalForCompanyKnowledge?: boolean;
  autoRedactEmails?: boolean;
  defaultPublishTier?: "private" | "team" | "company";
  distillationInstructions?: string;
  connectorPollMinutes?: number;
  requireCitations?: boolean;
  autoArchiveResolved?: boolean;
  notifyOnSourceErrors?: boolean;
}

export interface SettingsResponse {
  settings?: BrainSettings;
}

export const navItems: Array<{
  view: BrainView;
  label: string;
  href: string;
  icon: Icon;
}> = [
  { view: "ask", label: "Ask", href: "/", icon: IconMessageQuestion },
  {
    view: "knowledge",
    label: "Knowledge",
    href: "/knowledge",
    icon: IconBook2,
  },
  { view: "review", label: "Review", href: "/review", icon: IconChecks },
  { view: "sources", label: "Sources", href: "/sources", icon: IconDatabase },
  {
    view: "settings",
    label: "Settings",
    href: "/settings",
    icon: IconSettings,
  },
];

export const emptyMetrics: BrainMetric[] = [
  { label: "Facts indexed", value: "0", detail: "Waiting for sources" },
  { label: "Needs review", value: "0", detail: "No queued memories" },
  { label: "Source health", value: "0%", detail: "Connect a source" },
  { label: "Citation coverage", value: "0%", detail: "No answers yet" },
];

export const sampleKnowledgeRows: KnowledgeRow[] = [
  {
    id: "sample-pricing",
    title: "Enterprise pricing requires security review",
    summary:
      "Large-plan pricing conversations should include security, procurement, and implementation-owner details before final quote approval.",
    sourceName: "Sales handbook",
    sourceType: "Docs",
    topic: "Revenue",
    status: "approved",
    confidence: 0.92,
    citations: 4,
    updatedAt: "Just now",
    owner: "Revenue Ops",
  },
  {
    id: "sample-onboarding",
    title: "Customer onboarding milestone policy",
    summary:
      "New customers get a launch plan, success criteria, integration checklist, and two-week adoption review.",
    sourceName: "Customer success wiki",
    sourceType: "Notion",
    topic: "Customer Success",
    status: "needs_review",
    confidence: 0.74,
    citations: 7,
    updatedAt: "Pending sync",
    owner: "CS",
  },
  {
    id: "sample-incident",
    title: "Incident response escalation path",
    summary:
      "Customer-impacting incidents route through engineering on-call, support lead, and comms owner with hourly updates.",
    sourceName: "Runbooks",
    sourceType: "GitHub",
    topic: "Operations",
    status: "stale",
    confidence: 0.68,
    citations: 3,
    updatedAt: "Stale",
    owner: "Platform",
  },
];

export const sampleReviewItems: ReviewItem[] = [
  {
    id: "sample-review-1",
    title: "Should beta customers get migration support?",
    proposedAnswer:
      "Beta customers qualify for guided migration when contract value or integration risk is high.",
    sourceName: "Slack #sales-engineering",
    reason: "Conflicting Slack and handbook evidence",
    priority: "high",
    createdAt: "Queued today",
  },
  {
    id: "sample-review-2",
    title: "Preferred vendor for SOC 2 evidence exports",
    proposedAnswer:
      "The latest approved vendor appears to be Drata, but older docs still mention Vanta.",
    sourceName: "Security folder",
    reason: "Possible policy drift",
    priority: "medium",
    createdAt: "Queued yesterday",
  },
];

export const sampleSources: BrainSource[] = [
  {
    id: "sample-notion",
    name: "Company Wiki",
    title: "Company Wiki",
    type: "Notion",
    provider: "generic",
    description:
      "Policies, operating docs, team handbooks, and project briefs.",
    health: "healthy",
    enabled: true,
    recordCount: 1284,
    coverage: 0.88,
    lastSyncAt: "8 min ago",
    nextSyncAt: "52 min",
    reviewRequired: true,
  },
  {
    id: "sample-slack",
    name: "Slack Knowledge Channels",
    title: "Slack Knowledge Channels",
    type: "Slack",
    provider: "slack",
    description: "Decision threads from product, sales, support, and launches.",
    health: "degraded",
    enabled: true,
    recordCount: 6430,
    coverage: 0.61,
    lastSyncAt: "34 min ago",
    nextSyncAt: "26 min",
    reviewRequired: true,
  },
  {
    id: "sample-drive",
    name: "Shared Drive",
    title: "Shared Drive",
    type: "Google Drive",
    provider: "generic",
    description: "Decks, PDFs, security collateral, and customer templates.",
    health: "paused",
    enabled: false,
    recordCount: 0,
    coverage: 0,
    lastSyncAt: null,
    nextSyncAt: null,
    reviewRequired: false,
  },
];

export const defaultSettings: BrainSettings = {
  requireApprovalForCompanyKnowledge: true,
  autoRedactEmails: true,
  defaultPublishTier: "company",
  distillationInstructions:
    "Distill durable, reusable institutional knowledge. Preserve short direct quotes as evidence.",
  connectorPollMinutes: 60,
  requireCitations: true,
  autoArchiveResolved: true,
  notifyOnSourceErrors: true,
};

export function viewFromPath(pathname: string): BrainView {
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/sources")) return "sources";
  if (pathname.startsWith("/settings")) return "settings";
  return "ask";
}

export function pathFromView(view?: string): string {
  switch (view) {
    case "knowledge":
      return "/knowledge";
    case "review":
      return "/review";
    case "sources":
      return "/sources";
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
  return source.provider === "slack" || source.provider === "granola";
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
