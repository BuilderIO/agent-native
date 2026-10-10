import { defineAction, fail } from "@agent-native/core/action";
import { seedFromText } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designChangeResource } from "../server/lib/design-change-resource.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  checkpointSkippedResultField,
  snapshotDesignBeforeAgentEdit,
} from "../server/lib/design-versions.js";
import { screenRestoreContentHashes } from "../server/lib/screen-restore-claims.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import {
  mergeCanvasFramePlacements,
  nextFreeCanvasRowY,
  parseCanvasFrameGeometryById,
} from "../shared/canvas-frames.js";
import { getOverviewScreenFileIds } from "../shared/design-files.js";
import {
  assertDesignHtmlCreateIntegrity,
  describeDesignHtmlIntegrityIssue,
} from "../shared/html-integrity.js";
import { getResponsiveBreakpointWidths } from "../shared/responsive-frame-layout.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";
import { assertDesignWidgetWriteScope } from "./widget-write-scope.js";

const CREATED_SCREEN_WIDTH = 1440;
const CREATED_SCREEN_HEIGHT = 1024;
const CREATED_SCREEN_GAP = 96;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function screenRestoreSnapshotMatches(
  rawSnapshot: string,
  filename: string,
  fileType: string,
  contentHashes: readonly string[],
): boolean {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(rawSnapshot);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (
    !isRecord(snapshot) ||
    snapshot.filename !== filename ||
    snapshot.fileType !== fileType ||
    !Array.isArray(snapshot.contentHashes) ||
    !snapshot.contentHashes.some(
      (hash) => typeof hash === "string" && contentHashes.includes(hash),
    )
  ) {
    return false;
  }
  return [snapshot.screenMetadata, snapshot.localhostScreen].some(
    (metadata) =>
      isRecord(metadata) &&
      typeof metadata.connectionId === "string" &&
      metadata.connectionId.length > 0,
  );
}

export default defineAction({
  description:
    "Add a new file to a design project. Validates that the design exists and " +
    "the user has editor access. Returns the new file's ID, filename, and design URL path when the file is renderable.",
  schema: z.object({
    designId: z.string().describe("Design project ID to add the file to"),
    filename: z.string().describe("Filename (e.g. 'index.html', 'styles.css')"),
    content: z.string().describe("File content"),
    restoreClaimId: z
      .string()
      .optional()
      .describe(
        "One-use authorization for restoring a previously deleted Screen.",
      ),
    duplicateSourceFileId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        "Screen in this design to copy metadata from while duplicating.",
      ),
    fileType: z
      .enum(["html", "css", "jsx", "asset"])
      .optional()
      .default("html")
      .describe("Type of file"),
  }),
  run: async (
    {
      designId,
      filename,
      content,
      fileType,
      restoreClaimId,
      duplicateSourceFileId,
    },
    context,
  ) => {
    assertDesignWidgetWriteScope(designId, context, {
      actionName: "create-file",
    });
    if (context?.caller === "mcp-widget-write" && duplicateSourceFileId) {
      fail(
        "This Design widget write capability does not permit copying Screen metadata.",
        {
          errorCode: "mcp_widget_data_path_not_allowed",
          statusCode: 403,
        },
      );
    }
    if (restoreClaimId && duplicateSourceFileId) {
      fail("A Screen cannot be restored and duplicated in the same request.", {
        errorCode: "screen_create_proof_conflict",
        statusCode: 400,
      });
    }
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      throw new Error("Invalid filename: path traversal not allowed");
    }

    await assertAccess("design", designId, "editor");
    const checkpoint = await snapshotDesignBeforeAgentEdit(designId, context, {
      allowCheckpointFailureSkip: true,
    });
    const checkpointField = checkpointSkippedResultField(checkpoint);

    const requestedId = nanoid();
    const now = new Date().toISOString();

    const annotatedContent = annotateScreenHtmlForPersist(content, fileType);
    const restoredContentHashes = screenRestoreContentHashes(
      annotatedContent,
      fileType,
    );

    const advisory = assertDesignHtmlCreateIntegrity({
      content: annotatedContent,
      fileType: fileType ?? "html",
      filename,
    });

    const createdFile = await withDesignSourceMutationTransaction(
      designId,
      async (tx) => {
        let restoreClaim:
          | {
              id: string;
              designId: string;
              snapshot: string;
              consumedAt: string | null;
              restoredFileId: string | null;
            }
          | undefined;
        let id = requestedId;
        let existingRestoredFile:
          | { id: string; filename: string; fileType: string; content: string }
          | undefined;
        if (restoreClaimId) {
          const [candidate] = await tx
            .select({
              id: schema.designScreenRestoreClaims.id,
              designId: schema.designScreenRestoreClaims.designId,
              snapshot: schema.designScreenRestoreClaims.snapshot,
              consumedAt: schema.designScreenRestoreClaims.consumedAt,
              restoredFileId: schema.designScreenRestoreClaims.restoredFileId,
            })
            .from(schema.designScreenRestoreClaims)
            .where(
              and(
                eq(schema.designScreenRestoreClaims.id, restoreClaimId),
                eq(schema.designScreenRestoreClaims.designId, designId),
              ),
            )
            .limit(1);
          if (!candidate) {
            fail("This Screen restore is no longer available.", {
              errorCode: "screen_restore_claim_invalid",
              statusCode: 403,
            });
          }
          if (candidate.restoredFileId) {
            const [boundFile] = await tx
              .select({
                id: schema.designFiles.id,
                filename: schema.designFiles.filename,
                fileType: schema.designFiles.fileType,
                content: schema.designFiles.content,
              })
              .from(schema.designFiles)
              .where(
                and(
                  eq(schema.designFiles.designId, designId),
                  eq(schema.designFiles.id, candidate.restoredFileId),
                ),
              )
              .limit(1);
            if (boundFile) {
              if (
                boundFile.filename !== filename ||
                boundFile.fileType !== fileType
              ) {
                fail("This Screen restore is no longer available.", {
                  errorCode: "screen_restore_claim_invalid",
                  statusCode: 403,
                });
              }
              existingRestoredFile = boundFile;
              id = boundFile.id;
            } else {
              if (
                candidate.consumedAt !== null ||
                !screenRestoreSnapshotMatches(
                  candidate.snapshot,
                  filename,
                  fileType,
                  restoredContentHashes,
                )
              ) {
                fail("This Screen restore is no longer available.", {
                  errorCode: "screen_restore_claim_invalid",
                  statusCode: 403,
                });
              }
              id = candidate.restoredFileId;
            }
          } else {
            if (
              candidate.consumedAt !== null ||
              !screenRestoreSnapshotMatches(
                candidate.snapshot,
                filename,
                fileType,
                restoredContentHashes,
              )
            ) {
              fail("This Screen restore is no longer available.", {
                errorCode: "screen_restore_claim_invalid",
                statusCode: 403,
              });
            }
            restoreClaim = candidate;
          }
        }

        if (existingRestoredFile) {
          return {
            id,
            content: existingRestoredFile.content,
            fileType: existingRestoredFile.fileType,
            created: false,
          };
        }

        const [existing] = await tx
          .select({ id: schema.designFiles.id })
          .from(schema.designFiles)
          .where(
            and(
              eq(schema.designFiles.designId, designId),
              eq(schema.designFiles.filename, filename),
            ),
          )
          .limit(1);
        if (existing) {
          fail(
            `File "${filename}" already exists in design ${designId} — use edit-design to modify it`,
            {
              errorCode: "design_file_already_exists",
              statusCode: 409,
            },
          );
        }

        let duplicateDesignData: string | undefined;
        if (duplicateSourceFileId) {
          if (fileType !== "html" && fileType !== "jsx") {
            fail("Only a Screen can be duplicated.", {
              errorCode: "design_duplicate_source_invalid",
              statusCode: 400,
            });
          }
          const [sourceFile] = await tx
            .select({
              id: schema.designFiles.id,
              fileType: schema.designFiles.fileType,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                eq(schema.designFiles.id, duplicateSourceFileId),
              ),
            )
            .limit(1);
          if (
            !sourceFile ||
            (sourceFile.fileType !== "html" && sourceFile.fileType !== "jsx") ||
            sourceFile.fileType !== fileType
          ) {
            fail("The Screen to duplicate is no longer available.", {
              errorCode: "design_duplicate_source_not_found",
              statusCode: 404,
            });
          }

          const [design] = await tx
            .select({ data: schema.designs.data })
            .from(schema.designs)
            .where(eq(schema.designs.id, designId))
            .for("update");
          if (!design) {
            fail("Design not found.", {
              errorCode: "not_found",
              statusCode: 404,
            });
          }
          let parsedData: unknown;
          try {
            parsedData = JSON.parse(design.data);
          } catch {
            fail("Design data must be valid JSON.", {
              errorCode: "invalid_design_data",
              statusCode: 400,
            });
          }
          if (!isRecord(parsedData)) {
            fail("Design data must be a JSON object.", {
              errorCode: "invalid_design_data",
              statusCode: 400,
            });
          }
          const nextData = { ...parsedData };
          let copiedMetadata = false;
          for (const mapName of [
            "screenMetadata",
            "localhostScreens",
          ] as const) {
            const currentMap = isRecord(parsedData[mapName])
              ? parsedData[mapName]
              : {};
            const sourceMetadata = currentMap[duplicateSourceFileId];
            if (!isRecord(sourceMetadata)) continue;
            nextData[mapName] = {
              ...currentMap,
              [id]: { ...sourceMetadata },
            };
            copiedMetadata = true;
          }
          if (copiedMetadata) duplicateDesignData = JSON.stringify(nextData);
        }

        await tx.insert(schema.designFiles).values({
          id,
          designId,
          filename,
          fileType: fileType ?? "html",
          content: annotatedContent,
          createdAt: now,
          updatedAt: now,
        });

        if (restoreClaim) {
          const [boundClaim] = await tx
            .update(schema.designScreenRestoreClaims)
            .set({ restoredFileId: id })
            .where(
              and(
                eq(schema.designScreenRestoreClaims.id, restoreClaim.id),
                eq(schema.designScreenRestoreClaims.designId, designId),
                isNull(schema.designScreenRestoreClaims.consumedAt),
                isNull(schema.designScreenRestoreClaims.restoredFileId),
              ),
            )
            .returning({ id: schema.designScreenRestoreClaims.id });
          if (!boundClaim) {
            fail("This Screen restore was already used.", {
              errorCode: "screen_restore_claim_used",
              statusCode: 403,
            });
          }
        }

        await tx
          .update(schema.designs)
          .set({
            updatedAt: now,
            ...(duplicateDesignData === undefined
              ? {}
              : { data: duplicateDesignData }),
          })
          .where(eq(schema.designs.id, designId));
        return {
          id,
          content: annotatedContent,
          fileType: fileType ?? "html",
          created: true,
        };
      },
    );

    const { id } = createdFile;
    await seedFromText(id, createdFile.content);

    const db = getDb();

    const resolvedFileType = createdFile.fileType;
    const renderable =
      (resolvedFileType === "html" || resolvedFileType === "jsx") &&
      createdFile.content.trim().length > 0;

    if (renderable && createdFile.created) {
      const screenFiles = await db
        .select({
          id: schema.designFiles.id,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId));
      const screenFileIds = getOverviewScreenFileIds(screenFiles);

      await mutateDesignData({
        designId,
        mutate: (current) => {
          const existingFrames = parseCanvasFrameGeometryById(
            current.canvasFrames,
          );
          if (existingFrames[id]) return current;
          const merged = mergeCanvasFramePlacements({
            existing: current.canvasFrames,
            placements: [
              {
                fileId: id,
                filename,
                x: 0,
                y: nextFreeCanvasRowY(
                  current.canvasFrames,
                  CREATED_SCREEN_GAP,
                  {
                    responsiveLayout: {
                      screenFileIds,
                      screenMetadataByFileId: current.screenMetadata,
                      breakpointWidths: getResponsiveBreakpointWidths(
                        current.breakpointSet,
                      ),
                    },
                  },
                ),
                width: CREATED_SCREEN_WIDTH,
                height: CREATED_SCREEN_HEIGHT,
              },
            ],
            resolveFileId: (placement) => placement.fileId,
          });
          return { ...current, canvasFrames: merged.canvasFrames };
        },
        isApplied: (current) =>
          Boolean(parseCanvasFrameGeometryById(current.canvasFrames)[id]),
      });

      track(
        "design_output_created",
        {
          app_name: "design",
          template_name: "design",
          output_id: designId,
          output_type: "design",
          file_type: resolvedFileType,
          source: "create_file_action",
        },
        context,
      );
    }

    return {
      id,
      designId,
      filename,
      fileType: resolvedFileType,
      renderable,
      urlPath: renderable
        ? `/design/${encodeURIComponent(designId)}?editorView=overview&screen=${encodeURIComponent(id)}`
        : null,
      ...(advisory.length > 0
        ? { warnings: advisory.map(describeDesignHtmlIntegrityIssue) }
        : {}),
      ...checkpointField,
    };
  },
  changeResource: (p, result) => designChangeResource(p.designId, result),
});
