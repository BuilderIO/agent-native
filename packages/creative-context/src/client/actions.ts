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
  kind: "default" | "specialty";
  memberCount: number;
  updatedAt?: string | null;
  approvalPolicy: CreativeContextPolicy;
  visibility: "private" | "org" | "public";
}

export interface CreativeContextMembership {
  id: string;
  contextId: string;
  publishedItemId: string | null;
  publishedItemVersionId: string | null;
  pendingSubmissionId: string | null;
  rank: CreativeContextMembershipRank;
  purpose: string | null;
  status: "active" | "removed";
  updatedAt?: string | null;
  publishedItem?: {
    id: string;
    itemVersionId: string;
    title: string;
    kind: string;
    status: string;
    media: Array<{ id: string; kind: string; mimeType: string | null; url: string }>;
  } | null;
  pendingSubmission?: {
    id: string;
    status: string;
    note: string | null;
    submittedBy: string;
  } | null;
}

export interface ListCreativeContextsParams {
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
}

export interface ListCreativeContextsResult {
  contexts: CreativeContextSummary[];
}

export type ManageCreativeContextParams =
  | {
      operation: "create";
      name: string;
      description?: string | null;
      kind: "default" | "specialty";
      brandProfileId?: string | null;
      approvalPolicy?: CreativeContextPolicy;
    }
  | {
      operation: "update";
      contextId: string;
      patch: {
        name?: string;
        description?: string | null;
        brandProfileId?: string | null;
        approvalPolicy?: CreativeContextPolicy;
      };
    }
  | { operation: "archive"; contextId: string }
  | { operation: "set-app-default"; contextId: string; appId: string };

export interface ManageCreativeContextResult {
  context: CreativeContextSummary | null;
}

export interface ListContextMembershipsParams {
  contextId: string;
  status?: "active" | "removed";
  limit?: number;
  cursor?: string;
}

export interface ListContextMembershipsResult {
  memberships: CreativeContextMembership[];
}

export type ManageContextMembershipParams =
  | {
      operation: "submit";
      contextId: string;
      itemId?: string;
      itemVersionId?: string;
      nativeResource?: {
        appId: string;
        resourceType: string;
        resourceId: string;
        expectedUpdatedAt?: string;
      };
      rank?: CreativeContextMembershipRank;
      purpose?: string;
      note?: string;
      confirmBroaderPublication?: true;
    }
  | {
      operation: "approve" | "request-changes" | "withdraw" | "remove";
      contextId: string;
      membershipId: string;
      note?: string | null;
    };

export interface ManageContextMembershipResult {
  membership: CreativeContextMembership | null;
  membershipId?: string;
  submission?: { id: string; status: string };
  withdrawn?: boolean;
  approved?: boolean;
  requestChanges?: boolean;
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
    kind: source.kind === "specialty" ? "specialty" : "default",
    memberCount:
      typeof source.memberCount === "number" ? source.memberCount : 0,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    approvalPolicy:
      source.approvalPolicy === "review" ||
      source.approvalPolicy === "admins-only"
        ? source.approvalPolicy
        : "open",
    visibility:
      source.visibility === "org" || source.visibility === "public"
        ? source.visibility
        : "private",
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
      typeof item.contextId !== "string"
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        contextId: item.contextId,
        publishedItemId:
          typeof item.publishedItemId === "string"
            ? item.publishedItemId
            : null,
        publishedItemVersionId:
          typeof item.publishedItemVersionId === "string"
            ? item.publishedItemVersionId
            : null,
        pendingSubmissionId:
          typeof item.pendingSubmissionId === "string"
            ? item.pendingSubmissionId
            : null,
        rank:
          item.rank === "canonical" || item.rank === "exemplar"
            ? item.rank
            : "normal",
        purpose: typeof item.purpose === "string" ? item.purpose : null,
        status: item.status === "removed" ? "removed" : "active",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
        pendingSubmission: (() => {
          const submission = record(item.pendingSubmission);
          return submission &&
            typeof submission.id === "string" &&
            typeof submission.status === "string"
            ? {
                id: submission.id,
                status: submission.status,
                note: typeof submission.note === "string" ? submission.note : null,
                submittedBy:
                  typeof submission.submittedBy === "string"
                    ? submission.submittedBy
                    : "",
              }
            : null;
        })(),
        publishedItem: (() => {
          const published = record(item.publishedItem);
          if (
            !published ||
            typeof published.id !== "string" ||
            typeof published.itemVersionId !== "string" ||
            typeof published.title !== "string" ||
            typeof published.kind !== "string"
          ) {
            return null;
          }
          const media = Array.isArray(published.media)
            ? published.media.flatMap((value) => {
                const medium = record(value);
                return medium &&
                  typeof medium.id === "string" &&
                  typeof medium.kind === "string" &&
                  typeof medium.url === "string"
                  ? [
                      {
                        id: medium.id,
                        kind: medium.kind,
                        mimeType:
                          typeof medium.mimeType === "string"
                            ? medium.mimeType
                            : null,
                        url: medium.url,
                      },
                    ]
                  : [];
              })
            : [];
          return {
            id: published.id,
            itemVersionId: published.itemVersionId,
            title: published.title,
            kind: published.kind,
            status:
              typeof published.status === "string" ? published.status : "active",
            media,
          };
        })(),
      },
    ];
  });
}

export function parseContextMembershipsForResource(
  value: unknown,
  resource: { appId: string; resourceType: string; resourceId: string },
): CreativeContextMembership[] {
  const source = record(value)?.memberships;
  if (!Array.isArray(source)) return [];
  const artifactKey = `${resource.appId}:${resource.resourceType}:${resource.resourceId}`;
  return parseContextMemberships({
    memberships: source.filter(
      (value) => record(value)?.artifactKey === artifactKey,
    ),
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
    { limit: 50, ...params },
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
    params ? { limit: 50, ...params } : undefined,
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
