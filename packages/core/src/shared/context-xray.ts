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
export type ContextManifestSource = "structured" | "flattened" | "external";

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
  source: ContextManifestSource;
  enforceable: boolean;
  segments: ContextManifestSegment[];
  url?: string;
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
  };
}
