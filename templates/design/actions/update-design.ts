import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import { numericDesignDataWriteError } from "../shared/canvas-frames.js";

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
    const message = numericDesignDataWriteError(
      operation.path,
      operation.value,
    );
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
    const message = numericDesignDataWriteError(
      operation.path,
      operation.value,
    );
    if (message) {
      context.addIssue({ code: "custom", path: ["value"], message });
    }
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
  touchedMaps?: ReadonlySet<string>,
  touchedCanvasFrameIds?: ReadonlySet<string>,
): void {
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) return;
  for (const [key, value] of Object.entries(parsed)) {
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
      operationSource,
      operationRevision,
      projectType,
      designSystemId,
    },
    context,
  ) => {
    if (data !== undefined) {
      let parsedSnapshot: unknown;
      try {
        parsedSnapshot = JSON.parse(data);
      } catch {
        throw new Error("data must be a valid JSON string");
      }
      if (isRecord(parsedSnapshot)) {
        for (const [key, value] of Object.entries(parsedSnapshot)) {
          const message = numericDesignDataWriteError([key], value);
          if (message) throw new Error(message);
        }
      }
    }

    await assertAccess("design", id, "editor");
    await snapshotDesignBeforeAgentEdit(id, context);
    if (designSystemId != null) {
      await assertAccess("design-system", designSystemId, "viewer");
    }
    if (
      title === undefined &&
      description === undefined &&
      data === undefined &&
      dataOperations === undefined &&
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

    if (data === undefined && dataOperations === undefined) {
      await db
        .update(schema.designs)
        .set(staticUpdates())
        .where(eq(schema.designs.id, id));
      return { id, updated: true, changed: true };
    }

    const maxAttempts = dataOperations ? MAX_DATA_CAS_ATTEMPTS : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const [existing] = await db
        .select({
          data: schema.designs.data,
          dataOperationRevisions: schema.designs.dataOperationRevisions,
        })
        .from(schema.designs)
        .where(eq(schema.designs.id, id));
      if (!existing) {
        throw new Error(`Design not found: ${id}`);
      }

      let nextData: string;
      let nextOperationRevisions: string | undefined;
      if (dataOperations) {
        if (operationSource !== undefined && operationRevision !== undefined) {
          const revisions = parseDataOperationRevisions(
            id,
            existing.dataOperationRevisions,
          );
          if ((revisions[operationSource] ?? -1) >= operationRevision) {
            return { id, updated: true, stale: true };
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
      const updateResult = await db
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
        throw new Error(
          "The Postgres update did not report an affected-row count for the design data update.",
        );
      }

      if (affected > 0) {
        return { id, updated: true, changed: true };
      }
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
});
