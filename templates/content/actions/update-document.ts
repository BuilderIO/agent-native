import { randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { agentTouchDocument } from "@agent-native/core/collab";
import {
  iconValueSchema,
  parseIconValue,
  serializeIconValue,
  type IconValue,
} from "@agent-native/core/icons";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";
import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { commitCanonicalDocumentBodyMutation } from "../server/lib/canonical-document-body-mutation.js";
import {
  documentEditAttribution,
  requireDocumentRequestActor,
} from "../server/lib/document-attribution.js";
import {
  findDocumentBodyIntent,
  preserveDocumentBodyIntent,
  readDocumentBodyIntents,
  recordDocumentBodyIntent,
} from "../server/lib/document-body-intents.js";
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import { propagateDocumentTitle } from "../server/lib/document-title-propagation.js";
import { nextDocumentUpdatedAt } from "../server/lib/document-updated-at.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type { DocumentUpdateResponse } from "../shared/api.js";
import { applyContentPersonalNavigationPatch } from "../shared/content-personal-navigation-patch.js";
import { mergeDocumentBodyIntents } from "../shared/document-intent-merge.js";
import { inspectNfmFidelity } from "../shared/nfm.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import {
  browserSavePayloadDigest,
  findBrowserSaveAttempt,
  readBrowserSaveAttempt,
  type BrowserSaveAttemptConfirmation,
} from "./_browser-document-save-attempt.js";
import { BUILDER_CMS_BODY_CONTENT_KEY } from "./_builder-cms-source-adapter.js";
import { reconcileInlineDatabasesForDocumentWithDb } from "./_content-database-lifecycle.js";
import {
  migratePersonalDatabaseViewOverrides,
  personalDatabaseViewSettingKey,
} from "./_content-database-personal-view.js";
import {
  favoriteDocumentIds,
  favoritesSystemIds,
  setFavoriteMembership,
} from "./_content-favorites.js";
import { provisionContentSpaces } from "./_content-spaces.js";
import {
  documentContentHash,
  documentRevisionToken,
  parseDocumentRevisionToken,
} from "./_document-edit-mutation.js";
import {
  assertDocumentMutationAccess,
  resolveDocumentAccessForMutation,
} from "./_document-mutation-access.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  lockPreviewDocumentDraftSettlement,
  readDiscardedPreviewDraftGeneration,
  settlePreviewDocumentDraft,
} from "./_preview-document-draft-settlement.js";
import { mutateContentUserSettingTransaction } from "./_user-setting-transaction.js";

// Not (yet) part of the shared API surface — kept local to avoid touching
// shared/api.ts, which another workstream owns concurrently. Structural
// shape only; consumers should narrow on `conflict: true` rather than import
// this type across a package boundary.
export interface DocumentUpdateConflictResponse {
  conflict: true;
  id: string;
  /** Current server document as of the failed compare-and-swap. */
  document: DocumentUpdateResponse;
}

export interface DocumentUpdateSupersededResponse {
  superseded: true;
  id: string;
  document: DocumentUpdateResponse;
  editorSessionId: string;
  editGeneration: number;
  discardedGeneration: number;
}

type BrowserDocumentUpdateResponse = DocumentUpdateResponse & {
  browserSaveAttempt?: BrowserSaveAttemptConfirmation;
  bodyIntentOutcome?: {
    status: "applied" | "displaced-preserved";
    displacedCheckpointId?: string;
  };
};

export interface DocumentUpdatePreservationResponse {
  preservationRequired: true;
  id: string;
  document: DocumentUpdateResponse;
  reason: "structure" | "provenance";
  checkpointId: string;
}

const documentAuditOwner = Symbol("documentAuditOwner");

type DocumentAuditScopedResult = {
  [documentAuditOwner]?: string;
};

function scopeDocumentAudit<T extends object>(result: T, ownerEmail: string) {
  Object.defineProperty(result, documentAuditOwner, { value: ownerEmail });
  return result;
}

function documentUpdateResponse(
  doc: typeof schema.documents.$inferSelect,
  accessRole: NonNullable<DocumentUpdateResponse["accessRole"]>,
  isFavorite: boolean,
  softDeletedDatabaseIds: string[] = [],
  browserSaveAttempt?: BrowserSaveAttemptConfirmation,
): BrowserDocumentUpdateResponse {
  return {
    id: doc.id,
    urlPath: `/page/${doc.id}`,
    parentId: doc.parentId,
    title: doc.title,
    content: doc.content,
    description: doc.description,
    icon: doc.icon,
    position: doc.position,
    isFavorite,
    hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
    visibility: doc.visibility,
    accessRole,
    canComment: canCommentRole(accessRole),
    canEdit: canEditRole(accessRole),
    canManage: canManageRole(accessRole),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    revision: documentRevisionToken(doc.bodyRevision, doc.content),
    bodyRevision: doc.bodyRevision,
    contentHash: documentContentHash(doc.content),
    contentFidelity: inspectNfmFidelity(doc.content),
    source: serializeDocumentSource(doc),
    softDeletedDatabaseIds,
    ...(browserSaveAttempt ? { browserSaveAttempt } : {}),
  };
}

function documentConflictResponse(
  doc: typeof schema.documents.$inferSelect,
  accessRole: NonNullable<DocumentUpdateResponse["accessRole"]>,
  isFavorite: boolean,
): DocumentUpdateConflictResponse {
  return {
    conflict: true,
    id: doc.id,
    document: documentUpdateResponse(doc, accessRole, isFavorite),
  };
}

function isFavoriteOnlyUpdate(args: {
  isFavorite?: boolean;
  title?: string;
  content?: string;
  description?: string;
  icon?: IconValue | string | null;
}) {
  return (
    args.isFavorite !== undefined &&
    args.title === undefined &&
    args.content === undefined &&
    args.description === undefined &&
    args.icon === undefined
  );
}

const reuseLabelSchema = z.object({
  itemId: z.string().min(1).optional(),
  itemVersionId: z.string().min(1).optional(),
  kind: z.string().min(1),
  label: z.string().min(1),
  dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
  elementId: z.string().min(1).optional(),
  influence: z
    .enum(["reused", "adapted", "reference-conditioned", "generated"])
    .optional(),
});

async function documentMutationCreativeContext(input: {
  documentId: string;
  contextPackId?: string;
  contextModeOverride?: "off";
  reuseLabels: CreativeContextReuseLabel[];
  artifactAccessAsserted: boolean;
  skipPreviousRead?: boolean;
}) {
  const previous =
    input.skipPreviousRead || input.contextModeOverride === "off"
      ? null
      : await getGenerationCreativeContext({
          appId: "content",
          artifactType: "document",
          artifactId: input.documentId,
        });
  if (
    !previous &&
    !input.contextPackId &&
    !input.contextModeOverride &&
    !input.reuseLabels.length
  ) {
    return undefined;
  }
  if (
    input.contextPackId !== undefined &&
    previous?.contextPackId &&
    input.contextPackId !== previous.contextPackId
  ) {
    throw new Error(
      "The document update must preserve the document's creative-context pack",
    );
  }
  const requestedLabels: CreativeContextReuseLabel[] = input.reuseLabels.length
    ? input.reuseLabels
    : [
        {
          kind: "document",
          label: "Net-new document update",
          dataRole: "untrusted-reference",
          elementId: input.documentId,
          influence: "generated",
        },
      ];
  const validated = await validateGenerationCreativeContext({
    contextPackId: input.contextPackId ?? previous?.contextPackId,
    contextPackSource:
      input.contextPackId === undefined ? "inherited" : "explicit",
    contextModeOverride: input.contextModeOverride,
    reuseLabels: requestedLabels,
    reuseLabelsSource: input.reuseLabels.length ? "explicit" : "inherited",
  });
  const nextElementProvenance = validated.reuseLabels.map((label) => ({
    elementId: input.documentId,
    influence: label.influence ?? ("reference-conditioned" as const),
    ...(label.itemId ? { itemId: label.itemId } : {}),
    ...(label.itemVersionId ? { itemVersionId: label.itemVersionId } : {}),
    label: label.label,
  }));
  const contextMode =
    validated.contextMode === "off"
      ? "off"
      : (previous?.contextMode ?? validated.contextMode);
  return {
    contextMode,
    contextPackId: validated.contextPackId,
    reuseLabels: validated.reuseLabels,
    elementProvenance:
      contextMode === "off"
        ? nextElementProvenance
        : replaceCreativeContextElementProvenance(
            previous?.elementProvenance ?? [],
            nextElementProvenance,
          ),
  };
}

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
}

function canEditRole(role: string) {
  return role === "owner" || role === "admin" || role === "editor";
}

function canCommentRole(role: string) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "editor" ||
    role === "commenter"
  );
}

async function setFavoriteAndOrder(args: {
  db: ReturnType<typeof getDb>;
  userEmail: string;
  documentId: string;
  favorite: boolean;
  now: string;
}) {
  const favoritesDatabaseId = favoritesSystemIds(args.userEmail).databaseId;
  const settingName = personalDatabaseViewSettingKey(favoritesDatabaseId);
  return mutateContentUserSettingTransaction(
    (callback) => args.db.transaction(callback),
    args.userEmail,
    settingName,
    async (tx, current) => {
      const migrated = migratePersonalDatabaseViewOverrides(
        current,
        favoritesDatabaseId,
        "favorites",
      );
      const activeViewId = migrated?.activeViewId ?? "default";
      const membership = await setFavoriteMembership({
        db: tx as unknown as ReturnType<typeof getDb>,
        userEmail: args.userEmail,
        documentId: args.documentId,
        favorite: args.favorite,
        now: args.now,
      });
      return {
        value: applyContentPersonalNavigationPatch(
          migrated,
          {
            sidebarOrder: {
              operation: args.favorite ? "prepend" : "remove",
              viewId: activeViewId,
              itemId: membership.membershipId,
            },
          },
          [{ id: activeViewId, sorts: [], filters: [], filterMode: "and" }],
        ) as unknown as Record<string, unknown>,
        result: membership,
      };
    },
  );
}

function builderBodyWithoutImageSourceComponentMarkers(
  content: string | null | undefined,
) {
  return (content ?? "")
    .replace(/(?:^|\n)<SourceComponent\b[\s\S]*?\/>[ \t]*(?=\n|$)/g, (marker) =>
      marker.includes('componentName="Image"') ? "\n" : marker,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function builderBodyWithoutMarkdownImages(content: string | null | undefined) {
  return (content ?? "")
    .replace(
      /(?:^|\n)!\[(?:\\.|[^\]\\])*\]\(\S+?(?:\s+"[^"]*")?\)[ \t]*(?=\n|$)/g,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedBuilderBodyProse(content: string | null | undefined) {
  return (content ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isEffectivelyEmptyDocumentContent(
  content: string | null | undefined,
) {
  const normalized = (content ?? "").trim();
  return normalized === "" || normalized === "<empty-block/>";
}

export function shouldRejectStaleEmptyBodySave(args: {
  incomingContent: string | null | undefined;
  currentContent: string | null | undefined;
  loadedUpdatedAt: string | null | undefined;
  currentUpdatedAt: string | null | undefined;
  loadedContentWasEmpty?: boolean | null | undefined;
}) {
  if (!args.loadedUpdatedAt || !args.currentUpdatedAt) return false;
  if (!isEffectivelyEmptyDocumentContent(args.incomingContent)) return false;
  if (isEffectivelyEmptyDocumentContent(args.currentContent)) return false;
  if (args.loadedContentWasEmpty === true) return true;
  return (
    new Date(args.currentUpdatedAt).getTime() >
    new Date(args.loadedUpdatedAt).getTime()
  );
}

/**
 * Best-effort quote of the first changed span between two document bodies, used
 * as the `{ kind: "text", quote }` descriptor so the recent-edit highlight lands
 * on (or near) the region the agent actually rewrote rather than the doc top.
 * Returns a short slice of the new content around the first divergence.
 */
export function firstChangedQuote(
  previous: string,
  next: string,
  maxLen = 80,
): string {
  if (!next) return "";
  if (previous === next) return next.slice(0, maxLen);
  let start = 0;
  const min = Math.min(previous.length, next.length);
  while (start < min && previous[start] === next[start]) start++;
  // Skip leading whitespace so the quote begins on visible text.
  while (start < next.length && /\s/.test(next[start])) start++;
  return next.slice(start, start + maxLen).trim() || next.slice(0, maxLen);
}

export function isStaleBuilderImageSourceComponentSave(args: {
  incomingContent: string;
  currentContent: string;
  sourceContent: string | null | undefined;
}) {
  const sourceContent = args.sourceContent ?? "";
  const currentMatchesSource =
    normalizedBuilderBodyProse(args.currentContent) ===
    normalizedBuilderBodyProse(sourceContent);
  if (
    !args.incomingContent.includes('componentName="Image"') ||
    !sourceContent.includes("![") ||
    sourceContent.includes('componentName="Image"') ||
    !currentMatchesSource
  ) {
    return false;
  }
  return (
    normalizedBuilderBodyProse(
      builderBodyWithoutImageSourceComponentMarkers(args.incomingContent),
    ) ===
    normalizedBuilderBodyProse(builderBodyWithoutMarkdownImages(sourceContent))
  );
}

export default defineAction({
  description:
    "Update an existing document's metadata or browser-owned content. Agents must use get-document followed by edit-document with baseRevision and idempotencyKey for body changes.",
  deferLoading: false,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Update Content Document",
    description:
      "Delegate a sparse metadata update to an existing Content document while preserving omitted fields. For body changes, use get-document followed by edit-document with its revision protocol.",
  },
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New markdown content"),
    description: z
      .string()
      .optional()
      .describe("Stable page guidance; this does not alter page content"),
    icon: z
      .union([z.string(), iconValueSchema])
      .nullable()
      .optional()
      .describe("New emoji, Tabler icon, or uploaded image icon"),
    isFavorite: z.coerce
      .boolean()
      .optional()
      .describe("Favorite status (true/false)"),
    loadedUpdatedAt: z
      .string()
      .optional()
      .describe("Document updatedAt value the client loaded before editing"),
    loadedContentWasEmpty: z
      .boolean()
      .optional()
      .describe("Whether the client-loaded content snapshot was empty"),
    // Optional optimistic-concurrency guard for content saves: the
    // `updatedAt` of the document snapshot the caller last loaded/reconciled.
    // When provided alongside `content`, the write is a compare-and-swap on
    // `updatedAt` instead of a blind overwrite — this is how the browser
    // editor's autosave avoids clobbering a document that a concurrent
    // process (e.g. the Notion auto-pull) updated after the editor's last
    // snapshot but before this save landed. External body edits are rejected
    // below and must use edit-document's revision and receipt protocol.
    baseUpdatedAt: z
      .string()
      .optional()
      .describe(
        "updatedAt of the last-loaded document snapshot; enables compare-and-swap for content saves",
      ),
    baseRevision: z
      .string()
      .optional()
      .describe(
        "Opaque body revision from get-document; guards browser content saves without treating metadata changes as body conflicts",
      ),
    authoredBaseRevision: z.string().optional(),
    authoredBaseContent: z.string().max(500_000).optional(),
    authoredCandidateContent: z.string().max(500_000).optional(),
    baseTitle: z
      .string()
      .optional()
      .describe(
        "Exact title from the caller's base snapshot for a title update",
      ),
    historySessionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Browser editor session ID used to group related title and body saves",
      ),
    editorSessionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Stable browser-tab identity for recovery-draft ordering"),
    editorEditGeneration: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Browser-local edit generation acknowledged by this save; paired with editorSessionId",
      ),
    editorSnapshotTitle: z.string().max(10_000).optional(),
    editorSnapshotContent: z.string().max(500_000).optional(),
    browserSaveAttemptId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Immutable browser save attempt ID; retry with the exact same payload",
      ),
    preserveLeadingTitleHeading: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Preserve a leading H1 that matches the title when reproducing an exact saved body.",
      ),
    contextPackId: z
      .string()
      .optional()
      .describe("Exact Creative Context pack used for this agent update."),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this agent update only without changing the saved preference.",
      ),
    reuseLabels: z
      .array(reuseLabelSchema)
      .optional()
      .default([])
      .describe("Exact item versions that influenced this agent update."),
  }),
  audit: {
    // Document bodies and personal favorite preferences are both sensitive.
    // Keep actor/target/outcome attribution without copying mutation payloads
    // into an owner-visible audit row.
    recordInputs: false,
    target: (args, result) => {
      const favoriteOnly = isFavoriteOnlyUpdate(args);
      return {
        type: "document",
        id: args.id,
        // Favorites are a private preference owned by the actor, even when
        // the underlying document belongs to somebody else.
        ownerEmail: favoriteOnly
          ? undefined
          : (result as DocumentAuditScopedResult | null)?.[documentAuditOwner],
        visibility: "private",
      };
    },
    summary: (args, result) =>
      (result as DocumentUpdateConflictResponse | null)?.conflict
        ? `Document update conflicted for ${args.id}`
        : `Updated document ${args.id}`,
  },
  run: async (
    args,
    ctx,
  ): Promise<
    | BrowserDocumentUpdateResponse
    | DocumentUpdateConflictResponse
    | DocumentUpdateSupersededResponse
    | DocumentUpdatePreservationResponse
  > => {
    const id = args.id;
    if (!id) throw new Error("--id is required");
    if (
      (args.editorSessionId === undefined) !==
      (args.editorEditGeneration === undefined)
    ) {
      throw new ActionContractError(
        "editorSessionId and editorEditGeneration must be provided together.",
        { errorCode: "INVALID_EDITOR_EDIT_IDENTITY", statusCode: 400 },
      );
    }
    if (
      (args.editorSnapshotTitle === undefined) !==
      (args.editorSnapshotContent === undefined)
    ) {
      throw new ActionContractError(
        "editorSnapshotTitle and editorSnapshotContent must be provided together.",
        { errorCode: "INVALID_EDITOR_SNAPSHOT", statusCode: 400 },
      );
    }
    const authoredFields = [
      args.authoredBaseRevision,
      args.authoredBaseContent,
      args.authoredCandidateContent,
    ];
    if (
      authoredFields.some((value) => value !== undefined) &&
      (authoredFields.some((value) => value === undefined) ||
        args.content === undefined ||
        args.editorSessionId === undefined ||
        args.editorEditGeneration === undefined ||
        args.browserSaveAttemptId === undefined)
    ) {
      throw new ActionContractError(
        "Authored body intent requires a complete base, candidate, editor identity, and save attempt ID.",
        { errorCode: "INVALID_AUTHORED_BODY_INTENT", statusCode: 400 },
      );
    }
    const authoredBase = args.authoredBaseRevision
      ? parseDocumentRevisionToken(args.authoredBaseRevision)
      : null;
    if (
      args.authoredBaseRevision &&
      (!authoredBase ||
        authoredBase.contentHash !==
          documentContentHash(args.authoredBaseContent as string))
    ) {
      throw new ActionContractError(
        "The authored body base does not match its revision.",
        { errorCode: "INVALID_AUTHORED_BODY_BASE", statusCode: 400 },
      );
    }
    if (args.isFavorite !== undefined && !isFavoriteOnlyUpdate(args)) {
      throw new ActionContractError(
        "Favorite changes must be submitted separately from document field changes.",
        {
          errorCode: "FAVORITE_UPDATE_MUST_BE_SEPARATE",
          statusCode: 400,
        },
      );
    }
    if (
      args.title !== undefined &&
      args.content !== undefined &&
      args.baseRevision !== undefined &&
      args.baseTitle === undefined
    ) {
      throw new ActionContractError(
        "Combined title and body saves require baseTitle with baseRevision.",
        { errorCode: "BASE_TITLE_REQUIRED", statusCode: 400 },
      );
    }

    const isExternalCaller =
      ctx?.caller === "tool" ||
      ctx?.caller === "mcp" ||
      ctx?.caller === "webmcp" ||
      ctx?.caller === "a2a";
    if (
      args.browserSaveAttemptId !== undefined &&
      (ctx?.caller !== "frontend" ||
        (args.title === undefined && args.content === undefined))
    ) {
      throw new ActionContractError(
        "Browser save attempts require a frontend title or content save.",
        { errorCode: "INVALID_BROWSER_SAVE_ATTEMPT", statusCode: 400 },
      );
    }
    if (isExternalCaller && args.content !== undefined) {
      throw new ActionContractError(
        "External document body updates require get-document followed by edit-document with baseRevision and idempotencyKey.",
        {
          errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
          statusCode: 400,
        },
      );
    }

    // Only surface AI presence for genuine agent invocations (in-app tool loop,
    // sub-agents/A2A → "tool"; external MCP agents → "mcp"). The browser editor
    // autosaves through this same action as "frontend"; those must NOT light the
    // agent flag.
    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";

    const favoriteOnly = isFavoriteOnlyUpdate(args);
    const access = favoriteOnly
      ? await resolveDocumentAccessForMutation(id, "id")
      : await assertDocumentMutationAccess(id, "editor", "id");
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;

    const db = getDb();
    const requestUserEmail = getRequestUserEmail();
    const requestOrgId = getRequestOrgId() ?? "";
    const actor = requireDocumentRequestActor(ctx);
    if (args.browserSaveAttemptId !== undefined && !requestUserEmail) {
      throw new ActionContractError(
        "Browser save attempts require an authenticated user.",
        { errorCode: "BROWSER_SAVE_ACTOR_REQUIRED", statusCode: 401 },
      );
    }
    if (args.isFavorite !== undefined && !requestUserEmail) {
      throw new Error("no authenticated user");
    }
    if (args.isFavorite !== undefined) {
      await provisionContentSpaces(db, requestUserEmail as string);
    }
    const currentFavorite = requestUserEmail
      ? (await favoriteDocumentIds(db, requestUserEmail, [id])).has(id)
      : parseDocumentFavorite(existing.isFavorite);
    const browserSavePayload = args.browserSaveAttemptId
      ? browserSavePayloadDigest(args)
      : undefined;
    const authoredMetadataHash = authoredBase
      ? browserSavePayloadDigest({
          title: args.title,
          baseTitle: args.baseTitle,
          description: args.description,
          icon: args.icon,
          isFavorite: args.isFavorite,
          preserveLeadingTitleHeading: args.preserveLeadingTitleHeading,
        })
      : undefined;
    if (args.browserSaveAttemptId && browserSavePayload) {
      const stored = await findBrowserSaveAttempt({
        db,
        documentId: id,
        actorEmail: (requestUserEmail as string).toLowerCase(),
        orgId: requestOrgId,
        attemptId: args.browserSaveAttemptId,
      });
      if (stored) {
        const receipt = readBrowserSaveAttempt(stored, browserSavePayload);
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        if ("kind" in receipt) {
          return scopeDocumentAudit(
            {
              preservationRequired: true,
              id,
              document: documentUpdateResponse(
                current,
                access.role,
                currentFavorite,
              ),
              reason: receipt.reason,
              checkpointId: receipt.checkpointId,
            } satisfies DocumentUpdatePreservationResponse,
            ownerEmail,
          );
        }
        return scopeDocumentAudit(
          documentUpdateResponse(
            current,
            access.role,
            currentFavorite,
            receipt.softDeletedDatabaseIds ?? [],
            receipt,
          ),
          ownerEmail,
        );
      }
    }

    const normalizeAuthoredContent = (value: string) => {
      if (args.preserveLeadingTitleHeading) return value;
      const titleToCheck = args.title || existing.title;
      if (!titleToCheck) return value;
      const h1Match = value.match(/^#\s+(.+?)(\r?\n|$)/);
      return h1Match &&
        h1Match[1].trim().toLowerCase() === titleToCheck.trim().toLowerCase()
        ? value.slice(h1Match[0].length).trimStart()
        : value;
    };
    let content =
      args.content === undefined
        ? undefined
        : normalizeAuthoredContent(args.content);
    const authoredCandidateContent =
      args.authoredCandidateContent === undefined
        ? undefined
        : normalizeAuthoredContent(args.authoredCandidateContent);
    let browserSaveContentRejected = false;
    if (content !== undefined && !args.preserveLeadingTitleHeading) {
      if (
        content.includes('componentName="Image"') &&
        existing.content.includes("![")
      ) {
        const [builderBody] = await db
          .select({
            sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
          })
          .from(schema.contentDatabaseSourceRows)
          .innerJoin(
            schema.contentDatabaseSources,
            eq(
              schema.contentDatabaseSources.id,
              schema.contentDatabaseSourceRows.sourceId,
            ),
          )
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.documentId, id),
              eq(schema.contentDatabaseSources.sourceType, "builder-cms"),
            ),
          )
          .limit(1);
        const sourceValues = JSON.parse(
          builderBody?.sourceValuesJson ?? "{}",
        ) as Record<string, unknown>;
        const sourceContent = sourceValues[BUILDER_CMS_BODY_CONTENT_KEY];
        if (
          typeof sourceContent === "string" &&
          isStaleBuilderImageSourceComponentSave({
            incomingContent: content,
            currentContent: existing.content,
            sourceContent,
          })
        ) {
          browserSaveContentRejected = true;
          content = existing.content;
        }
      }
      if (
        shouldRejectStaleEmptyBodySave({
          incomingContent: content,
          currentContent: existing.content,
          loadedUpdatedAt: args.loadedUpdatedAt,
          currentUpdatedAt: existing.updatedAt,
          loadedContentWasEmpty: args.loadedContentWasEmpty,
        })
      ) {
        browserSaveContentRejected = true;
        content = existing.content;
      }
    }
    if (browserSaveContentRejected && args.browserSaveAttemptId) {
      return scopeDocumentAudit(
        documentConflictResponse(existing, access.role, currentFavorite),
        ownerEmail,
      );
    }

    // Detect actual changes — a no-op call (e.g. the editor echoing back the
    // same content after a Notion pull) must NOT bump updated_at, otherwise
    // the next sync sees a phantom local change and reports a conflict.
    const titleChanged =
      args.title !== undefined && args.title !== existing.title;
    const contentChanged =
      content !== undefined && content !== existing.content;
    const iconChanged = args.icon !== undefined && args.icon !== existing.icon;
    const favoriteChanged =
      args.isFavorite !== undefined && args.isFavorite !== currentFavorite;
    const descriptionChanged =
      args.description !== undefined &&
      args.description.trim() !== existing.description;
    const anyChange =
      titleChanged ||
      contentChanged ||
      iconChanged ||
      favoriteChanged ||
      descriptionChanged ||
      args.isFavorite === false;

    let softDeletedDatabaseIds: string[] = [];
    let browserSaveConfirmation: BrowserSaveAttemptConfirmation | undefined;
    let bodyIntentOutcome: BrowserDocumentUpdateResponse["bodyIntentOutcome"];
    let discardedEditorGeneration: number | undefined;
    let preservationRequired:
      | { reason: "structure" | "provenance"; checkpointId: string }
      | undefined;
    let creativeContext:
      | Awaited<ReturnType<typeof documentMutationCreativeContext>>
      | undefined;

    // Content saves optionally carry the `updatedAt` of the snapshot the
    // caller last reconciled. Guard the write with a compare-and-swap in that
    // case so a concurrent update (e.g. the Notion auto-pull applying a newer
    // remote edit) between the caller's snapshot and this save landing isn't
    // silently overwritten. A recovery may carry unchanged content alongside
    // a stale title, so supplying content still guards the whole write.
    // Title/icon/favorite-only requests without content remain unaffected.
    const useBodyRevisionCas =
      args.content !== undefined && args.baseRevision !== undefined;
    const useDocumentCas =
      args.content !== undefined &&
      args.baseRevision === undefined &&
      args.baseUpdatedAt !== undefined;

    const settlesPreviewDraft =
      ctx?.caller === "frontend" &&
      !!requestUserEmail &&
      !!args.editorSessionId &&
      args.editorEditGeneration !== undefined &&
      (args.title !== undefined || args.content !== undefined);

    if (anyChange || settlesPreviewDraft || args.browserSaveAttemptId) {
      let contentCasConflict = false;
      let committedContentChanged = false;
      let committedContentBefore = existing.content;
      let committedEditorSnapshot: { title: string; content: string } | null =
        null;
      const mutate = async (tx: any) => {
        await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .for("update");
        if (args.browserSaveAttemptId && browserSavePayload) {
          const stored = await findBrowserSaveAttempt({
            db: tx as ReturnType<typeof getDb>,
            documentId: id,
            actorEmail: (requestUserEmail as string).toLowerCase(),
            orgId: requestOrgId,
            attemptId: args.browserSaveAttemptId,
          });
          if (stored) {
            const receipt = readBrowserSaveAttempt(stored, browserSavePayload);
            if ("kind" in receipt) {
              preservationRequired = {
                reason: receipt.reason,
                checkpointId: receipt.checkpointId,
              };
            } else {
              browserSaveConfirmation = receipt;
            }
            return;
          }
        }
        if (settlesPreviewDraft) {
          await lockPreviewDocumentDraftSettlement({
            db: tx,
            ownerEmail: requestUserEmail as string,
            orgId: requestOrgId,
            documentId: id,
            editorSessionId: args.editorSessionId as string,
            now: new Date().toISOString(),
          });
          const discardedGeneration = await readDiscardedPreviewDraftGeneration(
            {
              db: tx,
              ownerEmail: requestUserEmail as string,
              orgId: requestOrgId,
              documentId: id,
              editorSessionId: args.editorSessionId as string,
            },
          );
          if (
            discardedGeneration !== null &&
            (args.editorEditGeneration as number) <= discardedGeneration
          ) {
            discardedEditorGeneration = discardedGeneration;
            return;
          }
        }
        const [historyBefore] = await tx
          .select({
            title: schema.documents.title,
            content: schema.documents.content,
            bodyRevision: schema.documents.bodyRevision,
            description: schema.documents.description,
            icon: schema.documents.icon,
            updatedAt: schema.documents.updatedAt,
          })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .limit(1);
        const confirmBrowserSave = async (
          snapshot: { title: string; content: string },
          now: string,
        ) => {
          if (
            settlesPreviewDraft &&
            args.editorSnapshotTitle !== undefined &&
            args.editorSnapshotContent !== undefined &&
            snapshot.title === args.editorSnapshotTitle &&
            (snapshot.content === args.editorSnapshotContent ||
              bodyIntentOutcome?.status === "applied" ||
              bodyIntentOutcome?.status === "displaced-preserved")
          ) {
            await settlePreviewDocumentDraft({
              db: tx,
              ownerEmail: requestUserEmail as string,
              orgId: requestOrgId,
              documentId: id,
              editorSessionId: args.editorSessionId as string,
              editGeneration: args.editorEditGeneration as number,
              now,
            });
          }
          if (args.browserSaveAttemptId && browserSavePayload) {
            const [confirmed] = await tx
              .select({
                bodyRevision: schema.documents.bodyRevision,
                content: schema.documents.content,
                updatedAt: schema.documents.updatedAt,
              })
              .from(schema.documents)
              .where(eq(schema.documents.id, id))
              .limit(1);
            const confirmation: BrowserSaveAttemptConfirmation = {
              attemptId: args.browserSaveAttemptId,
              result: "applied",
              revision: documentRevisionToken(
                confirmed.bodyRevision,
                confirmed.content,
              ),
              updatedAt: confirmed.updatedAt,
              softDeletedDatabaseIds,
            };
            await tx.insert(schema.documentBrowserSaveAttempts).values({
              id: randomUUID(),
              ownerEmail,
              orgId: requestOrgId,
              documentId: id,
              actorEmail: (requestUserEmail as string).toLowerCase(),
              attemptId: args.browserSaveAttemptId,
              payloadDigest: browserSavePayload,
              resultJson: JSON.stringify(confirmation),
            });
            browserSaveConfirmation = confirmation;
          }
        };
        if (authoredBase && authoredCandidateContent !== undefined) {
          const prior = await findDocumentBodyIntent({
            db: tx as ReturnType<typeof getDb>,
            ownerEmail,
            documentId: id,
            writerId: `browser:${(requestUserEmail as string).toLowerCase()}:${args.editorSessionId}`,
            operationId: `${args.editorSessionId}:${args.editorEditGeneration}`,
          });
          if (prior) {
            if (
              prior.authoredBaseRevision !== authoredBase.revision ||
              prior.candidateHash !==
                documentContentHash(authoredCandidateContent) ||
              prior.metadataHash !== authoredMetadataHash
            ) {
              throw new ActionContractError(
                "An editor generation cannot be reused with a different authored body.",
                { errorCode: "EDITOR_BODY_INTENT_REUSED", statusCode: 409 },
              );
            }
            bodyIntentOutcome = prior.displacedCheckpointId
              ? {
                  status: "displaced-preserved",
                  displacedCheckpointId: prior.displacedCheckpointId,
                }
              : { status: "applied" };
            await confirmBrowserSave(historyBefore, historyBefore.updatedAt);
            return;
          }
        }
        let intentMerge:
          | Extract<
              ReturnType<typeof mergeDocumentBodyIntents>,
              { status: "resolved" }
            >
          | undefined;
        if (authoredBase && authoredCandidateContent !== undefined) {
          const priorIntents = await readDocumentBodyIntents({
            db: tx as ReturnType<typeof getDb>,
            ownerEmail,
            documentId: id,
            afterRevision: authoredBase.revision,
            throughRevision: historyBefore.bodyRevision,
          });
          const resolved = mergeDocumentBodyIntents({
            authoredBaseContent: args.authoredBaseContent as string,
            authoredCandidateContent,
            currentContent: historyBefore.content,
            currentRevision: historyBefore.bodyRevision,
            incoming: {
              writerId: `browser:${(requestUserEmail as string).toLowerCase()}:${args.editorSessionId}`,
              operationId: `${args.editorSessionId}:${args.editorEditGeneration}`,
              generation: args.editorEditGeneration,
              authoredBaseRevision: authoredBase.revision,
            },
            priorIntents,
          });
          if (resolved.status === "preservation-required") {
            const checkpointId = await preserveDocumentBodyIntent({
              db: tx as ReturnType<typeof getDb>,
              ownerEmail,
              documentId: id,
              title: args.title ?? historyBefore.title,
              candidateContent: authoredCandidateContent,
              actorEmail: requestUserEmail ?? null,
              origin: "frontend",
              operation: "update-document-preservation",
              now: nextDocumentUpdatedAt(historyBefore.updatedAt),
            });
            preservationRequired = { reason: resolved.reason, checkpointId };
            if (args.browserSaveAttemptId && browserSavePayload) {
              await tx.insert(schema.documentBrowserSaveAttempts).values({
                id: randomUUID(),
                ownerEmail,
                orgId: requestOrgId,
                documentId: id,
                actorEmail: (requestUserEmail as string).toLowerCase(),
                attemptId: args.browserSaveAttemptId,
                payloadDigest: browserSavePayload,
                resultJson: JSON.stringify({
                  kind: "preservation-required",
                  attemptId: args.browserSaveAttemptId,
                  result: "applied",
                  revision: documentRevisionToken(
                    historyBefore.bodyRevision,
                    historyBefore.content,
                  ),
                  updatedAt: historyBefore.updatedAt,
                  reason: resolved.reason,
                  checkpointId,
                }),
              });
            }
            return;
          }
          intentMerge = resolved;
          content = resolved.content;
        }
        const lockedTitleChanged =
          args.title !== undefined && args.title !== historyBefore.title;
        const lockedContentChanged =
          content !== undefined && content !== historyBefore.content;
        const lockedDescriptionChanged =
          args.description !== undefined &&
          args.description.trim() !== historyBefore.description;
        const lockedIconChanged =
          args.icon !== undefined && args.icon !== historyBefore.icon;
        const lockedDocumentFieldsChanged =
          lockedTitleChanged ||
          lockedContentChanged ||
          lockedDescriptionChanged ||
          lockedIconChanged;
        const parsedBaseRevision = args.baseRevision
          ? parseDocumentRevisionToken(args.baseRevision)
          : null;
        if (args.baseRevision && !parsedBaseRevision) {
          throw new ActionContractError(
            "baseRevision is not a valid document revision token.",
            { errorCode: "INVALID_BASE_REVISION", statusCode: 400 },
          );
        }
        if (
          lockedContentChanged &&
          args.baseRevision &&
          !intentMerge &&
          args.baseRevision !==
            documentRevisionToken(
              historyBefore.bodyRevision,
              historyBefore.content,
            )
        ) {
          contentCasConflict = true;
          return;
        }
        if (
          lockedTitleChanged &&
          args.baseTitle !== undefined &&
          historyBefore.title !== args.baseTitle
        ) {
          contentCasConflict = true;
          return;
        }
        const updatedAt = nextDocumentUpdatedAt(historyBefore.updatedAt);
        const updates: Record<string, unknown> = { updatedAt };
        if (lockedTitleChanged) updates.title = args.title;
        if (lockedDescriptionChanged)
          updates.description = args.description?.trim();
        if (lockedContentChanged) {
          updates.content = content;
          updates.bodyRevision = historyBefore.bodyRevision + 1;
        }
        if (lockedIconChanged)
          updates.icon =
            args.icon === null
              ? null
              : serializeIconValue(parseIconValue(args.icon));
        if (lockedTitleChanged || lockedContentChanged) {
          Object.assign(updates, documentEditAttribution(actor));
        }
        const primaryBlocksFields = lockedContentChanged
          ? await lockPrimaryBlocksFields(
              tx as unknown as ReturnType<typeof getDb>,
              id,
            )
          : [];
        const applied = await commitCanonicalDocumentBodyMutation({
          write: async () => {
            if (
              intentMerge ||
              (useBodyRevisionCas && lockedContentChanged) ||
              useDocumentCas
            ) {
              const rows = await tx
                .update(schema.documents)
                .set(updates)
                .where(
                  and(
                    eq(schema.documents.id, id),
                    ...(intentMerge || parsedBaseRevision
                      ? [
                          eq(
                            schema.documents.bodyRevision,
                            intentMerge
                              ? historyBefore.bodyRevision
                              : parsedBaseRevision!.revision,
                          ),
                        ]
                      : [
                          eq(
                            schema.documents.updatedAt,
                            args.baseUpdatedAt as string,
                          ),
                        ]),
                  ),
                )
                .returning({ id: schema.documents.id });
              return rows.length > 0;
            }
            if (lockedDocumentFieldsChanged) {
              await tx
                .update(schema.documents)
                .set(updates)
                .where(eq(schema.documents.id, id));
            }
            return true;
          },
          afterWrite: async () => {
            if (lockedContentChanged && content !== undefined) {
              for (const field of primaryBlocksFields) {
                await persistBlocksFieldIdentity({
                  db: tx as unknown as ReturnType<typeof getDb>,
                  ownerEmail: field.ownerEmail,
                  documentId: id,
                  propertyId: field.propertyId,
                  previousMarkdown: historyBefore.content,
                  markdown: content,
                  now: updatedAt,
                });
              }
            }
          },
        });
        if (!applied) {
          contentCasConflict = true;
          return;
        }
        committedContentChanged = lockedContentChanged;
        committedContentBefore = historyBefore.content;

        if (lockedTitleChanged && args.title !== undefined) {
          await propagateDocumentTitle({
            db: tx as unknown as ReturnType<typeof getDb>,
            documentId: id,
            title: args.title,
            updatedAt,
          });
        }
        if (lockedTitleChanged || lockedContentChanged) {
          const [after] = await tx
            .select({
              title: schema.documents.title,
              content: schema.documents.content,
            })
            .from(schema.documents)
            .where(eq(schema.documents.id, id))
            .limit(1);
          committedEditorSnapshot = after;
          await recordDocumentHistoryTransition({
            db: tx as unknown as ReturnType<typeof getDb>,
            ownerEmail,
            documentId: id,
            before: historyBefore,
            after,
            beforeBodyRevision: historyBefore.bodyRevision,
            afterBodyRevision:
              historyBefore.bodyRevision + (lockedContentChanged ? 1 : 0),
            cause: {
              ctx,
              historySessionId: args.historySessionId,
              operation: "update-document",
            },
            now: updatedAt,
          });
        }
        if (intentMerge && authoredBase) {
          const intent = {
            writerId: `browser:${(requestUserEmail as string).toLowerCase()}:${args.editorSessionId}`,
            operationId: `${args.editorSessionId}:${args.editorEditGeneration}`,
            generation: args.editorEditGeneration,
            authoredBaseRevision: authoredBase.revision,
          };
          const displacedCheckpointId = intentMerge.displaced
            ? await preserveDocumentBodyIntent({
                db: tx as ReturnType<typeof getDb>,
                ownerEmail,
                documentId: id,
                title: historyBefore.title,
                candidateContent: authoredCandidateContent as string,
                actorEmail: requestUserEmail ?? null,
                origin: "frontend",
                operation: "update-document-displaced",
                now: updatedAt,
              })
            : undefined;
          await recordDocumentBodyIntent({
            db: tx as ReturnType<typeof getDb>,
            ownerEmail,
            orgId: requestOrgId,
            documentId: id,
            intent,
            candidateHash: documentContentHash(
              authoredCandidateContent as string,
            ),
            metadataHash: authoredMetadataHash,
            committedRevision:
              historyBefore.bodyRevision + (lockedContentChanged ? 1 : 0),
            changedBlockIndexes: intentMerge.changedBlockIndexes,
            canonicalChanged: lockedContentChanged,
            displacedCheckpointId,
            now: updatedAt,
          });
          bodyIntentOutcome = intentMerge.displaced
            ? { status: "displaced-preserved", displacedCheckpointId }
            : { status: "applied" };
        }
        if (lockedContentChanged && content !== undefined) {
          softDeletedDatabaseIds =
            await reconcileInlineDatabasesForDocumentWithDb({
              db: tx as ReturnType<typeof getDb>,
              documentId: id,
              content,
              ownerEmail,
              now: updatedAt,
            });
        }
        if (
          (settlesPreviewDraft || args.browserSaveAttemptId) &&
          committedEditorSnapshot === null
        ) {
          const [snapshot] = await tx
            .select({
              title: schema.documents.title,
              content: schema.documents.content,
            })
            .from(schema.documents)
            .where(eq(schema.documents.id, id))
            .limit(1);
          committedEditorSnapshot = snapshot ?? null;
        }
        if (committedEditorSnapshot)
          await confirmBrowserSave(committedEditorSnapshot, updatedAt);
      };
      if (
        (favoriteChanged || args.isFavorite === false) &&
        !settlesPreviewDraft
      ) {
        await setFavoriteAndOrder({
          db,
          userEmail: requestUserEmail as string,
          documentId: id,
          favorite: args.isFavorite as boolean,
          now: nextDocumentUpdatedAt(existing.updatedAt),
        });
      } else {
        try {
          await db.transaction(mutate);
        } catch (error) {
          if (!args.browserSaveAttemptId || !browserSavePayload) throw error;
          const stored = await findBrowserSaveAttempt({
            db,
            documentId: id,
            actorEmail: (requestUserEmail as string).toLowerCase(),
            orgId: requestOrgId,
            attemptId: args.browserSaveAttemptId,
          });
          if (!stored) throw error;
          const receipt = readBrowserSaveAttempt(stored, browserSavePayload);
          if ("kind" in receipt) {
            preservationRequired = {
              reason: receipt.reason,
              checkpointId: receipt.checkpointId,
            };
          } else {
            browserSaveConfirmation = receipt;
          }
        }
      }

      if (discardedEditorGeneration !== undefined) {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        return scopeDocumentAudit(
          {
            superseded: true,
            id,
            document: documentUpdateResponse(
              current,
              access.role,
              currentFavorite,
            ),
            editorSessionId: args.editorSessionId as string,
            editGeneration: args.editorEditGeneration as number,
            discardedGeneration: discardedEditorGeneration,
          } satisfies DocumentUpdateSupersededResponse,
          ownerEmail,
        );
      }

      if (browserSaveConfirmation?.result === "replayed") {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        return scopeDocumentAudit(
          documentUpdateResponse(
            current,
            access.role,
            currentFavorite,
            browserSaveConfirmation.softDeletedDatabaseIds ?? [],
            browserSaveConfirmation,
          ),
          ownerEmail,
        );
      }

      if (preservationRequired) {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        return scopeDocumentAudit(
          {
            preservationRequired: true,
            id,
            document: documentUpdateResponse(
              current,
              access.role,
              currentFavorite,
            ),
            ...preservationRequired,
          } satisfies DocumentUpdatePreservationResponse,
          ownerEmail,
        );
      }

      if (contentCasConflict) {
        // Someone else's write landed after the caller's snapshot. Don't
        // apply this save at all (title/icon/favorite included — a partial
        // apply would desync the fields from what the caller believes it
        // just sent) and hand back the current server row instead so the
        // caller can reconcile.
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        return scopeDocumentAudit(
          documentConflictResponse(current, access.role, currentFavorite),
          ownerEmail,
        );
      }

      // Make an agent full-content rewrite visible as a live collaborator. This
      // path replaces the whole body (not a find/replace), so it can't route
      // through `searchAndReplace`; it keeps the SQL + reconcile delivery and
      // publishes agent presence + a lingering recent-edit highlight near the
      // first changed span. Best-effort — never fail the save on presence.
      if (isAgentCaller && committedContentChanged) {
        try {
          agentTouchDocument(id, {
            edit: {
              descriptor: {
                kind: "text",
                quote: firstChangedQuote(committedContentBefore, content ?? ""),
              },
              label: (args.title ?? existing.title) || undefined,
            },
          });
        } catch (error) {
          console.error(
            "update-document: agent presence publish failed",
            error,
          );
        }
      }
      if (isAgentCaller) {
        creativeContext = await documentMutationCreativeContext({
          documentId: id,
          contextPackId: args.contextPackId,
          contextModeOverride: args.contextModeOverride,
          reuseLabels: args.reuseLabels,
          artifactAccessAsserted: true,
        });
        if (creativeContext) {
          await recordGenerationCreativeContext({
            appId: "content",
            artifactType: "document",
            artifactId: id,
            ...creativeContext,
          });
        }
      }
    }

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    const finalFavorite = requestUserEmail
      ? (await favoriteDocumentIds(db, requestUserEmail, [id])).has(id)
      : parseDocumentFavorite(doc.isFavorite);

    await writeAppState("refresh-signal", { ts: Date.now() });

    if (isAgentCaller && doc.content !== existing.content) {
      track(
        "ai_refine_used",
        {
          app_name: "content",
          template_name: "content",
          output_id: id,
          output_type: "document",
          edit_count: 1,
          refine_type: "full_update",
        },
        ctx,
      );
    }

    return scopeDocumentAudit(
      {
        ...documentUpdateResponse(
          doc,
          access.role,
          finalFavorite,
          softDeletedDatabaseIds,
          browserSaveConfirmation,
        ),
        ...(bodyIntentOutcome ? { bodyIntentOutcome } : {}),
        ...(creativeContext
          ? {
              contextMode: creativeContext.contextMode,
              contextPackId: creativeContext.contextPackId,
              reuseLabels: creativeContext.reuseLabels,
            }
          : {}),
      } satisfies BrowserDocumentUpdateResponse,
      ownerEmail,
    );
  },
});
