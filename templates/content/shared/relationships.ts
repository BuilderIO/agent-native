import { z } from "zod";

import { DOCUMENT_PROPERTY_VISIBILITIES } from "./properties.js";

export const RELATIONSHIP_ACTION_ERROR_CODES = [
  "NOT_ACCESSIBLE",
  "ROUTE_NOT_AUTHORIZED",
  "TYPE_UNAVAILABLE",
  "UNSUPPORTED_CONFIGURATION",
  "INVALID_TARGET",
  "CONSTRAINT_UNAVAILABLE",
  "CARDINALITY_VIOLATION",
  "SOURCE_AUTHORITY_UNSUPPORTED",
  "STALE_SELECTION",
  "STALE_RECOVERY",
  "IDEMPOTENCY_CONFLICT",
  "LIMIT_EXCEEDED",
  "UNAVAILABLE",
  "USE_RELATIONSHIP_MUTATION",
] as const;

export const relationshipActionErrorCodeSchema = z.enum(
  RELATIONSHIP_ACTION_ERROR_CODES,
);
export type RelationshipActionErrorCode = z.infer<
  typeof relationshipActionErrorCodeSchema
>;

export const relationshipDirectionSchema = z.enum(["forward", "inverse"]);
export const relationshipListDirectionSchema = z.enum([
  "outgoing",
  "incoming",
  "both",
]);
export const relationshipCardinalitySchema = z.enum(["one", "many"]);
export const relationshipTypeStateSchema = z.enum(["active", "archived"]);
export const relationshipEdgeStateSchema = z.enum([
  "active",
  "suspended",
  "inactive",
]);

export const canonicalRelationOptionsSchema = z
  .object({
    databaseId: z.string().min(1),
    relationshipTypeId: z.string().min(1),
    direction: relationshipDirectionSchema,
    editable: z.boolean(),
  })
  .strict();

export const canonicalRelationProjectionSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  databaseId: z.string().min(1),
  relationshipTypeId: z.string().min(1),
  direction: relationshipDirectionSchema,
  editable: z.boolean(),
  alias: z.string(),
  description: z.string(),
  archivedAt: z.string().nullable(),
});

export const relationshipTypeVersionSchema = z.object({
  id: z.string().min(1),
  relationshipTypeId: z.string().min(1),
  version: z.number().int().positive(),
  forwardLabel: z.string().min(1),
  inverseLabel: z.string().min(1),
  forwardCardinality: relationshipCardinalitySchema,
  inverseCardinality: z.literal("many"),
  sourceDatabaseId: z.string().min(1),
  targetDatabaseId: z.string().min(1),
  directional: z.literal(true),
  allowSelf: z.literal(false),
  selectorKind: z.literal("database"),
});

export const relationshipTypeSchema = z.object({
  id: z.string().min(1),
  spaceId: z.string().min(1),
  currentVersionId: z.string().min(1),
  state: relationshipTypeStateSchema,
  provenance: z.literal("local"),
  archivedAt: z.string().nullable(),
});

export const relationshipRouteRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("forward-property"),
      propertyId: z.string().min(1),
      sourcePageId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("inverse-property"),
      propertyId: z.string().min(1),
      targetPageId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("connections-forward"),
      sourcePageId: z.string().min(1),
    })
    .strict(),
]);

export const relationshipChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      typeId: z.string().min(1),
      typeVersionId: z.string().min(1),
      sourcePageId: z.string().min(1),
      targetPageId: z.string().min(1),
      route: relationshipRouteRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove"),
      edgeId: z.string().min(1),
      observedActivationIds: z.array(z.string().min(1)).min(1).max(100),
      observationToken: z.string().min(1),
      route: relationshipRouteRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("replace"),
      typeId: z.string().min(1),
      typeVersionId: z.string().min(1),
      sourcePageId: z.string().min(1),
      targetPageId: z.string().min(1),
      observedSlotToken: z.string().min(1),
      route: relationshipRouteRefSchema,
    })
    .strict(),
]);

export const configureContentRelationPropertyInputSchema = z
  .object({
    ownerDatabaseId: z.string().min(1),
    propertyId: z.string().min(1).optional(),
    alias: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
    editable: z.boolean().optional(),
    visibility: z.enum(DOCUMENT_PROPERTY_VISIBILITIES).optional(),
    definition: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("new-local"),
          forwardLabel: z.string().trim().min(1).max(200),
          inverseLabel: z.string().trim().min(1).max(200),
          forwardCardinality: relationshipCardinalitySchema,
          sourceDatabaseId: z.string().min(1),
          targetDatabaseId: z.string().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("existing"),
          relationshipTypeId: z.string().min(1),
          direction: relationshipDirectionSchema,
        })
        .strict(),
    ]),
    inverseProjection: z
      .object({
        ownerDatabaseId: z.string().min(1),
        propertyId: z.string().min(1).optional(),
        alias: z.string().trim().min(1).max(200),
        description: z.string().max(2_000).optional(),
        editable: z.boolean(),
        visibility: z.enum(DOCUMENT_PROPERTY_VISIBILITIES).optional(),
      })
      .strict()
      .optional(),
    operationId: z.string().min(1).max(200),
  })
  .strict();

export const listContentRelationshipTypesInputSchema = z
  .object({
    databaseId: z.string().min(1),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const listContentRelationCandidatesInputSchema = z
  .object({
    propertyId: z.string().min(1),
    anchorPageId: z.string().min(1),
    search: z.string().trim().max(500).default(""),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    contextPropertyIds: z.array(z.string().min(1)).max(20).default([]),
  })
  .strict();

export const listContentRelationshipsInputSchema = z
  .object({
    pageId: z.string().min(1).optional(),
    databaseId: z.string().min(1).optional(),
    relationshipTypeId: z.string().min(1).optional(),
    direction: relationshipListDirectionSchema.default("both"),
    oppositePageId: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((value) => Boolean(value.pageId) !== Boolean(value.databaseId), {
    message: "Provide exactly one of pageId or databaseId.",
    path: ["pageId"],
  });

export const mutateContentRelationshipsInputSchema = z
  .object({
    operationId: z.string().min(1).max(200),
    changes: z.array(relationshipChangeSchema).min(1).max(100),
  })
  .strict();

export const prepareContentRelationshipRemovalInputSchema = z
  .object({
    selection: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("property"), propertyId: z.string().min(1) })
        .strict(),
      z
        .object({
          kind: z.literal("edges"),
          edgeIds: z.array(z.string().min(1)).min(1).max(100),
        })
        .strict(),
    ]),
    filter: z
      .object({
        typeId: z.string().min(1).optional(),
        direction: relationshipListDirectionSchema.optional(),
        oppositePageId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const removeContentRelationPropertyInputSchema = z
  .object({
    propertyId: z.string().min(1),
    relationshipMode: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("keep") }).strict(),
      z
        .object({
          kind: z.literal("remove-selected"),
          selectionReceipt: z.string().min(1),
          edgeIds: z.array(z.string().min(1)).min(1).max(100).optional(),
        })
        .strict(),
    ]),
    operationId: z.string().min(1).max(200),
  })
  .strict();

export const listContentRelationshipHistoryInputSchema = z
  .object({
    pageId: z.string().min(1).optional(),
    relationshipTypeId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.pageId || value.relationshipTypeId || value.revisionId),
    { message: "Provide a Page, relationship type, or Revision ID." },
  );

export const undoContentRelationshipRevisionInputSchema = z
  .object({
    revisionId: z.string().min(1),
    recoveryToken: z.string().min(1),
    operationId: z.string().min(1).max(200),
    routes: z.array(relationshipRouteRefSchema).max(100).default([]),
  })
  .strict();

export const relationshipCapabilitiesSchema = z.object({
  canConfigure: z.boolean(),
  canAdd: z.boolean(),
  canRemove: z.boolean(),
  canReplace: z.boolean(),
  canEditInverse: z.boolean(),
});

export const relationshipEndpointSchema = z.object({
  pageId: z.string().min(1),
  title: z.string(),
  state: z.enum(["active", "trashed"]),
});

export const contentRelationshipItemSchema = z.object({
  edgeId: z.string().min(1),
  lineageId: z.string().min(1),
  typeId: z.string().min(1),
  typeVersionId: z.string().min(1),
  sourcePageId: z.string().min(1),
  targetPageId: z.string().min(1),
  direction: relationshipListDirectionSchema.exclude(["both"]),
  state: relationshipEdgeStateSchema,
  observedActivationIds: z.array(z.string().min(1)),
  observationToken: z.string().min(1),
  slotObservationToken: z.string().min(1).nullable(),
  source: relationshipEndpointSchema,
  target: relationshipEndpointSchema,
  relationship: z.object({
    forwardLabel: z.string(),
    inverseLabel: z.string(),
    label: z.string(),
    forwardCardinality: relationshipCardinalitySchema,
  }),
  routes: z.array(relationshipRouteRefSchema),
});

export const relationshipMutationResultItemSchema = z.object({
  kind: z.enum(["add", "remove", "replace"]),
  edgeId: z.string().min(1),
  lineageId: z.string().min(1),
  state: relationshipEdgeStateSchema,
  activationIds: z.array(z.string().min(1)),
  displacedEdgeIds: z.array(z.string().min(1)).optional(),
});

export const relationshipInvalidationSchema = z.object({
  pageIds: z.array(z.string().min(1)),
  databaseIds: z.array(z.string().min(1)),
  propertyIds: z.array(z.string().min(1)),
  relationshipTypeIds: z.array(z.string().min(1)),
});

export const relationshipCommitReceiptSchema = z.object({
  operationId: z.string().min(1),
  receiptId: z.string().min(1),
  revisionId: z.string().min(1),
  eventIds: z.array(z.string().min(1)),
  invalidation: relationshipInvalidationSchema,
});

export const relationshipReadStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    scope: z.literal("viewer-accessible"),
    pageIds: z.array(z.string().min(1)),
  }),
  z.object({
    status: z.literal("unsupported"),
    errorCode: z.literal("UNSUPPORTED_CONFIGURATION"),
  }),
  z.object({
    status: z.literal("unavailable"),
    errorCode: z.literal("UNAVAILABLE"),
  }),
]);

export type CanonicalRelationOptions = z.infer<
  typeof canonicalRelationOptionsSchema
>;
export type CanonicalRelationProjection = z.infer<
  typeof canonicalRelationProjectionSchema
>;
export type RelationshipTypeVersion = z.infer<
  typeof relationshipTypeVersionSchema
>;
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type RelationshipRouteRef = z.infer<typeof relationshipRouteRefSchema>;
export type RelationshipChange = z.infer<typeof relationshipChangeSchema>;
export type ConfigureContentRelationPropertyInput = z.infer<
  typeof configureContentRelationPropertyInputSchema
>;
export type ListContentRelationshipTypesInput = z.infer<
  typeof listContentRelationshipTypesInputSchema
>;
export type ListContentRelationCandidatesInput = z.infer<
  typeof listContentRelationCandidatesInputSchema
>;
export type ListContentRelationshipsInput = z.infer<
  typeof listContentRelationshipsInputSchema
>;
export type MutateContentRelationshipsInput = z.infer<
  typeof mutateContentRelationshipsInputSchema
>;
export type PrepareContentRelationshipRemovalInput = z.infer<
  typeof prepareContentRelationshipRemovalInputSchema
>;
export type RemoveContentRelationPropertyInput = z.infer<
  typeof removeContentRelationPropertyInputSchema
>;
export type ListContentRelationshipHistoryInput = z.infer<
  typeof listContentRelationshipHistoryInputSchema
>;
export type UndoContentRelationshipRevisionInput = z.infer<
  typeof undoContentRelationshipRevisionInputSchema
>;
export type RelationshipCapabilities = z.infer<
  typeof relationshipCapabilitiesSchema
>;
export type ContentRelationshipItem = z.infer<
  typeof contentRelationshipItemSchema
>;
export type RelationshipMutationResultItem = z.infer<
  typeof relationshipMutationResultItemSchema
>;
export type RelationshipInvalidation = z.infer<
  typeof relationshipInvalidationSchema
>;
export type RelationshipCommitReceipt = z.infer<
  typeof relationshipCommitReceiptSchema
>;
export type RelationshipReadState = z.infer<typeof relationshipReadStateSchema>;

export interface ConfigureContentRelationPropertyResult extends RelationshipCommitReceipt {
  relationshipType: RelationshipType;
  relationshipTypeVersion: RelationshipTypeVersion;
  projection: CanonicalRelationProjection;
  inverseProjection?: CanonicalRelationProjection;
  capabilities: RelationshipCapabilities;
  schemaRevision: string;
}

export interface ListContentRelationshipTypesResult {
  scope: "viewer-accessible";
  items: Array<{
    type: RelationshipType;
    version: RelationshipTypeVersion;
    projections: CanonicalRelationProjection[];
    capabilities: RelationshipCapabilities;
  }>;
  nextCursor: string | null;
}

export interface ContentRelationCandidate {
  pageId: string;
  title: string;
  context: Record<string, unknown>;
  /**
   * Opaque observation for this candidate's forward max-one slot. Present on
   * inverse pickers; it reveals no current target and is rechecked on commit.
   */
  slotObservationToken: string | null;
}

export interface ListContentRelationCandidatesResult {
  scope: "viewer-accessible";
  items: ContentRelationCandidate[];
  /** Opaque observation for the fixed source slot in a forward max-one picker. */
  slotObservationToken: string | null;
  nextCursor: string | null;
}

export interface ListContentRelationshipsResult {
  scope: "viewer-accessible";
  items: ContentRelationshipItem[];
  nextCursor: string | null;
}

export interface MutateContentRelationshipsResult extends RelationshipCommitReceipt {
  results: RelationshipMutationResultItem[];
}

export interface PrepareContentRelationshipRemovalResult {
  selectionReceipt: string;
  selectedCount: number;
  edges: Array<{ edgeId: string; observedActivationIds: string[] }>;
  expiresAt: string;
  recoveryToken: string;
}

export interface RemoveContentRelationPropertyResult extends RelationshipCommitReceipt {
  propertyId: string;
  relationshipTypeId: string;
  removedEdgeIds: string[];
  undo: { revisionId: string; recoveryToken: string };
}

export interface ContentRelationshipHistoryEndpoint {
  pageId: string;
  title: string;
}

export interface ContentRelationshipHistoryChange {
  eventId: string;
  kind: "added" | "removed" | "replaced" | "restored";
  relationshipTypeId: string;
  relationshipLabel: string;
  source: ContentRelationshipHistoryEndpoint;
  target: ContentRelationshipHistoryEndpoint;
  previousTarget?: ContentRelationshipHistoryEndpoint;
}

export interface ContentRelationshipHistoryItem {
  revisionId: string;
  eventIds: string[];
  committedAt: string;
  actor: {
    kind: "person" | "agent" | "automation" | "programmatic";
    displayName: string;
    email?: string;
    runId?: string;
    networkProtocol?: "a2a" | "mcp" | "provider-api";
    networkId?: string;
    networkPeer?: string;
    threadId?: string;
    turnId?: string;
  };
  authorizingPrincipal: Record<string, unknown>;
  origin: string;
  operation: string;
  summary: string;
  changes: ContentRelationshipHistoryChange[];
  diff: Record<string, unknown>;
  recovery: { allowed: boolean; recoveryToken?: string };
}

export interface ListContentRelationshipHistoryResult {
  scope: "viewer-accessible";
  items: ContentRelationshipHistoryItem[];
  nextCursor: string | null;
}

export interface UndoContentRelationshipRevisionResult extends RelationshipCommitReceipt {
  undoneRevisionId: string;
  results: RelationshipMutationResultItem[];
  undo: { revisionId: string; recoveryToken: string };
}
