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
