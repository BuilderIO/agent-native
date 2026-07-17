import { useActionMutation, useActionQuery } from "@agent-native/core/client";

import type {
  BrandDnaPayload,
  BrandDnaVersion,
  BrandProfile,
  ContextImportMode,
  ContextJob,
  ContextPackDetail,
  ContextPackSummary,
  ContextReviewItem,
  ContextSearchResult,
  ContextSourceStatus,
  ContextSourceSummary,
  CreativeContextSuggestion,
  ImportPreviewItem,
  UpstreamAccess,
} from "../types.js";

export const CREATIVE_CONTEXT_ACTIONS = {
  listContexts: "list-creative-contexts",
  manageContext: "manage-creative-context",
  listMemberships: "list-context-memberships",
  manageMembership: "manage-context-membership",
  listSources: "list-context-sources",
  manageSource: "manage-context-source",
  previewImport: "preview-context-import",
  startImport: "start-context-import",
  importStatus: "get-context-import-status",
  listConnections: "list-context-connections",
  recommendRoots: "recommend-context-roots",
  search: "search-creative-context",
  getBrandProfile: "get-brand-profile",
  publishBrandDna: "publish-brand-dna",
  listPacks: "list-context-packs",
  managePack: "manage-context-pack",
  recordFeedback: "record-context-feedback",
  getPack: "get-context-pack",
  googlePickerSession: "get-google-picker-session",
  reviewItems: "review-context-items",
  listLogoCandidates: "list-canonical-logo-candidates",
  proposeLogo: "propose-canonical-logo",
  confirmLogo: "confirm-canonical-logo",
  listSuggestions: "list-context-suggestions",
  manageLayoutTemplate: "manage-layout-template",
} as const;

export type CreativeContextPolicy = "open" | "review" | "admins-only";
export type CreativeContextMembershipRank = "canonical" | "exemplar" | "normal";

export interface CreativeContextSummary {
  id: string;
  name: string;
  description?: string | null;
  itemCount?: number;
  updatedAt?: string | null;
  policy?: CreativeContextPolicy;
}

export interface CreativeContextMembership {
  id: string;
  contextId: string;
  appId: string;
  resourceType: string;
  resourceId: string;
  rank: CreativeContextMembershipRank;
  purpose: string | null;
  note: string | null;
  status: "active" | "pending" | "withdrawn";
  updatedAt?: string | null;
  context?: CreativeContextSummary;
}

export interface ListCreativeContextsParams {
  appId?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface ListCreativeContextsResult {
  contexts: CreativeContextSummary[];
}

export type ManageCreativeContextParams =
  | {
      operation: "create";
      name: string;
      description?: string;
      policy?: CreativeContextPolicy;
    }
  | {
      operation: "update";
      contextId: string;
      patch: {
        name?: string;
        description?: string | null;
        policy?: CreativeContextPolicy;
      };
      expectedUpdatedAt?: string;
    }
  | { operation: "archive"; contextId: string; expectedUpdatedAt?: string };

export interface ManageCreativeContextResult {
  context: CreativeContextSummary | null;
}

export interface ListContextMembershipsParams {
  appId: string;
  resourceType: string;
  resourceId: string;
}

export interface ListContextMembershipsResult {
  memberships: CreativeContextMembership[];
}

export type ManageContextMembershipParams =
  | {
      operation: "add";
      appId: string;
      resourceType: string;
      resourceId: string;
      contextId: string;
      rank?: CreativeContextMembershipRank;
      purpose?: string;
      note?: string;
    }
  | {
      operation: "update";
      membershipId: string;
      rank?: CreativeContextMembershipRank;
      purpose?: string | null;
      note?: string | null;
      expectedUpdatedAt?: string;
    }
  | {
      operation: "withdraw" | "remove";
      membershipId: string;
      expectedUpdatedAt?: string;
    };

export interface ManageContextMembershipResult {
  membership: CreativeContextMembership | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function contextSummary(value: unknown): CreativeContextSummary | null {
  const source = record(value);
  if (
    !source ||
    typeof source.id !== "string" ||
    typeof source.name !== "string"
  ) {
    return null;
  }
  return {
    id: source.id,
    name: source.name,
    description:
      typeof source.description === "string" ? source.description : null,
    itemCount:
      typeof source.itemCount === "number" ? source.itemCount : undefined,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    policy:
      source.policy === "open" ||
      source.policy === "review" ||
      source.policy === "admins-only"
        ? source.policy
        : undefined,
  };
}

export function parseCreativeContexts(
  value: unknown,
): CreativeContextSummary[] {
  const source = Array.isArray(value)
    ? value
    : (record(value)?.contexts ?? record(value)?.items ?? []);
  return Array.isArray(source)
    ? source
        .map(contextSummary)
        .filter((item): item is CreativeContextSummary => Boolean(item))
    : [];
}

export function parseContextMemberships(
  value: unknown,
): CreativeContextMembership[] {
  const source = Array.isArray(value)
    ? value
    : (record(value)?.memberships ?? record(value)?.items ?? []);
  if (!Array.isArray(source)) return [];
  return source.flatMap((value) => {
    const item = record(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.contextId !== "string" ||
      typeof item.appId !== "string" ||
      typeof item.resourceType !== "string" ||
      typeof item.resourceId !== "string"
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        contextId: item.contextId,
        appId: item.appId,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        rank:
          item.rank === "canonical" || item.rank === "exemplar"
            ? item.rank
            : "normal",
        purpose: typeof item.purpose === "string" ? item.purpose : null,
        note: typeof item.note === "string" ? item.note : null,
        status:
          item.status === "pending" || item.status === "withdrawn"
            ? item.status
            : "active",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
        context: contextSummary(item.context) ?? undefined,
      },
    ];
  });
}

export interface CanonicalLogoCandidate {
  mediaId: string;
  itemId: string;
  itemVersionId: string;
  title: string;
  mimeType: string | null;
  thumbnailUrl: string;
  score: number;
}

export interface ListCanonicalLogoCandidatesResult {
  profileId: string | null;
  candidates: CanonicalLogoCandidate[];
}

export interface ListCreativeContextSuggestionsResult {
  suggestions: CreativeContextSuggestion[];
  capabilities: {
    canonicalLogo: boolean;
    layoutTemplate: boolean;
  };
}

export interface ListContextSourcesParams {
  status?: ContextSourceStatus;
  kind?: string;
  limit?: number;
  cursor?: string;
}

export interface ListContextSourcesResult {
  sources: ContextSourceSummary[];
  nextCursor?: string;
}

export interface SearchCreativeContextParams {
  query: string;
  sourceIds?: string[];
  packId?: string;
  kinds?: string[];
  limit?: number;
  cursor?: string;
  snapshot?: boolean;
  contextPackName?: string;
}

export interface SearchCreativeContextResult {
  query: string;
  results: ContextSearchResult[];
  nextCursor?: string;
  coverage: {
    mode: "none" | "lexical" | "fts" | "vector" | "fused";
    lanes: {
      lexical: { available: boolean; count: number };
      fts: { available: boolean; count: number };
      vector: { available: boolean; count: number };
    };
  };
  contextPackId: string | null;
}

export interface ListContextPacksResult {
  packs: ContextPackSummary[];
  nextCursor?: string;
}

export interface StartContextImportParams {
  sourceId: string;
  mode?: ContextImportMode;
  itemExternalIds?: string[];
}

export interface StartContextImportResult {
  job: ContextJob;
}

export type ManageContextSourceParams =
  | {
      operation: "create";
      name: string;
      kind: string;
      externalRef?: string;
      connectionId?: string;
      config?: Record<string, unknown>;
      upstreamAccess?: UpstreamAccess;
    }
  | {
      operation: "update";
      sourceId: string;
      patch: {
        name?: string;
        externalRef?: string | null;
        connectionId?: string | null;
        config?: Record<string, unknown>;
        status?: ContextSourceStatus;
        upstreamAccess?: UpstreamAccess;
      };
    }
  | {
      operation: "archive" | "restore" | "delete";
      sourceId: string;
    }
  | {
      operation: "preview-promotion";
      sourceId: string;
    }
  | {
      operation: "promote";
      sourceId: string;
      confirmation: {
        containerRef: string;
        boundaryHash: string;
        itemCount: number;
      };
    };

export interface ManageContextSourceResult {
  source: ContextSourceSummary | null;
  deleted: boolean;
  purgeJobId?: string;
  promotionPreview?: {
    sourceId: string;
    containerRef: string;
    boundaryHash: string;
    itemCount: number;
    restrictedItemCount: number;
    targetOrgId: string;
    callerAuthority: "org-admin" | "verified-container-owner";
  };
}

export interface PreviewContextImportResult {
  sourceId: string;
  items: ImportPreviewItem[];
  smartDefaultExternalIds: string[];
  nextCursor?: string;
  total?: number;
}

export interface GetContextImportStatusResult {
  job: ContextJob | null;
}

export type CreativeContextConnectionProvider =
  | "google_drive"
  | "figma"
  | "notion";

export interface CreativeContextConnection {
  connectionId: string;
  provider: CreativeContextConnectionProvider;
  label: string;
}

export interface ListCreativeContextConnectionsResult {
  appId: string;
  provider: CreativeContextConnectionProvider;
  connections: CreativeContextConnection[];
  autoSelectedConnectionId: string | null;
  needsPicker: boolean;
  needsSetup: boolean;
  connectionsPath: string;
  connectPath: string;
}

export interface GetGooglePickerSessionResult {
  accessToken: string;
  accountLabel: string | null;
  apiKey: string;
  appId: string;
}

export type CreativeContextRecommendationProvider =
  | "google-slides"
  | "figma"
  | "notion";

export interface CreativeContextRootRecommendation {
  externalId: string;
  provider: CreativeContextRecommendationProvider;
  kind: "page" | "presentation" | "file";
  title: string;
  canonicalUrl?: string;
  sourceModifiedAt?: string;
  containerRef?: string;
}

export interface RecommendCreativeContextRootsResult {
  recommendations: CreativeContextRootRecommendation[];
  persisted: false;
  requiresExplicitBoundary: true;
  unavailableReason?: string;
}

export interface GetBrandProfileResult {
  profile: BrandProfile | null;
  dna: BrandDnaVersion | null;
}

export interface PublishBrandDnaParams {
  profileId: string;
  proposalVersionId: string;
  confirmation: {
    proposalVersionId: string;
    contentHash: string;
  };
}

export interface PublishBrandDnaResult {
  profile: BrandProfile;
  dna: BrandDnaVersion;
}

export interface GetContextPackResult {
  pack: ContextPackDetail | null;
}

export type ReviewContextItemsParams =
  | {
      sourceId: string;
      operation: "list";
      queue?: "restricted" | "all";
      limit?: number;
    }
  | {
      sourceId: string;
      operation:
        | "approve"
        | "exclude"
        | "exemplar"
        | "normal"
        | "ignore"
        | "star"
        | "unstar"
        | "deprecate"
        | "restore";
      itemIds: string[];
    };

export interface ReviewContextItemsResult {
  items: ContextReviewItem[];
  updated: number;
}

export function useCreativeContextSources(
  params: ListContextSourcesParams = {},
) {
  return useActionQuery<ListContextSourcesResult>(
    CREATIVE_CONTEXT_ACTIONS.listSources,
    params,
  );
}

export function useCreativeContexts(params: ListCreativeContextsParams = {}) {
  return useActionQuery<ListCreativeContextsResult>(
    CREATIVE_CONTEXT_ACTIONS.listContexts,
    params,
  );
}

export function useManageCreativeContext() {
  return useActionMutation<
    ManageCreativeContextResult,
    ManageCreativeContextParams
  >(CREATIVE_CONTEXT_ACTIONS.manageContext);
}

export function useContextMemberships(
  params: ListContextMembershipsParams | null,
) {
  return useActionQuery<ListContextMembershipsResult>(
    CREATIVE_CONTEXT_ACTIONS.listMemberships,
    params ?? undefined,
    { enabled: Boolean(params) },
  );
}

export function useManageContextMembership() {
  return useActionMutation<
    ManageContextMembershipResult,
    ManageContextMembershipParams
  >(CREATIVE_CONTEXT_ACTIONS.manageMembership);
}

export function useCreativeContextSearch() {
  return useActionMutation<
    SearchCreativeContextResult,
    SearchCreativeContextParams
  >(CREATIVE_CONTEXT_ACTIONS.search);
}

export function useCreativeContextPacks() {
  return useActionQuery<ListContextPacksResult>(
    CREATIVE_CONTEXT_ACTIONS.listPacks,
    { limit: 50 },
  );
}

export function useRefreshCreativeContextSource() {
  return useActionMutation<StartContextImportResult, StartContextImportParams>(
    CREATIVE_CONTEXT_ACTIONS.startImport,
  );
}

export function useManageCreativeContextSource() {
  return useActionMutation<
    ManageContextSourceResult,
    ManageContextSourceParams
  >(CREATIVE_CONTEXT_ACTIONS.manageSource);
}

export function usePreviewCreativeContextImport(sourceId: string | null) {
  return useActionQuery<PreviewContextImportResult>(
    CREATIVE_CONTEXT_ACTIONS.previewImport,
    sourceId ? { sourceId, limit: 100 } : undefined,
    { enabled: Boolean(sourceId) },
  );
}

export function useStartCreativeContextImport() {
  return useActionMutation<StartContextImportResult, StartContextImportParams>(
    CREATIVE_CONTEXT_ACTIONS.startImport,
  );
}

export function useCreativeContextImportStatus(jobId: string | null) {
  return useActionQuery<GetContextImportStatusResult>(
    CREATIVE_CONTEXT_ACTIONS.importStatus,
    jobId ? { jobId } : undefined,
    {
      enabled: Boolean(jobId),
      refetchInterval: (query) => {
        const status = query.state.data?.job?.status;
        return status === "queued" || status === "running" ? 2_000 : false;
      },
    },
  );
}

export function useCreativeContextConnections(
  provider: CreativeContextConnectionProvider | null,
) {
  return useActionQuery<ListCreativeContextConnectionsResult>(
    CREATIVE_CONTEXT_ACTIONS.listConnections,
    provider ? { provider } : undefined,
    { enabled: Boolean(provider) },
  );
}

export function useCreativeContextRootRecommendations(
  provider: CreativeContextRecommendationProvider | null,
  connectionId: string | null,
  figmaBoundary: { figmaProjectId?: string; figmaTeamId?: string } = {},
) {
  return useActionQuery<RecommendCreativeContextRootsResult>(
    CREATIVE_CONTEXT_ACTIONS.recommendRoots,
    provider && connectionId
      ? { provider, connectionId, limit: 15, ...figmaBoundary }
      : undefined,
    { enabled: Boolean(provider && connectionId) },
  );
}

export function useCreativeContextGooglePickerSession(
  connectionId: string | null,
) {
  return useActionQuery<GetGooglePickerSessionResult>(
    CREATIVE_CONTEXT_ACTIONS.googlePickerSession,
    connectionId ? { connectionId } : undefined,
    { enabled: false },
  );
}

export function useCreativeContextBrandProfile() {
  return useActionQuery<GetBrandProfileResult>(
    CREATIVE_CONTEXT_ACTIONS.getBrandProfile,
    {},
  );
}

export function usePublishCreativeContextBrandDna() {
  return useActionMutation<PublishBrandDnaResult, PublishBrandDnaParams>(
    CREATIVE_CONTEXT_ACTIONS.publishBrandDna,
  );
}

export function useCreativeContextPack(packId: string | null) {
  return useActionQuery<GetContextPackResult>(
    CREATIVE_CONTEXT_ACTIONS.getPack,
    packId ? { packId } : undefined,
    { enabled: Boolean(packId) },
  );
}

export function useReviewCreativeContextItems() {
  return useActionMutation<ReviewContextItemsResult, ReviewContextItemsParams>(
    CREATIVE_CONTEXT_ACTIONS.reviewItems,
  );
}

export function useCanonicalLogoCandidates(profileId?: string, enabled = true) {
  return useActionQuery<ListCanonicalLogoCandidatesResult>(
    CREATIVE_CONTEXT_ACTIONS.listLogoCandidates,
    { profileId, limit: 6 },
    { enabled },
  );
}

export function useCreativeContextSuggestions() {
  return useActionQuery<ListCreativeContextSuggestionsResult>(
    CREATIVE_CONTEXT_ACTIONS.listSuggestions,
    { limit: 50 },
  );
}

export function useProposeCanonicalLogo() {
  return useActionMutation<
    CreativeContextSuggestion,
    {
      profileId?: string;
      itemId: string;
      itemVersionId?: string;
      reason?: string;
      payload?: Record<string, unknown>;
    }
  >(CREATIVE_CONTEXT_ACTIONS.proposeLogo);
}

export function useConfirmCanonicalLogo() {
  return useActionMutation<
    CreativeContextSuggestion,
    { suggestionId: string; decision: "confirm" | "reject" }
  >(CREATIVE_CONTEXT_ACTIONS.confirmLogo);
}

export function useManageLayoutTemplate() {
  return useActionMutation<
    CreativeContextSuggestion,
    {
      operation: "promote" | "demote" | "reject";
      suggestionId: string;
    }
  >(CREATIVE_CONTEXT_ACTIONS.manageLayoutTemplate);
}
