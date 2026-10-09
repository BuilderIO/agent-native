import { ActionContractError } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designChangeResource } from "../server/lib/design-change-resource.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import { resolveLocalhostConnectionScope } from "../server/lib/localhost-connection.js";
import { screenRestoreContentHashes } from "../server/lib/screen-restore-claims.js";
import { numericDesignDataWriteError } from "../shared/canvas-frames.js";
import { designConnectionIdsFromData } from "../shared/source-mode.js";
import { tweakDefinitionsSchema } from "../shared/tweak-definition-schema.js";
import { assertDesignWidgetWriteScope } from "./widget-write-scope.js";

const MAX_DATA_CAS_ATTEMPTS = 5;
const MAX_DATA_OPERATION_SOURCES = 128;
const NUMERIC_DESIGN_DATA_MAPS = new Set([
  "canvasFrames",
  "screenMetadata",
  "localhostScreens",
]);
const FORBIDDEN_DATA_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const WIDGET_CANVAS_FRAME_KEYS = new Set([
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "z",
]);
const WIDGET_SCREEN_METADATA_KEYS = new Set([
  "width",
  "height",
  "heightPinned",
  "heightMode",
  "breakpointHeights",
]);
const WIDGET_LOCALHOST_SCREEN_KEYS = new Set(["width", "height"]);
const WIDGET_LAYOUT_GRID_KEYS = new Set(["kind", "size", "visible"]);

function tweakDefinitionsWriteError(value: unknown): string | null {
  return tweakDefinitionsSchema.safeParse(value).success
    ? null
    : "tweaks must be an array of valid definitions";
}

function designDataWriteError(path: string[], value: unknown): string | null {
  const geometryError = numericDesignDataWriteError(path, value);
  if (geometryError) return geometryError;
  if (path.length === 1 && path[0] === "tweaks") {
    return tweakDefinitionsWriteError(value);
  }
  return null;
}

const dataPathSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(256)
      .refine((segment) => !FORBIDDEN_DATA_PATH_SEGMENTS.has(segment), {
        message: "Unsafe design data path segment",
      }),
  )
  .min(1)
  .max(8);

const dataOperationSchema = z
  .discriminatedUnion("op", [
    z.object({
      op: z.literal("set"),
      path: dataPathSchema,
      value: z.json(),
    }),
    z.object({
      op: z.literal("delete"),
      path: dataPathSchema,
    }),
  ])
  .superRefine((operation, context) => {
    if (operation.op !== "set") return;
    const message = designDataWriteError(operation.path, operation.value);
    if (message) {
      context.addIssue({ code: "custom", path: ["value"], message });
    }
  });

const agentDataOperationSchema = z
  .discriminatedUnion("op", [
    z.object({
      op: z.literal("set"),
      path: dataPathSchema,
      value: z
        .union([
          z.number(),
          z.boolean(),
          z.string(),
          z.null(),
          z.array(z.unknown()),
          z.record(z.string(), z.unknown()),
        ])
        .describe(
          "Value to set. Geometry and dimensions (x, y, width, height, rotation, z) " +
            'are JSON numbers: 800, never "800" or "800px".',
        ),
    }),
    z.object({
      op: z.literal("delete"),
      path: dataPathSchema,
    }),
  ])
  .superRefine((operation, context) => {
    if (operation.op !== "set") return;
    const message = designDataWriteError(operation.path, operation.value);
    if (message) {
      context.addIssue({ code: "custom", path: ["value"], message });
    }
  });

const screenRestoreClaimReferenceSchema = z.object({
  claimId: z.string().min(1).max(128),
  sourceFileId: z.string().min(1).max(256),
  targetFileId: z.string().min(1).max(256),
});

type DataOperation = z.infer<typeof dataOperationSchema>;

type DataOperationRevisions = Record<string, number>;

function affectedRowCount(result: unknown): number | undefined {
  const candidate = result as
    | {
        rowsAffected?: unknown;
        affectedRows?: unknown;
        rowCount?: unknown;
        count?: unknown;
        changes?: unknown;
        meta?: { changes?: unknown };
      }
    | undefined;
  const value =
    candidate?.rowsAffected ??
    candidate?.affectedRows ??
    candidate?.rowCount ??
    candidate?.count ??
    candidate?.changes ??
    candidate?.meta?.changes;
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type ConnectionAssignment = {
  map: "screenMetadata" | "localhostScreens";
  fileId: string;
  connectionId: string;
};

function connectionAssignments(data: unknown): ConnectionAssignment[] {
  let parsed = data;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) {
        fail("Design data must be valid JSON.", {
          errorCode: "invalid_design_data",
          statusCode: 400,
        });
      }
      throw error;
    }
  }
  if (!isRecord(parsed)) return [];
  const assignments: ConnectionAssignment[] = [];
  for (const map of ["screenMetadata", "localhostScreens"] as const) {
    const entries = parsed[map];
    if (!isRecord(entries)) continue;
    for (const [fileId, metadata] of Object.entries(entries)) {
      if (
        isRecord(metadata) &&
        typeof metadata.connectionId === "string" &&
        metadata.connectionId.length > 0
      ) {
        assignments.push({ map, fileId, connectionId: metadata.connectionId });
      }
    }
  }
  return assignments;
}

function connectionAssignmentKey(
  assignment: Pick<ConnectionAssignment, "map" | "fileId">,
): string {
  return `${assignment.map}\u0000${assignment.fileId}`;
}

interface ScreenRestoreClaimSnapshot {
  filename: string;
  fileType: string;
  contentHashes: string[];
  screenMetadata?: Record<string, unknown>;
  localhostScreen?: Record<string, unknown>;
}

function parseScreenRestoreClaimSnapshot(
  raw: string,
): ScreenRestoreClaimSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.filename !== "string" ||
      typeof value.fileType !== "string" ||
      !Array.isArray(value.contentHashes) ||
      value.contentHashes.length === 0 ||
      value.contentHashes.some(
        (contentHash) =>
          typeof contentHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(contentHash),
      ) ||
      (value.screenMetadata !== undefined && !isRecord(value.screenMetadata)) ||
      (value.localhostScreen !== undefined && !isRecord(value.localhostScreen))
    ) {
      return null;
    }
    const hasConnection = [value.screenMetadata, value.localhostScreen].some(
      (metadata) =>
        isRecord(metadata) &&
        typeof metadata.connectionId === "string" &&
        metadata.connectionId.length > 0,
    );
    if (!hasConnection) return null;
    return value as unknown as ScreenRestoreClaimSnapshot;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function widgetDataOperationError(): ActionContractError {
  return new ActionContractError(
    "This Design widget write capability does not permit this design data path.",
    { errorCode: "mcp_widget_data_path_not_allowed", statusCode: 403 },
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validWidgetMetadataEntry(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "width" || key === "height") {
      if (typeof entry !== "number" || !Number.isFinite(entry)) return false;
    } else if (key === "heightPinned") {
      if (typeof entry !== "boolean") return false;
    } else if (
      key === "heightMode" &&
      entry !== "auto" &&
      entry !== "fixed" &&
      entry !== "hug"
    ) {
      return false;
    }
  }
  return true;
}

function assertWidgetDataOperations(
  operations: readonly DataOperation[],
): void {
  for (const operation of operations) {
    const [map, entryId, field, ...rest] = operation.path;
    if (rest.length > 0) throw widgetDataOperationError();

    if (map === "canvasFrames") {
      if (!entryId || (!field && operation.path.length > 2)) {
        throw widgetDataOperationError();
      }
      if (operation.path.length === 2 && operation.op === "set") {
        if (
          !isRecord(operation.value) ||
          !hasOnlyKeys(operation.value, WIDGET_CANVAS_FRAME_KEYS) ||
          designDataWriteError(operation.path, operation.value)
        ) {
          throw widgetDataOperationError();
        }
      } else if (
        operation.path.length === 3 &&
        (!field || !WIDGET_CANVAS_FRAME_KEYS.has(field))
      ) {
        throw widgetDataOperationError();
      } else if (
        operation.path.length === 3 &&
        operation.op === "set" &&
        designDataWriteError(operation.path, operation.value)
      ) {
        throw widgetDataOperationError();
      }
      continue;
    }

    if (map === "screenMetadata" || map === "localhostScreens") {
      const allowedKeys =
        map === "screenMetadata"
          ? WIDGET_SCREEN_METADATA_KEYS
          : WIDGET_LOCALHOST_SCREEN_KEYS;
      if (!entryId || operation.path.length > 3) {
        throw widgetDataOperationError();
      }
      if (operation.path.length === 2 && operation.op === "set") {
        if (
          !validWidgetMetadataEntry(operation.value, allowedKeys) ||
          designDataWriteError(operation.path, operation.value)
        ) {
          throw widgetDataOperationError();
        }
      } else if (
        operation.path.length === 3 &&
        (!field || !allowedKeys.has(field))
      ) {
        throw widgetDataOperationError();
      } else if (
        operation.path.length === 3 &&
        operation.op === "set" &&
        !validWidgetMetadataEntry({ [field!]: operation.value }, allowedKeys)
      ) {
        throw widgetDataOperationError();
      }
      continue;
    }

    if (
      map === "layoutGrids" &&
      entryId &&
      operation.path.length === 2 &&
      (operation.op === "delete" ||
        (isRecord(operation.value) &&
          hasOnlyKeys(operation.value, WIDGET_LAYOUT_GRID_KEYS) &&
          Object.keys(operation.value).length ===
            WIDGET_LAYOUT_GRID_KEYS.size &&
          operation.value.kind === "uniform" &&
          typeof operation.value.size === "number" &&
          Number.isFinite(operation.value.size) &&
          operation.value.size >= 1 &&
          operation.value.size <= 1000 &&
          typeof operation.value.visible === "boolean"))
    ) {
      continue;
    }

    throw widgetDataOperationError();
  }
}

function parsePersistedDataRecord(
  designId: string,
  raw: string | null | undefined,
): Record<string, unknown> {
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
  } catch {
    // The dedicated error below explains why the mutation is refused.
  }
  throw new Error(
    `Design ${designId} has invalid data JSON. Refusing to overwrite it.`,
  );
}

function parseDataOperationRevisions(
  designId: string,
  raw: string | null | undefined,
): DataOperationRevisions {
  if (raw == null || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("not an object");
    const revisions: DataOperationRevisions = {};
    for (const [source, revision] of Object.entries(parsed)) {
      if (
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision < 0
      ) {
        throw new Error("invalid revision");
      }
      revisions[source] = revision;
    }
    return revisions;
  } catch {
    throw new Error(
      `Design ${designId} has invalid data operation revisions. Refusing an unordered write.`,
    );
  }
}

function withDataOperationRevision(
  revisions: DataOperationRevisions,
  source: string,
  revision: number,
): DataOperationRevisions {
  const next = { ...revisions };
  delete next[source];
  next[source] = revision;
  while (Object.keys(next).length > MAX_DATA_OPERATION_SOURCES) {
    const oldest = Object.keys(next)[0];
    if (oldest === undefined) break;
    delete next[oldest];
  }
  return next;
}

function applyDataOperations(
  designId: string,
  raw: string | null | undefined,
  operations: DataOperation[],
): string {
  const root: Record<string, unknown> = {
    ...parsePersistedDataRecord(designId, raw),
  };

  for (const operation of operations) {
    let target: Record<string, unknown> = root;
    let missingDeleteParent = false;
    const parentPath = operation.path.slice(0, -1);
    for (const segment of parentPath) {
      const value = target[segment];
      if (value === undefined) {
        if (operation.op === "delete") {
          missingDeleteParent = true;
          break;
        }
        const next: Record<string, unknown> = {};
        target[segment] = next;
        target = next;
        continue;
      }
      if (!isRecord(value)) {
        throw new Error(
          `Cannot apply design data operation through non-object path "${operation.path.join(".")}".`,
        );
      }
      const cloned = { ...value };
      target[segment] = cloned;
      target = cloned;
    }
    if (missingDeleteParent) continue;

    const leaf = operation.path[operation.path.length - 1]!;
    if (operation.op === "delete") {
      delete target[leaf];
    } else {
      target[leaf] = operation.value;
    }
  }

  return JSON.stringify(root);
}

function validatePersistedDataSnapshot(
  raw: string,
  designId: string,
  touchedMaps?: ReadonlySet<string>,
  touchedCanvasFrameIds?: ReadonlySet<string>,
): void {
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) return;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "tweaks") {
      if (touchedMaps && !touchedMaps.has(key)) continue;
      if (tweakDefinitionsWriteError(value)) {
        throw new Error(
          `Design ${designId} has invalid tweak definitions. Refusing to save them.`,
        );
      }
      continue;
    }
    if (
      touchedMaps &&
      NUMERIC_DESIGN_DATA_MAPS.has(key) &&
      !touchedMaps.has(key)
    ) {
      continue;
    }
    if (key === "canvasFrames" && touchedCanvasFrameIds) {
      if (!isRecord(value)) {
        const message = numericDesignDataWriteError([key], value);
        if (message) throw new Error(message);
        continue;
      }
      for (const [frameId, frame] of Object.entries(value)) {
        if (!touchedCanvasFrameIds.has(frameId)) continue;
        const message = numericDesignDataWriteError([key, frameId], frame);
        if (message) throw new Error(message);
      }
      continue;
    }
    const message = numericDesignDataWriteError([key], value);
    if (message) throw new Error(message);
  }
}

export default defineAction({
  description:
    "Update an existing design project. Requires editor access. " +
    "Only provided fields are updated; omitted fields are left unchanged. " +
    "For map entries such as canvasFrames, use dataOperations " +
    "with explicit set/delete paths instead of a full data snapshot. " +
    "Dimensions and positions (x, y, width, height, rotation, z) are " +
    "numbers. String values are rejected. Renderable screens created by " +
    "create-file or generate-design are auto-placed, so omit canvasFrames " +
    "unless intentionally placing or moving a frame. Full placement objects " +
    "must provide complete numeric geometry; path-addressed updates may change " +
    "individual numeric fields.",
  schema: z
    .object({
      id: z.string().describe("Design ID"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      data: z
        .string()
        .optional()
        .describe(
          "Legacy partial JSON object snapshot. Concurrent conflicting snapshots are rejected; use dataOperations for map entries.",
        ),
      dataOperations: z
        .array(dataOperationSchema)
        .min(1)
        .max(500)
        .optional()
        .describe(
          "Atomic path-addressed set/delete operations for design data. Safe to CAS-retry across concurrent writers. Geometry values must be numbers, not strings.",
        ),
      restoreClaims: z
        .array(screenRestoreClaimReferenceSchema)
        .min(1)
        .max(101)
        .optional()
        .describe(
          "Server-issued one-use proof for restoring connection metadata after deleting a Screen.",
        ),
      operationSource: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .optional()
        .describe(
          "Stable client-session id used with operationRevision to reject late out-of-order writes.",
        ),
      operationRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          "Monotonic sequence for operationSource. Stale or duplicate revisions are successful no-ops.",
        ),
      projectType: z
        .enum(["prototype", "other"])
        .optional()
        .describe("Updated project type"),
      designSystemId: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("Design system ID to link, or null to unlink"),
    })
    .refine(
      ({ data, dataOperations }) =>
        data === undefined || dataOperations === undefined,
      {
        message: "Provide either data or dataOperations, not both.",
        path: ["dataOperations"],
      },
    )
    .superRefine((value, context) => {
      const hasSource = value.operationSource !== undefined;
      const hasRevision = value.operationRevision !== undefined;
      if (hasSource !== hasRevision) {
        context.addIssue({
          code: "custom",
          path: hasSource ? ["operationRevision"] : ["operationSource"],
          message:
            "operationSource and operationRevision must be provided together.",
        });
      }
      if ((hasSource || hasRevision) && !value.dataOperations) {
        context.addIssue({
          code: "custom",
          path: ["dataOperations"],
          message:
            "operationSource and operationRevision require dataOperations.",
        });
      }
      if (value.restoreClaims) {
        if (!value.dataOperations || !hasSource || !hasRevision) {
          context.addIssue({
            code: "custom",
            path: ["restoreClaims"],
            message:
              "Restore claims require path operations with an operation source and revision.",
          });
        }
        if (value.data !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["restoreClaims"],
            message: "Restore claims cannot be used with a snapshot update.",
          });
        }
        const claimIds = new Set<string>();
        const targetIds = new Set<string>();
        for (const claim of value.restoreClaims) {
          if (
            claimIds.has(claim.claimId) ||
            targetIds.has(claim.targetFileId)
          ) {
            context.addIssue({
              code: "custom",
              path: ["restoreClaims"],
              message: "Restore claims and target files must be unique.",
            });
            break;
          }
          claimIds.add(claim.claimId);
          targetIds.add(claim.targetFileId);
        }
      }
    }),
  agentInputSchema: z.object({
    id: z.string().describe("Design ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    dataOperations: z
      .array(agentDataOperationSchema)
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Atomic path-addressed set/delete operations for design data. Geometry values must be numbers, not strings.",
      ),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .describe("Updated project type"),
    designSystemId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Design system ID to link, or null to unlink"),
  }),
  run: async (
    {
      id,
      title,
      description,
      data,
      dataOperations,
      restoreClaims,
      operationSource,
      operationRevision,
      projectType,
      designSystemId,
    },
    context,
  ) => {
    if (context?.caller === "mcp-widget-write") {
      assertDesignWidgetWriteScope(id, context, {
        actionName: "update-design",
      });
      if (
        data !== undefined ||
        description !== undefined ||
        projectType !== undefined ||
        designSystemId !== undefined
      ) {
        throw widgetDataOperationError();
      }
      if (dataOperations) assertWidgetDataOperations(dataOperations);
    }

    if (data !== undefined) {
      let parsedSnapshot: unknown;
      try {
        parsedSnapshot = JSON.parse(data);
      } catch {
        throw new Error("data must be a valid JSON string");
      }
      if (isRecord(parsedSnapshot)) {
        for (const [key, value] of Object.entries(parsedSnapshot)) {
          if (key === "tweaks") {
            const tweakError = tweakDefinitionsWriteError(value);
            if (tweakError) throw new Error(tweakError);
          }
          const message = numericDesignDataWriteError([key], value);
          if (message) throw new Error(message);
        }
      }
    }

    const access = await assertAccess("design", id, "editor");
    await snapshotDesignBeforeAgentEdit(id, context);
    if (designSystemId != null) {
      await assertAccess("design-system", designSystemId, "viewer");
    }
    if (
      title === undefined &&
      description === undefined &&
      data === undefined &&
      dataOperations === undefined &&
      restoreClaims === undefined &&
      projectType === undefined &&
      designSystemId === undefined
    ) {
      throw new Error(
        "At least one design field or data operation is required.",
      );
    }

    const db = getDb();

    const staticUpdates = (): Record<string, unknown> => {
      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (projectType !== undefined) updates.projectType = projectType;
      if (designSystemId !== undefined) updates.designSystemId = designSystemId;
      return updates;
    };

    if (
      data === undefined &&
      dataOperations === undefined &&
      restoreClaims === undefined
    ) {
      await db
        .update(schema.designs)
        .set(staticUpdates())
        .where(eq(schema.designs.id, id));
      return { id, updated: true, changed: true };
    }

    const maxAttempts = dataOperations ? MAX_DATA_CAS_ATTEMPTS : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            data: schema.designs.data,
            dataOperationRevisions: schema.designs.dataOperationRevisions,
          })
          .from(schema.designs)
          .where(eq(schema.designs.id, id));
        if (!existing) {
          fail("Design was not found.", {
            errorCode: "design_not_found",
            statusCode: 404,
          });
        }

        let nextData: string;
        let nextOperationRevisions: string | undefined;
        if (dataOperations) {
          if (
            operationSource !== undefined &&
            operationRevision !== undefined
          ) {
            const revisions = parseDataOperationRevisions(
              id,
              existing.dataOperationRevisions,
            );
            if ((revisions[operationSource] ?? -1) >= operationRevision) {
              return {
                kind: "done" as const,
                value: { id, updated: true, stale: true },
              };
            }
            nextOperationRevisions = JSON.stringify(
              withDataOperationRevision(
                revisions,
                operationSource,
                operationRevision,
              ),
            );
          }
          nextData = applyDataOperations(id, existing.data, dataOperations);
        } else {
          const incomingParsed = JSON.parse(data!);
          nextData = isRecord(incomingParsed)
            ? JSON.stringify({
                ...parsePersistedDataRecord(id, existing.data),
                ...incomingParsed,
              })
            : data!;
        }

        const existingAssignments = new Map(
          connectionAssignments(existing.data).map((assignment) => [
            connectionAssignmentKey(assignment),
            assignment.connectionId,
          ]),
        );
        const nextAssignments = connectionAssignments(nextData);
        const addedAssignments = nextAssignments.filter(
          (assignment) =>
            existingAssignments.get(connectionAssignmentKey(assignment)) !==
            assignment.connectionId,
        );
        const allowedRestoreAssignments = new Map<string, string>();
        const restoreClaimsToConsume: Array<{
          id: string;
          targetFileId: string;
        }> = [];
        if (restoreClaims?.length) {
          const claimIds = restoreClaims.map((claim) => claim.claimId);
          const targetFileIds = restoreClaims.map(
            (claim) => claim.targetFileId,
          );
          const claimRows = await tx
            .select({
              id: schema.designScreenRestoreClaims.id,
              designId: schema.designScreenRestoreClaims.designId,
              sourceFileId: schema.designScreenRestoreClaims.sourceFileId,
              snapshot: schema.designScreenRestoreClaims.snapshot,
              consumedAt: schema.designScreenRestoreClaims.consumedAt,
              restoredFileId: schema.designScreenRestoreClaims.restoredFileId,
            })
            .from(schema.designScreenRestoreClaims)
            .where(
              and(
                eq(schema.designScreenRestoreClaims.designId, id),
                inArray(schema.designScreenRestoreClaims.id, claimIds),
              ),
            );
          const files = await tx
            .select({
              id: schema.designFiles.id,
              designId: schema.designFiles.designId,
              filename: schema.designFiles.filename,
              fileType: schema.designFiles.fileType,
              content: schema.designFiles.content,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, id),
                inArray(schema.designFiles.id, targetFileIds),
              ),
            )
            .for("update");
          const claimById = new Map(
            claimRows.map((claim) => [claim.id, claim]),
          );
          const fileById = new Map(files.map((file) => [file.id, file]));

          for (const reference of restoreClaims) {
            const targetAddedAssignments = addedAssignments.filter(
              (assignment) => assignment.fileId === reference.targetFileId,
            );
            if (targetAddedAssignments.length === 0) continue;

            const claim = claimById.get(reference.claimId);
            const file = fileById.get(reference.targetFileId);
            const snapshot = claim
              ? parseScreenRestoreClaimSnapshot(claim.snapshot)
              : null;
            const fileMatchesClaim = Boolean(
              file &&
              snapshot &&
              file.filename === snapshot.filename &&
              file.fileType === snapshot.fileType &&
              screenRestoreContentHashes(file.content, file.fileType).some(
                (contentHash) => snapshot.contentHashes.includes(contentHash),
              ),
            );
            if (
              !claim ||
              claim.designId !== id ||
              claim.sourceFileId !== reference.sourceFileId ||
              claim.consumedAt !== null ||
              claim.restoredFileId !== reference.targetFileId ||
              !file ||
              file.designId !== id ||
              !snapshot ||
              !fileMatchesClaim
            ) {
              continue;
            }

            const snapshotConnectionIds = new Map<
              ConnectionAssignment["map"],
              string
            >();
            for (const [mapName, metadata] of [
              ["screenMetadata", snapshot.screenMetadata],
              ["localhostScreens", snapshot.localhostScreen],
            ] as const) {
              if (
                isRecord(metadata) &&
                typeof metadata.connectionId === "string" &&
                metadata.connectionId.length > 0
              ) {
                snapshotConnectionIds.set(mapName, metadata.connectionId);
              }
            }
            let authorizedAssignment = false;
            for (const assignment of targetAddedAssignments) {
              if (
                snapshotConnectionIds.get(assignment.map) ===
                assignment.connectionId
              ) {
                allowedRestoreAssignments.set(
                  connectionAssignmentKey(assignment),
                  assignment.connectionId,
                );
                authorizedAssignment = true;
              }
            }
            if (!authorizedAssignment) continue;
            restoreClaimsToConsume.push({
              id: claim.id,
              targetFileId: reference.targetFileId,
            });
          }
        }

        const requiredScopeIds = new Set<string>();
        for (const assignment of addedAssignments) {
          if (
            allowedRestoreAssignments.get(
              connectionAssignmentKey(assignment),
            ) !== assignment.connectionId
          ) {
            requiredScopeIds.add(assignment.connectionId);
          }
        }
        const existingConnectionIds = new Set(
          designConnectionIdsFromData(existing.data),
        );
        const nextConnectionIds = designConnectionIdsFromData(nextData);
        const addedConnectionIds = nextConnectionIds.filter(
          (connectionId) => !existingConnectionIds.has(connectionId),
        );
        const nextRoot = parsePersistedDataRecord(id, nextData).connectionId;
        const existingRoot = parsePersistedDataRecord(
          id,
          existing.data,
        ).connectionId;
        if (
          typeof nextRoot === "string" &&
          nextRoot.length > 0 &&
          nextRoot !== existingRoot
        ) {
          requiredScopeIds.add(nextRoot);
        }
        for (const connectionId of addedConnectionIds) {
          const occurrences = nextAssignments.filter(
            (assignment) => assignment.connectionId === connectionId,
          );
          if (
            occurrences.length === 0 ||
            occurrences.some(
              (assignment) =>
                allowedRestoreAssignments.get(
                  connectionAssignmentKey(assignment),
                ) !== connectionId,
            )
          ) {
            requiredScopeIds.add(connectionId);
          }
        }
        const restoreTargetFileIdsForConnections = (
          connectionIds: ReadonlySet<string>,
        ) => [
          ...new Set(
            addedAssignments
              .filter(
                (assignment) =>
                  connectionIds.has(assignment.connectionId) &&
                  allowedRestoreAssignments.get(
                    connectionAssignmentKey(assignment),
                  ) !== assignment.connectionId &&
                  restoreClaims?.some(
                    (claim) => claim.targetFileId === assignment.fileId,
                  ),
              )
              .map((assignment) => assignment.fileId),
          ),
        ];
        const requiredConnectionIds = [...requiredScopeIds];
        if (requiredConnectionIds.length > 0 && access?.role !== "owner") {
          const connectionScope = await resolveLocalhostConnectionScope().catch(
            (error: unknown) => {
              if (
                error instanceof Error &&
                error.message === "no authenticated user"
              ) {
                fail(
                  "Only local app connections in your workspace can be added to this design.",
                  {
                    errorCode: "localhost_connection_scope_required",
                    statusCode: 403,
                    details: {
                      restoreTargetFileIds:
                        restoreTargetFileIdsForConnections(requiredScopeIds),
                    },
                  },
                );
              }
              throw error;
            },
          );
          const ownedConnections = await tx
            .select({ id: schema.designLocalhostConnections.id })
            .from(schema.designLocalhostConnections)
            .where(
              and(
                inArray(
                  schema.designLocalhostConnections.id,
                  requiredConnectionIds,
                ),
                eq(
                  schema.designLocalhostConnections.ownerEmail,
                  connectionScope.ownerEmail,
                ),
                connectionScope.orgId
                  ? eq(
                      schema.designLocalhostConnections.orgId,
                      connectionScope.orgId,
                    )
                  : isNull(schema.designLocalhostConnections.orgId),
              ),
            );
          const ownedConnectionIds = new Set(
            ownedConnections.map((connection) => connection.id),
          );
          const unownedConnectionIds = new Set(
            requiredConnectionIds.filter(
              (connectionId) => !ownedConnectionIds.has(connectionId),
            ),
          );
          if (unownedConnectionIds.size > 0) {
            fail(
              "Only local app connections in your workspace can be added to this design.",
              {
                errorCode: "localhost_connection_scope_mismatch",
                statusCode: 403,
                details: {
                  restoreTargetFileIds:
                    restoreTargetFileIdsForConnections(unownedConnectionIds),
                },
              },
            );
          }
        }

        const touchedMaps = dataOperations
          ? new Set(dataOperations.map((operation) => operation.path[0]))
          : (() => {
              const parsed = JSON.parse(data!);
              return new Set(isRecord(parsed) ? Object.keys(parsed) : []);
            })();
        const touchedCanvasFrameIds = dataOperations
          ? (() => {
              const ids = dataOperations
                .filter(
                  (operation) =>
                    operation.path[0] === "canvasFrames" &&
                    operation.path.length > 1,
                )
                .map((operation) => operation.path[1]!);
              return ids.length > 0 ? new Set(ids) : undefined;
            })()
          : undefined;
        validatePersistedDataSnapshot(
          nextData,
          id,
          touchedMaps,
          touchedCanvasFrameIds,
        );

        const revisionCondition =
          operationSource !== undefined
            ? existing.dataOperationRevisions == null
              ? isNull(schema.designs.dataOperationRevisions)
              : eq(
                  schema.designs.dataOperationRevisions,
                  existing.dataOperationRevisions,
                )
            : undefined;
        const updateResult = await tx
          .update(schema.designs)
          .set({
            ...staticUpdates(),
            data: nextData,
            ...(nextOperationRevisions === undefined
              ? {}
              : { dataOperationRevisions: nextOperationRevisions }),
          })
          .where(
            and(
              eq(schema.designs.id, id),
              existing.data == null
                ? isNull(schema.designs.data)
                : eq(schema.designs.data, existing.data),
              ...(revisionCondition ? [revisionCondition] : []),
            ),
          );
        const affected = affectedRowCount(updateResult);
        if (affected === undefined) {
          // guard:allow-bare-error — invariant: the data update result must expose its affected-row count.
          throw new Error(
            "The Postgres update did not report an affected-row count for the design data update.",
          );
        }

        if (affected > 0) {
          const consumedAt = new Date().toISOString();
          for (const claim of restoreClaimsToConsume) {
            const consumeResult = await tx
              .update(schema.designScreenRestoreClaims)
              .set({ consumedAt })
              .where(
                and(
                  eq(schema.designScreenRestoreClaims.id, claim.id),
                  eq(schema.designScreenRestoreClaims.designId, id),
                  isNull(schema.designScreenRestoreClaims.consumedAt),
                  eq(
                    schema.designScreenRestoreClaims.restoredFileId,
                    claim.targetFileId,
                  ),
                ),
              );
            if (affectedRowCount(consumeResult) !== 1) {
              fail(
                "This Screen restore was already used. Recreate the Screen and try again.",
                {
                  errorCode: "screen_restore_claim_used",
                  statusCode: 403,
                },
              );
            }
          }
          return {
            kind: "done" as const,
            value: { id, updated: true, changed: true },
          };
        }
        return { kind: "retry" as const };
      });

      if (result.kind === "done") return result.value;
    }

    if (dataOperations) {
      throw new Error(
        `Could not update design ${id} after ${MAX_DATA_CAS_ATTEMPTS} concurrent attempts. Re-read the design and retry.`,
      );
    }
    throw new Error(
      "Design data changed while this snapshot was being saved. Re-read the design and retry, or use dataOperations for path-addressed map edits.",
    );
  },
  changeResource: (p, result) => designChangeResource(p.id, result),
});
