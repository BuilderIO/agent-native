export const CONTEXT_XRAY_MANIFEST_KEY = "context_xray:manifest";

export type ContextDirectiveAction = "pin" | "evict" | "summarize";
export type ContextDirectiveCreator = "user" | "agent";
export type ContextSegmentType =
  | "text"
  | "image"
  | "file"
  | "tool-call"
  | "tool-result"
  | "thinking";
export type ContextSegmentRole = "user" | "assistant";
export type ContextSegmentStatus =
  | "active"
  | "pinned"
  | "evicted"
  | "summarized";
export type ContextTokenCountMethod = "exact" | "estimate";
export type ContextManifestSource =
  | "structured"
  | "flattened"
  | "external"
  | "preview";
export type ContextSystemProvenance =
  | "framework-core"
  | "actions-prompt"
  | "template"
  | "enterprise-workspace-core"
  | "sql-workspace"
  | "legacy-app-default"
  | "organization"
  | "personal"
  | "memory"
  | "db-schema"
  | "tools"
  | "model-overlay"
  | "runtime-context";
export type ContextGovernanceTier = "required" | "inherited" | "user";

export interface ContextManifestSourceRef {
  resourceId?: string;
  path?: string;
  scope?: string;
}

/**
 * A non-evictable system-prompt contribution. This is intentionally separate
 * from conversation segments so old manifests can be read without a schema
 * migration and directive code can never accidentally evict system context.
 */
export interface ContextManifestSystemSection {
  kind: "system";
  segmentId: string;
  group: string;
  label: string;
  provenance: ContextSystemProvenance;
  governance: ContextGovernanceTier;
  tokenCount: number;
  tokenMethod: ContextTokenCountMethod;
  sourceRef?: ContextManifestSourceRef;
  contentHash: string;
  preview: string;
  timestamp: number;
}

export interface ContextPreview {
  computedAt: number;
  model?: string;
  scope: "user" | "org";
  totalTokens: number;
  systemTokens: number;
  tokenCountMethod: ContextTokenCountMethod;
  sections: ContextManifestSystemSection[];
  source: "preview";
}

export interface ContextDirective {
  id?: string;
  threadId: string;
  segmentId: string;
  action: ContextDirectiveAction;
  summaryText?: string | null;
  createdBy: ContextDirectiveCreator;
  active: boolean;
  originTurn?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface ContextManifestSegment {
  segmentId: string;
  type: ContextSegmentType;
  role: ContextSegmentRole;
  group: string;
  label: string;
  tokenCount: number;
  tokenMethod: ContextTokenCountMethod;
  status: ContextSegmentStatus;
  protected?: boolean;
  originTurn?: string;
  lastReferencedTurn?: string;
  summaryTokenCount?: number;
  pairKey?: string;
  msgIndex?: number;
  partIndex?: number;
}

export interface ContextManifest {
  threadId: string;
  turnId?: string;
  computedAt: number;
  model?: string;
  totalTokens: number;
  rawTokens: number;
  reclaimedTokens: number;
  tokenCountMethod: ContextTokenCountMethod;
  /** Conversation-only total. Old manifests omit this and are conversation-only. */
  conversationTokens?: number;
  /** System-prompt total. Old manifests omit this and have no system sections. */
  systemTokens?: number;
  source: ContextManifestSource;
  enforceable: boolean;
  segments: ContextManifestSegment[];
  /** Optional for strict backward compatibility with persisted old manifests. */
  systemSections?: ContextManifestSystemSection[];
  url?: string;
}

export function manifestSystemTokens(manifest: ContextManifest): number {
  return (
    manifest.systemTokens ??
    manifest.systemSections?.reduce(
      (total, section) => total + section.tokenCount,
      0,
    ) ??
    0
  );
}

export function manifestConversationTokens(manifest: ContextManifest): number {
  return (
    manifest.conversationTokens ??
    Math.max(0, manifest.totalTokens - manifestSystemTokens(manifest))
  );
}

export function emptyContextManifest(
  threadId: string,
  opts: {
    source?: ContextManifestSource;
    enforceable?: boolean;
    model?: string;
    turnId?: string;
  } = {},
): ContextManifest {
  return {
    threadId,
    ...(opts.turnId ? { turnId: opts.turnId } : {}),
    computedAt: Date.now(),
    ...(opts.model ? { model: opts.model } : {}),
    totalTokens: 0,
    rawTokens: 0,
    reclaimedTokens: 0,
    tokenCountMethod: "estimate",
    source: opts.source ?? "structured",
    enforceable: opts.enforceable ?? true,
    segments: [],
    conversationTokens: 0,
    systemTokens: 0,
    systemSections: [],
  };
}
