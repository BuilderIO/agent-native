import { createHash } from "node:crypto";

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import {
  assertReviewableResourceAccess,
  insertReviewCommentIdempotently,
  insertReviewReplyIdempotently,
  queryReviewComments,
  resolveReviewThread,
  type ReviewComment,
  type ReviewResourceContext,
} from "@agent-native/core/review";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  fetchFigmaNodeSnapshot,
  providerJson,
} from "../server/lib/figma-node-import.js";
import { assertFigmaSyncEnabled } from "../server/lib/figma-sync-flag.js";
import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import { parseFigmaFileKey, parseFigmaNodeId } from "../shared/figma-url.js";

interface FigmaComment {
  id: string;
  message: string;
  parent_id?: string | null;
  resolved_at?: string | null;
  created_at?: string;
  client_meta?: unknown;
  user?: { id?: string; handle?: string };
}

interface LocalFigmaMapping {
  figmaCommentId?: string;
  pendingSince?: string;
  messageHash: string;
  parentFigmaCommentId: string | null;
}

const LOCAL_MAPPING_KEY = "figmaCommentMappings";

const schemaInput = z.object({
  designId: z.string().min(1).describe("Design project id."),
  fileId: z
    .string()
    .min(1)
    .describe("Linked Design screen used to identify the source file."),
  direction: z
    .enum(["from-figma", "to-figma", "both"])
    .default("both")
    .describe(
      "Sync comments from the linked source into Design, from Design to the linked source, or both. Resolved state is mirrored into Design; the connected API cannot resolve or reopen a source thread.",
    ),
});

const errors = defineActionErrors(
  "figma_sync_disabled",
  "figma_comment_sync_pending",
  "figma_comments_auth_failed",
  "figma_comments_auth_required",
  "figma_comments_identity_mismatch",
  "figma_comments_invalid_request",
  "figma_comments_invalid_response",
  "figma_comments_owner_required",
  "figma_comments_personal_draft_required",
  "figma_comments_target_not_found",
  "figma_comments_write_forbidden",
  "figma_sync_screen_missing",
  "figma_sync_unlinked",
  "invalid_design_data",
  "not_found",
);

function failAction(
  message: string,
  options: {
    errorCode: (typeof errors.codes)[number];
    statusCode?: number;
    details?: Record<string, unknown>;
  },
): never {
  return errors.fail(message, options.errorCode, {
    ...(options.statusCode === undefined
      ? {}
      : { statusCode: options.statusCode }),
    ...(options.details === undefined ? {} : { details: options.details }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDesignData(serialized: string | null): Record<string, unknown> {
  if (!serialized) return {};
  try {
    const value: unknown = JSON.parse(serialized);
    return isRecord(value) ? value : {};
  } catch {
    failAction("Design data is invalid and cannot be synchronized.", {
      errorCode: "invalid_design_data",
      statusCode: 409,
    });
  }
}

function parseFigmaComments(envelope: unknown): FigmaComment[] {
  const payload = providerJson(envelope, "comments");
  if (!isRecord(payload) || !Array.isArray(payload.comments)) {
    failAction("The connected source returned an invalid comment list.", {
      errorCode: "figma_comments_invalid_response",
      statusCode: 502,
    });
  }
  return payload.comments.filter(
    (comment): comment is FigmaComment =>
      isRecord(comment) &&
      typeof comment.id === "string" &&
      typeof comment.message === "string",
  );
}

function stableLocalId(fileKey: string, commentId: string): string {
  return `figma-comment-${createHash("sha256")
    .update(`${fileKey}\0${commentId}`)
    .digest("hex")}`;
}

function metadataForFigmaComment(
  fileKey: string,
  comment: FigmaComment,
): Record<string, unknown> {
  return {
    figmaSync: {
      fileKey,
      commentId: comment.id,
      parentCommentId: comment.parent_id ?? null,
      userId: comment.user?.id ?? null,
      handle: comment.user?.handle ?? null,
      createdAt: comment.created_at ?? null,
      resolvedAt: comment.resolved_at ?? null,
      clientMeta: comment.client_meta ?? null,
    },
  };
}

function figmaSyncMetadata(comment: ReviewComment): Record<string, unknown> {
  return isRecord(comment.metadata?.figmaSync)
    ? comment.metadata.figmaSync
    : {};
}

function commentIdFromMetadata(comment: ReviewComment, fileKey: string) {
  const metadata = figmaSyncMetadata(comment);
  return metadata.fileKey === fileKey && typeof metadata.commentId === "string"
    ? metadata.commentId
    : null;
}

function readLocalMappings(
  data: Record<string, unknown>,
  fileKey: string,
): Record<string, LocalFigmaMapping> {
  const rootValue = data[LOCAL_MAPPING_KEY];
  const root = isRecord(rootValue) ? rootValue : {};
  const fileValue = root[fileKey];
  const file = isRecord(fileValue) ? fileValue : {};
  return file as Record<string, LocalFigmaMapping>;
}

async function writeLocalMapping(input: {
  designId: string;
  fileKey: string;
  reviewCommentId: string;
  mapping: LocalFigmaMapping | null;
  expectedPendingSince?: string;
  requireAbsent?: boolean;
}) {
  const expected = input.mapping;
  return mutateDesignData({
    designId: input.designId,
    lockSourceMutation: true,
    mutate: (current, { updatedAt }) => {
      const rootValue = current[LOCAL_MAPPING_KEY];
      const root = isRecord(rootValue) ? rootValue : {};
      const fileValue = root[input.fileKey];
      const file = isRecord(fileValue) ? fileValue : {};
      const existing = file[input.reviewCommentId];
      if (input.requireAbsent && existing) {
        failAction(
          "This comment is already being synchronized. Run sync again to verify it.",
          {
            errorCode: "figma_comment_sync_pending",
            statusCode: 409,
          },
        );
      }
      if (
        input.expectedPendingSince &&
        (!isRecord(existing) ||
          existing.pendingSince !== input.expectedPendingSince)
      ) {
        failAction(
          "The comment sync state changed while this request was running. Sync again to verify it.",
          {
            errorCode: "figma_comment_sync_pending",
            statusCode: 409,
          },
        );
      }
      const nextFile = { ...file };
      if (expected) nextFile[input.reviewCommentId] = expected;
      else delete nextFile[input.reviewCommentId];
      return {
        ...current,
        [LOCAL_MAPPING_KEY]: { ...root, [input.fileKey]: nextFile },
        updatedAt,
      };
    },
    isApplied: (persisted) => {
      const mappings = readLocalMappings(persisted, input.fileKey);
      return expected
        ? JSON.stringify(mappings[input.reviewCommentId]) ===
            JSON.stringify(expected)
        : mappings[input.reviewCommentId] === undefined;
    },
  });
}

function matchingFigmaComments(input: {
  comments: FigmaComment[];
  body: string;
  parentId: string | null;
  userId: string;
  since: string;
}): FigmaComment[] {
  const since = Date.parse(input.since);
  return input.comments.filter((comment) => {
    const createdAt = comment.created_at ? Date.parse(comment.created_at) : NaN;
    return (
      comment.message === input.body &&
      (comment.parent_id ?? null) === input.parentId &&
      comment.user?.id === input.userId &&
      Number.isFinite(createdAt) &&
      Number.isFinite(since) &&
      createdAt >= since
    );
  });
}

function localCommentMapping(
  mapping: LocalFigmaMapping | undefined,
): string | null {
  return typeof mapping?.figmaCommentId === "string"
    ? mapping.figmaCommentId
    : null;
}

function hasExternalMentions(comment: ReviewComment): boolean {
  if (comment.mentions.length > 0) return true;
  return /(^|\s)@[\w.+-]+/.test(comment.body);
}

function isOwnHumanComment(comment: ReviewComment, email: string): boolean {
  return (
    comment.createdBy === "human" &&
    comment.authorEmail?.trim().toLowerCase() === email &&
    !hasExternalMentions(comment)
  );
}

async function requestFigma(input: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}) {
  return executeProviderApiRequest({
    provider: "figma",
    method: input.method,
    path: input.path,
    ...(input.query ? { query: input.query } : {}),
    ...(input.body ? { body: input.body } : {}),
    maxBytes: 4 * 1024 * 1024,
  });
}

export default defineAction({
  description:
    "Sync comments for a linked Design screen with its source file. Imports author handles, reply threads, source location metadata, and resolved state into Design; publishes only comments written by the connected user and only to a Draft the connected account created and owns. Repeated syncs are idempotent. The API can delete comments but this action does not sync deletions; it cannot edit comment text or source resolution state. Ambiguous POST results are reconciled before any retry.",
  schema: schemaInput,
  outputSchema: z
    .object({
      fileKey: z.string(),
      direction: z.enum(["from-figma", "to-figma", "both"]),
      imported: z.number().int().nonnegative(),
      resolved: z.number().int().nonnegative(),
      published: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      warnings: z.array(z.string()),
      resolvedStateDirection: z.literal("Source to Design"),
    })
    .strict(),
  errors,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args, context) => {
    await assertFigmaSyncEnabled();
    await assertAccess("design", args.designId, "editor");
    const reviewContext = context as ReviewResourceContext | undefined;
    const reviewAccess = await assertReviewableResourceAccess(
      "design",
      args.designId,
      reviewContext,
      "editor",
    );
    const [design] = await getDb()
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, args.designId));
    if (!design) {
      failAction("Design not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    const [screen] = await getDb()
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, args.fileId),
          eq(schema.designFiles.designId, args.designId),
        ),
      );
    if (!screen) {
      failAction("Choose a screen linked to the source file.", {
        errorCode: "figma_sync_screen_missing",
        statusCode: 404,
      });
    }
    const designData = parseDesignData(design.data);
    const screenMetadata = isRecord(designData.screenMetadata)
      ? designData.screenMetadata
      : {};
    const metadata = screenMetadata[args.fileId];
    const fileKey = isRecord(metadata) ? metadata.figmaFileKey : null;
    const nodeId = isRecord(metadata) ? metadata.figmaNodeId : null;
    if (
      typeof fileKey !== "string" ||
      parseFigmaFileKey(fileKey) !== fileKey ||
      typeof nodeId !== "string" ||
      parseFigmaNodeId(nodeId) !== nodeId
    ) {
      failAction("This screen is not linked to a readable source file.", {
        errorCode: "figma_sync_unlinked",
        statusCode: 409,
      });
    }

    const figmaNode = await fetchFigmaNodeSnapshot(fileKey, nodeId);
    const commentsPath = `/files/${encodeURIComponent(fileKey)}/comments`;
    const externalComments = parseFigmaComments(
      await requestFigma({
        method: "GET",
        path: commentsPath,
        query: { as_md: true },
      }),
    );
    const existingReviewComments = await queryReviewComments({
      resourceType: "design",
      resourceId: args.designId,
      scope: {
        userEmail: reviewContext?.userEmail ?? null,
        orgId: reviewContext?.orgId ?? null,
      },
      bypassScope: true,
      includeResolved: true,
      limit: 5000,
    });
    const commentsByFigmaId = new Map<string, ReviewComment>();
    for (const comment of existingReviewComments) {
      const externalId = commentIdFromMetadata(comment, fileKey);
      if (externalId) commentsByFigmaId.set(externalId, comment);
    }
    const result = {
      imported: 0,
      resolved: 0,
      published: 0,
      skipped: 0,
      warnings: [] as string[],
    };

    if (args.direction !== "to-figma") {
      const roots = externalComments.filter((comment) => !comment.parent_id);
      const replies = externalComments.filter((comment) =>
        Boolean(comment.parent_id),
      );
      for (const remote of roots) {
        let local = commentsByFigmaId.get(remote.id);
        if (!local) {
          const authorName = remote.user?.handle?.trim()
            ? remote.user.handle.trim()
            : "Source commenter";
          const inserted = await insertReviewCommentIdempotently({
            id: stableLocalId(fileKey, remote.id),
            resourceType: "design",
            resourceId: args.designId,
            body: remote.message,
            authorName,
            authorEmail: null,
            ownerEmail:
              reviewAccess.ownerEmail ?? reviewContext?.userEmail ?? null,
            orgId: reviewAccess.orgId ?? reviewContext?.orgId ?? null,
            visibility: reviewAccess.visibility ?? "private",
            createdBy: "import",
            metadata: metadataForFigmaComment(fileKey, remote),
          });
          local = inserted.comment;
          commentsByFigmaId.set(remote.id, local);
          if (!inserted.replayed) result.imported += 1;
        }
        const remoteStatus = remote.resolved_at ? "resolved" : "open";
        if (local.status !== remoteStatus) {
          await resolveReviewThread(
            local.threadId,
            null,
            { resourceType: "design", resourceId: args.designId },
            undefined,
            remoteStatus,
          );
          result.resolved += remoteStatus === "resolved" ? 1 : 0;
        }
      }
      for (const remote of replies) {
        if (commentsByFigmaId.has(remote.id)) continue;
        const parent = remote.parent_id
          ? commentsByFigmaId.get(remote.parent_id)
          : undefined;
        if (!parent) {
          result.skipped += 1;
          result.warnings.push(
            `Reply ${remote.id} was skipped because its root comment is not available in the source response.`,
          );
          continue;
        }
        const inserted = await insertReviewReplyIdempotently(
          {
            id: stableLocalId(fileKey, remote.id),
            resourceType: "design",
            resourceId: args.designId,
            threadId: parent.threadId,
            parentCommentId: parent.id,
            targetId: parent.targetId,
            kind: parent.kind,
            anchor: parent.anchor,
            body: remote.message,
            authorName: remote.user?.handle?.trim()
              ? remote.user.handle.trim()
              : "Source commenter",
            authorEmail: null,
            ownerEmail:
              reviewAccess.ownerEmail ?? reviewContext?.userEmail ?? null,
            orgId: reviewAccess.orgId ?? reviewContext?.orgId ?? null,
            visibility: reviewAccess.visibility ?? "private",
            createdBy: "import",
            mentions: [],
            metadata: metadataForFigmaComment(fileKey, remote),
          },
          null,
          { resourceType: "design", resourceId: args.designId },
        );
        commentsByFigmaId.set(remote.id, inserted.comment);
        if (!inserted.replayed) result.imported += 1;
      }
    }

    if (args.direction !== "from-figma") {
      const userEmail = getRequestUserEmail()?.trim().toLowerCase();
      if (!userEmail) {
        failAction("Sign in to publish comments to the connected source.", {
          errorCode: "figma_comments_auth_required",
          statusCode: 401,
        });
      }
      if (figmaNode.role !== "owner") {
        failAction(
          "Publishing comments is limited to a personal Draft created and owned by the connected account.",
          {
            errorCode: "figma_comments_owner_required",
            statusCode: 403,
          },
        );
      }
      const currentUser = providerJson(
        await requestFigma({ method: "GET", path: "/me" }),
        "current user",
      );
      if (
        !isRecord(currentUser) ||
        typeof currentUser.email !== "string" ||
        currentUser.email.trim().toLowerCase() !== userEmail ||
        typeof currentUser.id !== "string"
      ) {
        failAction(
          "The connected source account must match your signed-in account before comments can be published.",
          {
            errorCode: "figma_comments_identity_mismatch",
            statusCode: 403,
          },
        );
      }
      const fileMetadataPayload = providerJson(
        await requestFigma({
          method: "GET",
          path: `/files/${encodeURIComponent(fileKey)}/meta`,
        }),
        "file metadata",
      );
      const fileMetadata =
        isRecord(fileMetadataPayload) && isRecord(fileMetadataPayload.file)
          ? fileMetadataPayload.file
          : null;
      const creator =
        fileMetadata && isRecord(fileMetadata.creator)
          ? fileMetadata.creator
          : null;
      if (
        !fileMetadata ||
        fileMetadata.folder_name !== "Drafts" ||
        fileMetadata.role !== "owner" ||
        creator?.id !== currentUser.id
      ) {
        failAction(
          "Publishing comments is limited to a personal Draft created and owned by the connected account.",
          {
            errorCode: "figma_comments_personal_draft_required",
            statusCode: 403,
          },
        );
      }
      const commentsToPublish = await queryReviewComments({
        resourceType: "design",
        resourceId: args.designId,
        scope: {
          userEmail: reviewContext?.userEmail ?? null,
          orgId: reviewContext?.orgId ?? null,
        },
        bypassScope: true,
        includeResolved: true,
        limit: 5000,
      });
      const mappings = readLocalMappings(designData, fileKey);
      const localToFigma = new Map<string, string>();
      for (const comment of commentsToPublish) {
        const importedId = commentIdFromMetadata(comment, fileKey);
        const mappedId = localCommentMapping(mappings[comment.id]);
        if (importedId || mappedId) {
          localToFigma.set(comment.id, importedId ?? mappedId!);
        }
      }
      const sortedComments = [...commentsToPublish].sort((left, right) => {
        const leftRoot = left.parentCommentId === null;
        const rightRoot = right.parentCommentId === null;
        if (leftRoot !== rightRoot) return leftRoot ? -1 : 1;
        return left.createdAt.localeCompare(right.createdAt);
      });
      let outboundCount = 0;
      for (const comment of sortedComments) {
        if (
          !isOwnHumanComment(comment, userEmail) ||
          commentIdFromMetadata(comment, fileKey) ||
          outboundCount >= 50
        ) {
          continue;
        }
        const mapping = mappings[comment.id];
        if (mapping?.figmaCommentId) continue;
        const parentFigmaCommentId = comment.parentCommentId
          ? (localToFigma.get(comment.parentCommentId) ?? null)
          : null;
        if (comment.parentCommentId && !parentFigmaCommentId) {
          result.skipped += 1;
          result.warnings.push(
            `Reply ${comment.id} was skipped because its root comment has not been synchronized.`,
          );
          continue;
        }
        const pendingSince = mapping?.pendingSince ?? comment.createdAt;
        const existing = matchingFigmaComments({
          comments: externalComments,
          body: comment.body,
          parentId: parentFigmaCommentId,
          userId: currentUser.id,
          since: pendingSince,
        });
        if (existing.length === 1) {
          const reconciled = {
            figmaCommentId: existing[0]!.id,
            messageHash: createHash("sha256")
              .update(comment.body)
              .digest("hex"),
            parentFigmaCommentId,
          };
          const updated = await writeLocalMapping({
            designId: args.designId,
            fileKey,
            reviewCommentId: comment.id,
            mapping: reconciled,
            ...(mapping?.pendingSince
              ? { expectedPendingSince: mapping.pendingSince }
              : {}),
          });
          Object.assign(designData, updated.data);
          mappings[comment.id] = reconciled;
          localToFigma.set(comment.id, existing[0]!.id);
          result.published += 1;
          continue;
        }
        if (existing.length > 1) {
          result.skipped += 1;
          result.warnings.push(
            `Comment ${comment.id} matches multiple source comments. Resolve the duplicate manually before syncing it.`,
          );
          continue;
        }
        if (mapping?.pendingSince) {
          result.skipped += 1;
          result.warnings.push(
            `Comment ${comment.id} has an uncertain publish result. Verify it in the source file before retrying; no duplicate was sent.`,
          );
          continue;
        }
        const pending: LocalFigmaMapping = {
          pendingSince: new Date().toISOString(),
          messageHash: createHash("sha256").update(comment.body).digest("hex"),
          parentFigmaCommentId,
        };
        try {
          const saved = await writeLocalMapping({
            designId: args.designId,
            fileKey,
            reviewCommentId: comment.id,
            mapping: pending,
            requireAbsent: true,
          });
          Object.assign(designData, saved.data);
        } catch {
          result.skipped += 1;
          result.warnings.push(
            `Comment ${comment.id} is already being synchronized. Run sync again to verify it.`,
          );
          continue;
        }
        const body = {
          message: comment.body,
          ...(parentFigmaCommentId ? { comment_id: parentFigmaCommentId } : {}),
        };
        let postEnvelope: unknown;
        try {
          postEnvelope = await requestFigma({
            method: "POST",
            path: commentsPath,
            body,
          });
        } catch {
          result.skipped += 1;
          result.warnings.push(
            `Comment ${comment.id} may have reached the source, but confirmation failed. Run sync again to reconcile it before retrying.`,
          );
          continue;
        }
        const response =
          isRecord(postEnvelope) && isRecord(postEnvelope.response)
            ? postEnvelope.response
            : {};
        if (response.ok !== true) {
          const status =
            typeof response.status === "number" ? response.status : 0;
          if ([400, 401, 403, 404, 429].includes(status)) {
            await writeLocalMapping({
              designId: args.designId,
              fileKey,
              reviewCommentId: comment.id,
              mapping: null,
              expectedPendingSince: pending.pendingSince,
            });
            if (status === 429) {
              result.skipped += 1;
              result.warnings.push(
                "The source is rate limiting comment sync. Try again later.",
              );
              continue;
            }
            const failure = (
              {
                400: {
                  errorCode: "figma_comments_invalid_request",
                  message:
                    "The comment or reply target was rejected. Check it and try again.",
                },
                401: {
                  errorCode: "figma_comments_auth_failed",
                  message:
                    "The connected source account rejected this comment. Reconnect and try again.",
                },
                403: {
                  errorCode: "figma_comments_write_forbidden",
                  message:
                    "The connected account does not have permission to publish comments to this Draft.",
                },
                404: {
                  errorCode: "figma_comments_target_not_found",
                  message:
                    "The linked source or reply target could not be found. Refresh the link and try again.",
                },
              } as const
            )[status as 400 | 401 | 403 | 404]!;
            failAction(failure.message, {
              errorCode: failure.errorCode,
              statusCode: status,
            });
          }
          result.skipped += 1;
          result.warnings.push(
            `Comment ${comment.id} may have reached the source, but confirmation failed. Run sync again to reconcile it before retrying.`,
          );
          continue;
        }
        const created = providerJson(postEnvelope, "comment");
        if (
          !isRecord(created) ||
          typeof created.id !== "string" ||
          typeof created.message !== "string"
        ) {
          result.skipped += 1;
          result.warnings.push(
            `Comment ${comment.id} was accepted without a usable receipt. Run sync again to reconcile it before retrying.`,
          );
          continue;
        }
        const completed: LocalFigmaMapping = {
          figmaCommentId: created.id,
          messageHash: pending.messageHash,
          parentFigmaCommentId,
        };
        const saved = await writeLocalMapping({
          designId: args.designId,
          fileKey,
          reviewCommentId: comment.id,
          mapping: completed,
          expectedPendingSince: pending.pendingSince,
        });
        Object.assign(designData, saved.data);
        mappings[comment.id] = completed;
        localToFigma.set(comment.id, created.id);
        externalComments.push(created as unknown as FigmaComment);
        result.published += 1;
        outboundCount += 1;
      }
      if (
        sortedComments.filter((comment) =>
          isOwnHumanComment(comment, userEmail),
        ).length > 50
      ) {
        result.warnings.push(
          "Only 50 comments were published in this run. Run sync again to continue.",
        );
      }
    }

    return {
      fileKey,
      direction: args.direction,
      ...result,
      resolvedStateDirection: "Source to Design" as const,
    };
  },
});
