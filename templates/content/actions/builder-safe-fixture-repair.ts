import { isDeepStrictEqual } from "node:util";

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api.js";
import type { BuilderCmsModelFieldSummary } from "../shared/api.js";
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
} from "./_builder-cms-read-client.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import {
  executeBuilderCmsWrite,
  type BuilderCmsWriteResult,
} from "./_builder-cms-write-client.js";

const SOURCE_MODEL = "blog-article";
const MAX_INVENTORY = 10_000;
const REQUIRED_FIELDS = [
  { name: "agentNativeSourceId", type: "text" },
  { name: "agentNativeSourceModel", type: "text" },
  { name: "agentNativeTestNote", type: "longText" },
] as const;
const PROVENANCE_FIELDS = [
  "agentNativeSourceId",
  "agentNativeSourceModel",
  "agentNativeTestNote",
] as const;
const TEST_NOTE = "Agent Native safe fixture backfill";
const MAX_VERIFICATION_ATTEMPTS = 12;

function rawData(entry: BuilderCmsSourceEntry) {
  const data = entry.rawEntry?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Builder entry ${entry.id} has no cloneable data object.`);
  }
  return data as Record<string, unknown>;
}

function jsonClone(value: Record<string, unknown>) {
  // JSON cloning preserves Builder-rich structures (references, image/video
  // URLs, nested topic values) without mutating the raw read response.
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function withoutProvenance(data: Record<string, unknown>) {
  const cloned = jsonClone(data);
  for (const field of PROVENANCE_FIELDS) delete cloned[field];
  return cloned;
}

function isZeroDimension(value: unknown) {
  return value === 0 || value === "0";
}

function isCanonicalBuilderTrackingPixel(value: Record<string, unknown>) {
  if (value["@type"] !== "@builder.io/sdk:Element" || value.tagName !== "img")
    return false;
  const properties = value.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  )
    return false;
  const props = properties as Record<string, unknown>;
  if (
    props.role !== "presentation" ||
    props.alt !== "" ||
    (props["aria-hidden"] !== true && props["aria-hidden"] !== "true") ||
    !isZeroDimension(props.width) ||
    !isZeroDimension(props.height) ||
    typeof props.src !== "string"
  ) {
    return false;
  }
  try {
    const src = new URL(props.src);
    return (
      (src.hostname === "builder.io" || src.hostname.endsWith(".builder.io")) &&
      src.pathname === "/api/v1/pixel"
    );
  } catch {
    return false;
  }
}

function canonicalBuilderCloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBuilderCloneValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const isReference = record["@type"] === "@builder.io/core:Reference";
  const isTrackingPixel = isCanonicalBuilderTrackingPixel(record);
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, nested]) => {
      if (isReference && key === "value") return [];
      if (isTrackingPixel && key === "id") return [];
      return [[key, canonicalBuilderCloneValue(nested)]];
    }),
  );
}

export function canonicalBuilderCloneData(data: Record<string, unknown>) {
  return canonicalBuilderCloneValue(data) as Record<string, unknown>;
}

function clonedData(entry: BuilderCmsSourceEntry) {
  return {
    ...withoutProvenance(rawData(entry)),
    agentNativeSourceId: entry.id,
    agentNativeSourceModel: SOURCE_MODEL,
    agentNativeTestNote: TEST_NOTE,
  };
}

function rawEntryName(entry: BuilderCmsSourceEntry) {
  const name = entry.rawEntry?.name;
  return typeof name === "string" && name.trim() ? name : entry.title;
}

function targetPublishedState(entry: BuilderCmsSourceEntry) {
  const published = entry.rawEntry?.published;
  return typeof published === "string" ? published : null;
}

export function fixtureRepairPlan(args: {
  targetModel: string;
  sourceFields: BuilderCmsModelFieldSummary[];
  targetFields: BuilderCmsModelFieldSummary[];
  sourceEntries: BuilderCmsSourceEntry[];
  targetEntries: BuilderCmsSourceEntry[];
  batchSize: number;
  cursor?: string;
}) {
  if (args.targetModel !== BUILDER_CMS_SAFE_WRITE_MODEL) {
    throw new Error(
      `Builder fixture repair only targets ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
    );
  }
  const targetByName = new Map(
    args.targetFields.map((field) => [field.name.toLowerCase(), field]),
  );
  const wanted = [...args.sourceFields, ...REQUIRED_FIELDS];
  const additions = wanted.filter(
    (field) => !targetByName.has(field.name.toLowerCase()),
  );
  const conflicts = wanted.flatMap((field) => {
    const target = targetByName.get(field.name.toLowerCase());
    return target && target.type !== field.type
      ? [{ source: field, target }]
      : [];
  });
  if (conflicts.length) {
    throw new Error(
      `Fixture schema is incompatible: ${conflicts.map(({ source, target }) => `${source.name} is ${target.type}, expected ${source.type}`).join("; ")}.`,
    );
  }
  const ordered = [...args.sourceEntries].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const targetBySourceId = new Map<string, BuilderCmsSourceEntry>();
  for (const target of args.targetEntries) {
    const sourceId = rawData(target).agentNativeSourceId;
    if (typeof sourceId !== "string" || !sourceId) continue;
    if (targetBySourceId.has(sourceId)) {
      throw new Error(
        `Fixture target has duplicate provenance for source ${sourceId}; repair is ambiguous.`,
      );
    }
    targetBySourceId.set(sourceId, target);
  }
  const sourceIds = new Set(ordered.map((entry) => entry.id));
  const snapshotOnlyTargetSourceIds = Array.from(targetBySourceId.keys())
    .filter((sourceId) => !sourceIds.has(sourceId))
    .sort();
  const start = args.cursor
    ? ordered.findIndex((entry) => entry.id === args.cursor) + 1
    : 0;
  if (args.cursor && start === 0)
    throw new Error(
      "Resume cursor is not present in the exhaustive source inventory.",
    );
  const unscanned = ordered.slice(start);
  const planned = unscanned.map((entry) => {
    const expectedData = clonedData(entry);
    const target = targetBySourceId.get(entry.id);
    if (!target) {
      return {
        source: entry,
        target: null,
        expectedData,
        operation: "create" as const,
      };
    }
    const targetData = rawData(target);
    const sourceMatches = isDeepStrictEqual(
      canonicalBuilderCloneData(withoutProvenance(targetData)),
      canonicalBuilderCloneData(withoutProvenance(rawData(entry))),
    );
    const provenanceMatches = PROVENANCE_FIELDS.every((field) =>
      isDeepStrictEqual(targetData[field], expectedData[field]),
    );
    const draftMatches = targetPublishedState(target) === "draft";
    return {
      source: entry,
      target,
      expectedData,
      operation:
        sourceMatches && provenanceMatches && draftMatches
          ? ("unchanged" as const)
          : ("repair" as const),
    };
  });
  const existing = planned.filter((item) => item.target !== null);
  const unchanged = planned.filter((item) => item.operation === "unchanged");
  const repairable = planned.filter((item) => item.operation !== "unchanged");
  const selected = repairable.slice(0, args.batchSize);
  const candidates = selected.map((item) => {
    if (item.operation === "unchanged") {
      throw new Error("Internal fixture plan selected an unchanged entry.");
    }
    return {
      sourceId: item.source.id,
      targetEntryId: item.target?.id ?? null,
      operation: item.operation,
      idempotencyKey: `builder-safe-fixture:${item.source.id}`,
      expectedData: item.expectedData,
      request: {
        method: item.target ? ("PATCH" as const) : ("POST" as const),
        path: item.target
          ? `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/${encodeURIComponent(item.target.id)}`
          : `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
        query: { triggerWebhooks: "false" },
        body: {
          name: rawEntryName(item.source),
          published: "draft",
          // Only envelope/system state is omitted. data is a raw, unenriched
          // clone with the three fixture provenance fields normalized.
          data: item.expectedData,
        },
      },
    };
  });
  return {
    additions,
    conflicts,
    candidates,
    inventory: {
      sourceTotal: ordered.length,
      targetTotal: args.targetEntries.length,
      snapshotOnlyTargetSourceIds,
      snapshotOnlyTargetPolicy:
        "Retained as a historical safe-fixture snapshot; source archival never triggers deletion.",
      scanned: unscanned.length,
      existing: existing.length,
      unchanged: unchanged.length,
      repairs: repairable.filter((item) => item.operation === "repair").length,
      missing: repairable.filter((item) => item.operation === "create").length,
      candidates: candidates.length,
      remaining: repairable.length - candidates.length,
      nextCursor:
        selected.length > 0 ? selected[selected.length - 1].source.id : null,
    },
  };
}

function timed<T>(name: string, fn: () => Promise<T>) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  return fn().then((value) => ({
    value,
    timing: { name, startedAt, durationMs: Date.now() - started },
  }));
}

export async function executeFixtureCandidatesWithDeps(args: {
  candidates: ReturnType<typeof fixtureRepairPlan>["candidates"];
  readTargetInventory: () => ReturnType<typeof readBuilderCmsContentEntries>;
  executeWrite: (
    request: ReturnType<
      typeof fixtureRepairPlan
    >["candidates"][number]["request"],
  ) => Promise<BuilderCmsWriteResult>;
  wait?: (ms: number) => Promise<void>;
}) {
  const writes: Array<{
    sourceId: string;
    operation: "create" | "repair";
    entryId?: string;
    timing: { name: string; startedAt: string; durationMs: number };
  }> = [];
  for (const candidate of args.candidates) {
    const write = await timed(`write_draft:${candidate.sourceId}`, () =>
      args.executeWrite(candidate.request),
    );
    if (!write.value.ok) {
      throw new Error(
        `Builder draft write failed for ${candidate.sourceId}: ${write.value.error ?? `HTTP ${write.value.status}`}.`,
      );
    }
    writes.push({
      sourceId: candidate.sourceId,
      operation: candidate.operation,
      entryId: write.value.entryId,
      timing: write.timing,
    });
  }
  const wait =
    args.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastFailures: string[] = [];
  for (let attempt = 1; attempt <= MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
    const verification = await timed(
      `verify_target_provenance:${attempt}`,
      args.readTargetInventory,
    );
    if (
      verification.value.state !== "live" ||
      verification.value.progress.partial ||
      verification.value.progress.hasMore
    ) {
      throw new Error(
        "Post-write provenance verification was incomplete; writes may have succeeded but no further writes were attempted.",
      );
    }
    const targetsBySourceId = new Map<string, BuilderCmsSourceEntry[]>();
    for (const entry of verification.value.entries) {
      const data = rawData(entry);
      if (typeof data.agentNativeSourceId !== "string") continue;
      const targets = targetsBySourceId.get(data.agentNativeSourceId) ?? [];
      targets.push(entry);
      targetsBySourceId.set(data.agentNativeSourceId, targets);
    }
    lastFailures = args.candidates.flatMap((candidate) => {
      const targets = targetsBySourceId.get(candidate.sourceId) ?? [];
      if (targets.length !== 1) {
        return [`${candidate.sourceId}: found ${targets.length}`];
      }
      const [target] = targets;
      if (
        !isDeepStrictEqual(
          canonicalBuilderCloneData(rawData(target)),
          canonicalBuilderCloneData(candidate.expectedData),
        )
      ) {
        return [`${candidate.sourceId}: cloned data differs`];
      }
      if (targetPublishedState(target) !== "draft") {
        return [`${candidate.sourceId}: target is not draft`];
      }
      return [];
    });
    if (lastFailures.length === 0) {
      return {
        writes,
        verification: {
          attempts: attempt,
          timing: verification.timing,
          verifiedSourceIds: args.candidates.map(
            (candidate) => candidate.sourceId,
          ),
        },
      };
    }
    if (attempt < MAX_VERIFICATION_ATTEMPTS) await wait(attempt * 1_000);
  }
  throw new Error(
    `Post-write provenance verification failed after ${MAX_VERIFICATION_ATTEMPTS} read attempts: ${lastFailures.join(", ")}.`,
  );
}

export default defineAction({
  description:
    "Exhaustively plan a resumable, raw-data blog-article clone repair into the safe Builder fixture model. It creates missing drafts or patches non-identical drafts only after schema checks, then verifies exact cloned data and provenance.",
  schema: z.object({
    sourceModel: z.literal(SOURCE_MODEL).default(SOURCE_MODEL),
    targetModel: z
      .literal(BUILDER_CMS_SAFE_WRITE_MODEL)
      .default(BUILDER_CMS_SAFE_WRITE_MODEL),
    cursor: z
      .string()
      .optional()
      .describe("Last returned source entry ID; resume strictly after it."),
    apply: z.literal(true).optional(),
    batchSize: z.number().int().min(1).max(50).default(1),
  }),
  run: async ({ sourceModel, targetModel, cursor, apply, batchSize }) => {
    if (
      sourceModel !== SOURCE_MODEL ||
      targetModel !== BUILDER_CMS_SAFE_WRITE_MODEL
    )
      throw new Error(
        "Builder fixture repair accepts only blog-article -> agent-native-blog-article-test.",
      );
    const [sourceSchema, targetSchema, sourceRead, targetRead] =
      await Promise.all([
        timed("read_source_model_schema", () =>
          readBuilderCmsModelFields({ model: sourceModel }),
        ),
        timed("read_target_model_schema", () =>
          readBuilderCmsModelFields({ model: targetModel }),
        ),
        timed("read_source_inventory", () =>
          readBuilderCmsContentEntries({
            model: sourceModel,
            rawData: true,
            requirePrivateKey: true,
            limit: MAX_INVENTORY,
            maxPages: 100,
          }),
        ),
        timed("read_target_inventory", () =>
          readBuilderCmsContentEntries({
            model: targetModel,
            rawData: true,
            requirePrivateKey: true,
            limit: MAX_INVENTORY,
            maxPages: 100,
          }),
        ),
      ]);
    if (
      sourceRead.value.state !== "live" ||
      targetRead.value.state !== "live" ||
      sourceRead.value.progress.readMode !== "builder-api" ||
      targetRead.value.progress.readMode !== "builder-api" ||
      sourceRead.value.progress.partial ||
      targetRead.value.progress.partial ||
      sourceRead.value.progress.hasMore ||
      targetRead.value.progress.hasMore
    ) {
      throw new Error(
        "Builder fixture repair requires exhaustive unpublished-inclusive Content API inventories (readMode builder-api); MCP browse results are never treated as complete. No writes were attempted.",
      );
    }
    const plan = fixtureRepairPlan({
      targetModel,
      sourceFields: sourceSchema.value,
      targetFields: targetSchema.value,
      sourceEntries: sourceRead.value.entries,
      targetEntries: targetRead.value.entries,
      batchSize,
      cursor,
    });
    if (
      apply === true &&
      (plan.additions.length > 0 || plan.conflicts.length > 0)
    ) {
      throw new Error(
        "Apply is blocked: reconcile the reported additive schema requirements and incompatible conflicts before backfill. No writes were attempted.",
      );
    }
    const execution =
      apply === true
        ? await executeFixtureCandidatesWithDeps({
            candidates: plan.candidates,
            executeWrite: (request) => executeBuilderCmsWrite({ request }),
            readTargetInventory: () =>
              readBuilderCmsContentEntries({
                model: targetModel,
                rawData: true,
                requirePrivateKey: true,
                limit: MAX_INVENTORY,
                maxPages: 100,
              }),
          })
        : null;
    return {
      mode: apply === true ? "applied" : "dry_run",
      sourceModel,
      targetModel,
      schema: {
        additionsRequired: plan.additions,
        incompatibleConflicts: plan.conflicts,
        mutationSupported: false,
      },
      backfill: {
        ...plan.inventory,
        candidates: plan.candidates,
        draftOnly: true,
        webhooksDisabled: true,
        executionSupported: true,
      },
      pagination: {
        source: sourceRead.value.progress,
        target: targetRead.value.progress,
        complete: true,
      },
      execution,
      timings: [
        sourceSchema.timing,
        targetSchema.timing,
        sourceRead.timing,
        targetRead.timing,
      ],
    };
  },
});
