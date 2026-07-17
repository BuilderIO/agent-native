export type ContextSourceStatus = "active" | "paused" | "archived" | "error";
export const CREATIVE_CONTEXT_SOURCE_KINDS = [
  "manual",
  "upload",
  "google-slides",
  "figma",
  "notion",
  "website",
  "native-app",
] as const;
export type ContextSourceKind = (typeof CREATIVE_CONTEXT_SOURCE_KINDS)[number];
export type ContextSourceHealth =
  | "healthy"
  | "stale"
  | "error"
  | "needs_setup"
  | "paused";
export type ContextItemStatus =
  | "active"
  | "deprecated"
  | "deleted"
  | "unavailable";
export type ContextCurationRank =
  | "canonical"
  | "exemplar"
  | "normal"
  | "ignored";
export type UpstreamAccess = "available" | "restricted" | "unknown";
export type ContextCurationStatus = "included" | "excluded" | "review";
export type ContextJobKind =
  | "import"
  | "embed"
  | "enrich-media"
  | "brand-dna"
  | "canonical-logo"
  | "layout-suggestion"
  | "metadata-refresh"
  | "pack-refresh"
  | "purge";
export type ContextJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type ContextImportMode = "incremental" | "full";
export type ContextFeedbackSignal =
  | "helpful"
  | "not-helpful"
  | "incorrect"
  | "outdated";

export interface ContextSource {
  id: string;
  name: string;
  kind: string;
  externalRef: string | null;
  connectionId: string | null;
  containerOwnerVerifiedAt: string | null;
  config: Record<string, unknown>;
  upstreamAccess: UpstreamAccess;
  status: ContextSourceStatus;
  healthStatus: ContextSourceHealth;
  syncCursor: string | null;
  itemCount: number;
  restrictedItemCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

export type ContextSourceSummary = Pick<
  ContextSource,
  | "id"
  | "name"
  | "kind"
  | "externalRef"
  | "connectionId"
  | "containerOwnerVerifiedAt"
  | "upstreamAccess"
  | "status"
  | "healthStatus"
  | "itemCount"
  | "restrictedItemCount"
  | "lastSyncedAt"
  | "lastError"
  | "visibility"
  | "createdAt"
  | "updatedAt"
>;

export interface ContextSourcePromotionPreview {
  sourceId: string;
  containerRef: string;
  boundaryHash: string;
  itemCount: number;
  restrictedItemCount: number;
  targetOrgId: string;
  callerAuthority: "org-admin" | "verified-container-owner";
}

export interface NormalizedContextChunk {
  id?: string;
  ordinal: number;
  kind?: string;
  text: string;
  startOffset?: number;
  endOffset?: number;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextMediaInput {
  id?: string;
  kind: "image" | "video" | "audio" | "document" | "other";
  mimeType?: string;
  accessMode?: "public" | "private" | "expiring";
  url?: string;
  storageKey?: string;
  provenanceUrl?: string;
  altText?: string;
  caption?: string;
  captionStatus?: "pending" | "complete" | "failed" | "not-needed";
  ocrText?: string;
  palette?: string[];
  contentHash?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextEdgeInput {
  id?: string;
  relation: string;
  toItemId?: string;
  toItemVersionId?: string;
  toExternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedContextItem {
  externalId: string;
  kind: string;
  title: string;
  canonicalUrl?: string;
  mimeType?: string;
  content: string;
  summary?: string;
  contentHash: string;
  sourceModifiedAt?: string;
  sourceVersion?: string;
  rawSnapshotBlobRef?: string;
  parseStatus?: "pending" | "parsed" | "failed";
  parseError?: string;
  upstreamAccess?: UpstreamAccess;
  curationStatus?: ContextCurationStatus;
  curationRank?: ContextCurationRank;
  starred?: boolean;
  inventoryState?: "discovered" | "available" | "removed" | "error";
  indexState?: "pending" | "indexed" | "stale" | "error";
  tags?: string[];
  colors?: string[];
  /** @deprecated Use colors for structured filterable color values. */
  color?: string;
  sortOrder?: number;
  parentItemId?: string;
  provenance?: Record<string, unknown>;
  thumbnailBlobRef?: string;
  metadata?: Record<string, unknown>;
  chunks?: NormalizedContextChunk[];
  media?: ContextMediaInput[];
  edges?: ContextEdgeInput[];
}

export interface ContextIngestBatch {
  sourceId: string;
  items: NormalizedContextItem[];
  syncCursor?: string;
  completedAt?: string;
}

export interface ContextIngestResult {
  sourceId: string;
  received: number;
  created: number;
  versioned: number;
  unchanged: number;
  itemIds: string[];
  mediaIds: string[];
}

export interface ImportPreviewItem {
  externalId: string;
  kind: string;
  title: string;
  canonicalUrl?: string;
  mimeType?: string;
  summary?: string;
  sourceModifiedAt?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
  upstreamAccess?: UpstreamAccess;
}

export interface ContextInventoryUpsertResult {
  sourceId: string;
  received: number;
  created: number;
  updated: number;
  itemIds: string[];
}

export interface ContextJob {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  sourceId: string | null;
  kind: ContextJobKind;
  status: ContextJobStatus;
  mode: ContextImportMode | null;
  progressCurrent: number;
  progressTotal: number | null;
  attempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  nextResumeAt: string | null;
  budget: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ContextImportInferenceResult {
  brandDnaProposal?: {
    profileId: string;
    dnaVersionId: string;
    contentHash: string;
    summary: string;
    colors: string[];
    fonts: string[];
    layoutThumbnails: Array<{
      itemId: string;
      itemVersionId: string;
      hasThumbnail: boolean;
      /** @deprecated Private thumbnail handles are never returned publicly. */
      thumbnailBlobRef?: never;
    }>;
    voiceLine: string | null;
    voiceDescriptors?: string[];
    voiceEvidenceStats?: Record<string, number>;
    confidence?: number;
  };
  media: Array<{
    itemId: string;
    itemVersionId: string;
    mediaId?: string;
    thumbnailBlobRef?: string | null;
    palette: string[];
    caption?: string | null;
  }>;
}

export interface ContextImportJobResult {
  inventoryCount: number;
  inventoryDiscovered: number;
  ingested: number;
  created: number;
  versioned: number;
  unchanged: number;
  failed: number;
  deferred: number;
  inference?: ContextImportInferenceResult;
}

export interface ContextItemSummary {
  id: string;
  sourceId: string;
  externalId: string;
  kind: string;
  title: string;
  canonicalUrl: string | null;
  mimeType: string | null;
  currentVersionId: string;
  status: ContextItemStatus;
  upstreamAccess: UpstreamAccess;
  curationStatus: ContextCurationStatus;
  curationRank: ContextCurationRank;
  starred: boolean;
  inventoryState: "discovered" | "available" | "removed" | "error";
  indexState: "pending" | "indexed" | "stale" | "error";
  tags: string[];
  colors: string[];
  sortOrder: number;
  parentItemId: string | null;
  provenance: Record<string, unknown>;
  thumbnailBlobRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextReviewItem {
  id: string;
  currentVersionId: string;
  sourceId: string;
  externalId: string;
  kind: string;
  title: string;
  canonicalUrl: string | null;
  upstreamAccess: UpstreamAccess;
  curationStatus: ContextCurationStatus;
  curationRank: ContextCurationRank;
  starred: boolean;
  status: ContextItemStatus;
  inventoryState: "discovered" | "available" | "removed" | "error";
  tags: string[];
  colors: string[];
  parentItemId: string | null;
  provenance: Record<string, unknown>;
  thumbnailBlobRef: string | null;
  updatedAt: string;
}

export interface ContextItemVersion {
  id: string;
  itemId: string;
  versionNumber: number;
  contentHash: string;
  title: string;
  content: string;
  summary: string | null;
  mimeType: string | null;
  sourceModifiedAt: string | null;
  sourceVersion: string | null;
  rawSnapshotBlobRef: string | null;
  parseStatus: "pending" | "parsed" | "failed";
  parseError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContextChunk {
  id: string;
  itemId: string;
  itemVersionId: string;
  ordinal: number;
  kind: string;
  text: string;
  startOffset: number | null;
  endOffset: number | null;
  tokenCount: number | null;
  metadata: Record<string, unknown>;
}

export interface ContextMedia {
  id: string;
  itemId: string;
  itemVersionId: string;
  kind: ContextMediaInput["kind"];
  mimeType: string | null;
  accessMode: "public" | "private" | "expiring";
  url: string | null;
  storageKey: string | null;
  provenanceUrl: string | null;
  altText: string | null;
  caption: string | null;
  captionStatus: "pending" | "complete" | "failed" | "not-needed";
  ocrText: string | null;
  palette: string[];
  contentHash: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
}

export interface ContextEdge {
  id: string;
  fromItemId: string;
  fromItemVersionId: string;
  toItemId: string | null;
  toItemVersionId: string | null;
  toExternalId: string | null;
  relation: string;
  metadata: Record<string, unknown>;
}

export interface ContextSearchResult {
  itemId: string;
  itemVersionId: string;
  chunkId: string | null;
  sourceId: string;
  sourceName: string;
  kind: string;
  title: string;
  excerpt: string;
  score: number;
  canonicalUrl: string | null;
  mimeType: string | null;
}

export interface ContextDetail {
  item: ContextItemSummary;
  version: ContextItemVersion;
  chunks: ContextChunk[];
  media: ContextMedia[];
  edges: ContextEdge[];
}

export interface BrandDnaPayload {
  summary: string;
  principles?: string[];
  voice?: Record<string, unknown>;
  visual?: Record<string, unknown>;
  audience?: Record<string, unknown>;
  constraints?: string[];
  [key: string]: unknown;
}

export interface BrandProfile {
  id: string;
  name: string;
  description: string | null;
  currentDnaVersionId: string | null;
  visibility: "private" | "org" | "public";
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandDnaVersion {
  id: string;
  profileId: string;
  versionNumber: number;
  payload: BrandDnaPayload;
  contentHash: string;
  status: "draft" | "proposed" | "published";
  evidence: Array<{ itemId: string; itemVersionId: string }>;
  createdAt: string;
}

export interface ContextPackMemberInput {
  itemId: string;
  itemVersionId?: string;
  reason?: string;
  score?: number;
  scoreMetadata?: Record<string, unknown>;
}

export interface ContextPackMember {
  id: string;
  packId: string;
  itemId: string;
  itemVersionId: string;
  ordinal: number;
  reason: string | null;
  score: number | null;
  scoreMetadata: Record<string, unknown>;
}

export interface ContextPackSummary {
  id: string;
  name: string;
  description: string | null;
  derivedFromPackId: string | null;
  brandDnaVersionId: string | null;
  contextMode: string;
  request: Record<string, unknown>;
  baseContextId: string | null;
  specialtyContextId: string | null;
  selectionReason: string | null;
  memberCount: number;
  pinned: boolean;
  archivedAt: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
}

export type CreativeContextKind = "default" | "specialty";
export type CreativeContextApprovalPolicy = "open" | "review" | "admins-only";
export type CreativeContextMembershipStatus = "active" | "removed";
export type CreativeContextSubmissionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "superseded";

export interface CreativeContextSummary {
  id: string;
  name: string;
  description: string | null;
  kind: CreativeContextKind;
  brandProfileId: string | null;
  approvalPolicy: CreativeContextApprovalPolicy;
  archivedAt: string | null;
  visibility: "private" | "org" | "public";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeContextMembership {
  id: string;
  contextId: string;
  artifactKey: string;
  publishedItemId: string | null;
  publishedItemVersionId: string | null;
  pendingSubmissionId: string | null;
  rank: Exclude<ContextCurationRank, "ignored">;
  purpose: string | null;
  status: CreativeContextMembershipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeContextMembershipPreview {
  id: string;
  itemVersionId: string;
  title: string;
  kind: string;
  canonicalUrl: string | null;
  status: ContextItemStatus;
  media: Array<{ id: string; kind: ContextMediaInput["kind"]; mimeType: string | null; url: string }>;
}

/** Public submission summary deliberately omits staging and native capability data. */
export interface CreativeContextSubmissionSummary {
  id: string;
  contextId: string;
  membershipId: string;
  artifactKey: string;
  publishedItemId: string | null;
  publishedItemVersionId: string | null;
  note: string | null;
  status: CreativeContextSubmissionStatus;
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ContextPackDetail extends ContextPackSummary {
  members: ContextPackMember[];
}

export interface EmbeddingSet {
  id: string;
  name: string;
  provider: string;
  family: string;
  model: string;
  version: string;
  dimensions: number;
  metric: "cosine" | "dot" | "euclidean";
  status: "active" | "retired";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContextEmbeddingMetadata {
  id: string;
  embeddingSetId: string;
  family: string;
  model: string;
  version: string;
  itemId: string;
  itemVersionId: string;
  chunkId: string | null;
  targetType: "item" | "chunk" | "media";
  targetId: string;
  vectorKey: string;
  dimensions: number;
  checksum: string | null;
  createdAt: string;
}

export interface CreativeContextSuggestion {
  id: string;
  kind: "canonical-logo" | "layout-template";
  status: "proposed" | "confirmed" | "rejected" | "promoted" | "demoted";
  profileId: string | null;
  itemId: string;
  itemVersionId: string;
  reason: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeContextReuseLabel {
  itemId?: string;
  itemVersionId?: string;
  kind: string;
  label: string;
  dataRole: "untrusted-reference";
  elementId?: string;
  influence?: "reused" | "adapted" | "reference-conditioned" | "generated";
}

export interface CreativeContextElementProvenance {
  elementId: string;
  influence: "reused" | "adapted" | "reference-conditioned" | "generated";
  itemId?: string;
  itemVersionId?: string;
  label?: string;
}

export interface CreativeContextGenerationRecord {
  id: string;
  appId: string;
  artifactType: string;
  artifactId: string;
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  elementProvenance: CreativeContextElementProvenance[];
  createdAt: string;
}

export interface VectorSearchMatch {
  embeddingId: string;
  score: number;
}

export interface PgVectorAdapter {
  upsert(input: {
    embeddingId: string;
    embeddingSetId: string;
    vector: readonly number[];
  }): Promise<{ vectorKey: string }>;
  search(input: {
    embeddingSetId: string;
    vector: readonly number[];
    limit: number;
    allowedVectorKeys: readonly string[];
  }): Promise<VectorSearchMatch[]>;
  delete(input: { vectorKey: string; dimensions: number }): Promise<void>;
}
