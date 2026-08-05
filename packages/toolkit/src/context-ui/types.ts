export type ContextSegmentStatus =
  | "active"
  | "pinned"
  | "evicted"
  | "summarized";

export type ContextTokenMethod = "exact" | "estimate";

export type ContextGovernance = "required" | "inherited" | "user";

export interface ContextSegmentViewData {
  segmentId: string;
  group: string;
  label: string;
  tokenCount: number;
  tokenMethod: ContextTokenMethod;
  status: ContextSegmentStatus;
  protected?: boolean;
  msgIndex?: number;
  partIndex?: number;
}

export interface ContextSystemSectionViewData {
  segmentId: string;
  label: string;
  governance: ContextGovernance;
  tokenCount: number;
  tokenMethod: ContextTokenMethod;
  sourceRef?: { resourceId?: string; path?: string; scope?: string };
  preview?: string;
}

export interface ContextManifestViewData {
  totalTokens: number;
  rawTokens: number;
  reclaimedTokens: number;
  tokenCountMethod: ContextTokenMethod;
  enforceable: boolean;
  segments: ContextSegmentViewData[];
  systemSections?: ContextSystemSectionViewData[];
  systemTokens: number;
  conversationTokens: number;
}
