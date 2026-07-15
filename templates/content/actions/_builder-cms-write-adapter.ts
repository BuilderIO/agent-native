import type {
  BuilderCmsModelFieldSummary,
  BuilderCmsPublicationTransitionIntent,
  BuilderCmsWriteEffect,
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecutionState,
  ContentDatabaseSourcePushMode,
  ContentDatabaseSourceWriteMode,
} from "../shared/api.js";
import { BUILDER_CMS_SAFE_WRITE_MODEL as SAFE_WRITE_MODEL } from "../shared/api.js";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  builderCmsSourceRowIdentityState,
} from "./_builder-cms-source-adapter.js";
import { builderCmsPushModeForTier } from "./_builder-cms-write-settings.js";

export type { BuilderCmsWriteEffect };

export interface BuilderCmsExecutionOperation {
  sourceFieldKey: string;
  localFieldKey: string;
  value: unknown;
}

export interface BuilderCmsExecutionPayload {
  sourceId: string;
  databaseId: string;
  sourceTable: string;
  changeSetId: string;
  pushMode: ContentDatabaseSourcePushMode;
  effect: BuilderCmsWriteEffect;
  target: {
    model: string;
    entryId: string | null;
    sourceQualifiedId: string | null;
    documentId: string | null;
    databaseItemId: string | null;
  };
  request: {
    method: "POST" | "PATCH";
    path: string;
    query: Record<string, string>;
    body: Record<string, unknown>;
  };
  operations: BuilderCmsExecutionOperation[];
  safety: {
    liveWritesEnabled: boolean;
    dryRunOnly: boolean;
    checks: string[];
    blockers: string[];
  };
  dryRun?: {
    status: "validated" | "stale" | "blocked";
    validatedAt: string;
    checks: string[];
    mismatches: string[];
  };
}

export interface BuilderCmsExecutionPlan {
  adapter: "builder-cms";
  pushMode: ContentDatabaseSourcePushMode;
  state: ContentDatabaseSourceExecutionState;
  idempotencyKey: string;
  summary: string;
  payload: BuilderCmsExecutionPayload;
  lastError: string | null;
}

export function builderCmsExecutionIdempotencyKey(args: {
  sourceId: string;
  changeSetId: string;
  pushMode: ContentDatabaseSourcePushMode;
}) {
  return `builder-cms:${args.sourceId}:${args.changeSetId}:${args.pushMode}`;
}

export const BUILDER_CMS_EXECUTION_MARKER_FIELD = "agentNativeTestNote";

function builderFieldName(sourceFieldKey: string) {
  return sourceFieldKey.replace(/^data\./, "").trim();
}

function builderModelFieldForOperation(args: {
  source: ContentDatabaseSource;
  sourceFieldKey: string;
}) {
  const name = builderFieldName(args.sourceFieldKey);
  return (
    args.source.metadata.builderModelFields?.find(
      (field) => field.name.trim() === name,
    ) ?? null
  );
}

function normalizedBuilderFieldKind(field: BuilderCmsModelFieldSummary | null) {
  return [field?.type, field?.inputType]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim()
    .toLowerCase();
}

function optionIdFromLabel(label: string) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "option"
  );
}

function builderOptionLabels(field: BuilderCmsModelFieldSummary | null) {
  const labels = [...(field?.options ?? []), ...(field?.enum ?? [])];
  const seenLabels = new Set<string>();
  const usedIds = new Set<string>();
  const result: Array<{ id: string; label: string }> = [];
  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    const labelKey = label.toLowerCase();
    if (!label || seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);
    const baseId = optionIdFromLabel(label);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    result.push({ id, label });
  }
  return result;
}

function builderNativeFieldValue(args: {
  source: ContentDatabaseSource;
  sourceFieldKey: string;
  value: unknown;
}): { value?: unknown; blocker?: string } {
  if (args.source.sourceTable !== SAFE_WRITE_MODEL) {
    return { value: args.value };
  }
  const field = builderModelFieldForOperation(args);
  const fieldLabel = field?.label?.trim() || field?.name || args.sourceFieldKey;
  const kind = normalizedBuilderFieldKind(field);

  if (/\b(date|datetime)\b/.test(kind)) {
    const raw =
      args.value && typeof args.value === "object" && !Array.isArray(args.value)
        ? (args.value as { start?: unknown }).start
        : args.value;
    if (typeof raw !== "string" && typeof raw !== "number") {
      return { blocker: `${fieldLabel} must be a valid Builder date.` };
    }
    const timestamp =
      typeof raw === "number" ? raw : new Date(raw.trim()).getTime();
    if (!Number.isFinite(timestamp)) {
      return { blocker: `${fieldLabel} must be a valid Builder date.` };
    }
    return { value: timestamp };
  }

  if (/\b(file|image)\b/.test(kind)) {
    const candidates = Array.isArray(args.value) ? args.value : [args.value];
    if (candidates.length !== 1 || typeof candidates[0] !== "string") {
      return { blocker: `${fieldLabel} must contain exactly one file URL.` };
    }
    try {
      const url = new URL(candidates[0]);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw 0;
      return { value: url.toString() };
    } catch {
      return { blocker: `${fieldLabel} must contain exactly one file URL.` };
    }
  }

  if (/\b(reference|relation)\b/.test(kind)) {
    if (
      args.value &&
      typeof args.value === "object" &&
      !Array.isArray(args.value)
    ) {
      const reference = args.value as Record<string, unknown>;
      if (
        reference["@type"] === "@builder.io/core:Reference" &&
        typeof reference.id === "string" &&
        reference.id.trim() &&
        typeof reference.model === "string" &&
        reference.model.trim()
      ) {
        return {
          value: {
            "@type": "@builder.io/core:Reference",
            id: reference.id.trim(),
            model: reference.model.trim(),
          },
        };
      }
    }
    const ids = Array.isArray(args.value) ? args.value : [args.value];
    const id = ids.length === 1 ? ids[0] : null;
    if (typeof id !== "string" || !id.trim() || !field?.model?.trim()) {
      return {
        blocker: `${fieldLabel} must contain one Builder reference with a model.`,
      };
    }
    return {
      value: {
        "@type": "@builder.io/core:Reference",
        id: id.trim(),
        model: field.model.trim(),
      },
    };
  }

  const choices = builderOptionLabels(field);
  const isList = /\b(list|array|tags?|multi[-_\s]?select)\b/.test(kind);
  if (isList || choices.length > 0) {
    const values = Array.isArray(args.value) ? args.value : [args.value];
    const labels = values.map((value) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      // Builder Tags/list fields can be free-form: unlike enums and optioned
      // selects, their model metadata has no finite label inventory. Preserve
      // strict mapping whenever choices exist, but pass non-empty labels
      // through when Builder explicitly exposes no choices to map against.
      if (isList && choices.length === 0) return trimmed || null;
      return (
        choices.find(
          (choice) =>
            choice.label.toLowerCase() === trimmed.toLowerCase() ||
            choice.id === trimmed,
        )?.label ?? null
      );
    });
    if (labels.some((label) => label === null)) {
      return {
        blocker: `${fieldLabel} contains an option that cannot be mapped to a Builder label.`,
      };
    }
    return { value: isList ? labels : labels[0] };
  }

  return { value: args.value };
}

function hasBuilderRequiredValue(
  value: unknown,
  field: BuilderCmsModelFieldSummary,
) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  const kind = normalizedBuilderFieldKind(field);
  if (/\b(date|datetime)\b/.test(kind)) {
    return (
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && Number.isFinite(new Date(value).getTime()))
    );
  }
  if (/\b(file|image)\b/.test(kind)) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
  if (/\b(reference|relation)\b/.test(kind)) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const reference = value as Record<string, unknown>;
    return (
      reference["@type"] === "@builder.io/core:Reference" &&
      typeof reference.id === "string" &&
      reference.id.trim().length > 0 &&
      typeof reference.model === "string" &&
      reference.model.trim().length > 0
    );
  }
  if (/\b(list|array|tags?|multi[-_\s]?select)\b/.test(kind)) {
    return Array.isArray(value) && value.length > 0;
  }
  if (/\b(number)\b/.test(kind)) {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (/\b(boolean|checkbox)\b/.test(kind)) return typeof value === "boolean";
  if (/\b(string|text|url|select)\b/.test(kind)) {
    return typeof value === "string" && value.trim().length > 0;
  }
  return true;
}

function portableIntentHash(input: string) {
  const hashPart = (seed: number) => {
    let hash = (0x811c9dc5 ^ seed) >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193) >>> 0;
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
    hash ^= hash >>> 16;
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  return [0, 0x9e3779b9, 0x7f4a7c15].map(hashPart).join("");
}

/** A compact, non-secret marker for recovering an ambiguous safe-model POST. */
export function builderCmsExecutionIntentMarker(idempotencyKey: string) {
  return `agent-native-execution:${portableIntentHash(idempotencyKey)}`;
}

function builderEffectForWrite(args: {
  pushMode: ContentDatabaseSourcePushMode;
  writeMode?: ContentDatabaseSourceWriteMode | null;
  entryId: string | null;
  publicationTransition?: BuilderCmsPublicationTransitionIntent | null;
}): BuilderCmsWriteEffect {
  if (!args.entryId) return "create_draft";
  if (args.publicationTransition === "publish") return "publish";
  if (args.publicationTransition === "unpublish") return "unpublish";
  if (args.writeMode === "stage_only") return "autosave";
  if (args.writeMode === "publish_updates") return "update_in_place";
  if (args.pushMode === "autosave") return "autosave";
  return "update_in_place";
}

function normalizeSourceWriteMode(
  value: unknown,
): ContentDatabaseSourceWriteMode | null {
  return value === "read_only" ||
    value === "stage_only" ||
    value === "publish_updates"
    ? value
    : null;
}

/**
 * Single source of truth for the push mode that gates an execution. Prepare and
 * execute MUST resolve this identically, or their idempotency keys diverge and
 * the gate lookup fails ("Prepare the Builder execution gate before executing
 * it"). The write tier wins when set, so a change-set's own `pushMode` (e.g. a
 * local create hardcoded to "autosave") cannot drift from the tier.
 */
export function resolveBuilderCmsExecutionPushMode(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
}): ContentDatabaseSourcePushMode {
  const sourceWriteMode = normalizeSourceWriteMode(
    args.source.metadata.writeMode,
  );
  if (sourceWriteMode) {
    return builderCmsPushModeForTier(sourceWriteMode);
  }
  return args.changeSet.pushMode ?? args.source.metadata.pushMode ?? "autosave";
}

/**
 * Resolve the Builder entry this change-set targets. A synthetic-fixture row
 * (sourceRowId `builder-<documentId>`, never matched to a real entry) resolves
 * to a null entry id, which is what makes the effect a create.
 */
export function resolveBuilderCmsWriteTarget(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
}) {
  const targetRow =
    args.source.rows.find(
      (row) =>
        row.documentId === args.changeSet.documentId ||
        row.databaseItemId === args.changeSet.databaseItemId,
    ) ?? null;
  const target = targetRow
    ? builderCmsSourceRowIdentityState({ row: targetRow })
    : null;
  const entryId = target?.isSyntheticFixture
    ? null
    : (target?.sourceRowId ?? null);
  const sourceQualifiedId = target?.isSyntheticFixture
    ? null
    : (target?.sourceQualifiedId ?? null);
  return { targetRow, target, entryId, sourceQualifiedId };
}

/**
 * The resolved write effect (create_draft / update_in_place / autosave /
 * publish / unpublish) for a change-set. Unlike buildBuilderCmsExecutionPlan
 * this does not require the change-set to be approved, so it is safe to call
 * while building review payloads for plain-language labels.
 */
export function resolveBuilderCmsWriteEffect(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  publicationTransition?: BuilderCmsPublicationTransitionIntent | null;
}): BuilderCmsWriteEffect {
  const sourceWriteMode = normalizeSourceWriteMode(
    args.source.metadata.writeMode,
  );
  const pushMode = resolveBuilderCmsExecutionPushMode({
    source: args.source,
    changeSet: args.changeSet,
  });
  const effectivePushMode = pushMode === "none" ? "autosave" : pushMode;
  const { entryId } = resolveBuilderCmsWriteTarget({
    source: args.source,
    changeSet: args.changeSet,
  });
  return builderEffectForWrite({
    pushMode: effectivePushMode,
    writeMode: sourceWriteMode,
    entryId,
    publicationTransition: args.publicationTransition,
  });
}

function nestedBuilderPatch(
  operations: BuilderCmsExecutionOperation[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const operation of operations) {
    if (operation.sourceFieldKey.startsWith("data.")) {
      const fieldKey = operation.sourceFieldKey.slice("data.".length);
      const data = (
        body.data && typeof body.data === "object" ? body.data : {}
      ) as Record<string, unknown>;
      data[fieldKey] = operation.value;
      body.data = data;
      continue;
    }
    body[operation.sourceFieldKey] = operation.value;
  }
  return body;
}

function mergeBuilderPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      key === "data" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      merged.data = {
        ...((merged.data && typeof merged.data === "object"
          ? merged.data
          : {}) as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function requiredBuilderReferencePatch(args: {
  source: ContentDatabaseSource;
  targetRow: ContentDatabaseSource["rows"][number] | null;
  effect: BuilderCmsWriteEffect;
}) {
  if (
    args.source.sourceTable !== SAFE_WRITE_MODEL ||
    args.effect !== "publish" ||
    !args.targetRow
  ) {
    return {};
  }
  const data: Record<string, unknown> = {};
  for (const field of args.source.metadata.builderModelFields ?? []) {
    if (
      !field.required ||
      !/\b(reference|relation)\b/.test(normalizedBuilderFieldKind(field)) ||
      !field.model?.trim()
    ) {
      continue;
    }
    const sourceFieldKey = `data.${field.name.trim()}`;
    const id =
      args.targetRow.sourceValues?.[
        `__agent_native_builder_reference_id:${sourceFieldKey}`
      ];
    if (typeof id !== "string" || !id.trim()) continue;
    data[field.name] = {
      "@type": "@builder.io/core:Reference",
      id: id.trim(),
      model: field.model.trim(),
    };
  }
  return Object.keys(data).length > 0 ? { data } : {};
}

function builderBodyPatch(changeSet: ContentDatabaseSourceChangeSet) {
  const bodyChange = changeSet.bodyChange;
  const checks: string[] = [];
  const blockers: string[] = [];
  if (!bodyChange) {
    return { patch: {}, checks, blockers, hasBodyOperation: false };
  }
  if (!bodyChange.proposedBlocksJson) {
    blockers.push(
      "Builder body diff could not be converted to Builder blocks.",
    );
    return { patch: {}, checks, blockers, hasBodyOperation: false };
  }
  try {
    const blocks = JSON.parse(bodyChange.proposedBlocksJson) as unknown;
    if (!Array.isArray(blocks)) {
      blockers.push("Builder body diff did not produce a blocks array.");
      return { patch: {}, checks, blockers, hasBodyOperation: false };
    }
    checks.push("Includes converted Builder body blocks.");
    for (const warning of bodyChange.warnings ?? []) {
      checks.push(`Body conversion warning: ${warning}`);
    }
    return {
      patch: {
        data: {
          blocks,
        },
      },
      checks,
      blockers,
      hasBodyOperation: true,
    };
  } catch {
    blockers.push("Builder body diff contains invalid converted blocks JSON.");
    return { patch: {}, checks, blockers, hasBodyOperation: false };
  }
}

function builderRequestForEffect(args: {
  effect: BuilderCmsWriteEffect;
  model: string;
  entryId: string | null;
  bodyPatch: Record<string, unknown>;
  currentTitle?: string | null;
  intentMarker?: string;
}): BuilderCmsExecutionPayload["request"] {
  const entryPath = args.entryId ? `/${encodeURIComponent(args.entryId)}` : "";
  const basePath = `/api/v1/write/${encodeURIComponent(args.model)}${entryPath}`;
  const patchedTitle =
    args.bodyPatch.data &&
    typeof args.bodyPatch.data === "object" &&
    !Array.isArray(args.bodyPatch.data) &&
    typeof (args.bodyPatch.data as Record<string, unknown>).title === "string"
      ? (args.bodyPatch.data as Record<string, unknown>).title
      : null;
  const safeEntryName =
    args.model === SAFE_WRITE_MODEL
      ? patchedTitle || args.currentTitle?.trim() || null
      : null;
  if (args.effect === "autosave") {
    return {
      method: "PATCH",
      path: basePath,
      query: {
        autoSaveOnly: "true",
        triggerWebhooks: "false",
      },
      body: {
        ...args.bodyPatch,
        ...(safeEntryName ? { name: safeEntryName } : {}),
      },
    };
  }
  if (args.effect === "update_in_place") {
    return {
      method: "PATCH",
      path: basePath,
      query: {
        triggerWebhooks: "true",
      },
      body: {
        ...args.bodyPatch,
        ...(safeEntryName ? { name: safeEntryName } : {}),
      },
    };
  }
  if (args.effect === "publish") {
    return {
      method: args.entryId ? "PATCH" : "POST",
      path: basePath,
      query: {
        triggerWebhooks: "true",
      },
      body: {
        ...args.bodyPatch,
        published: "published",
      },
    };
  }
  if (args.effect === "unpublish") {
    return {
      method: "PATCH",
      path: basePath,
      query: {
        triggerWebhooks: "true",
      },
      body: {
        ...args.bodyPatch,
        published: "draft",
      },
    };
  }
  return {
    method: "POST",
    path: basePath,
    query: {
      triggerWebhooks: "false",
    },
    body: {
      ...args.bodyPatch,
      ...(safeEntryName ? { name: safeEntryName } : {}),
      data: {
        ...((args.bodyPatch.data && typeof args.bodyPatch.data === "object"
          ? args.bodyPatch.data
          : {}) as Record<string, unknown>),
        ...(args.intentMarker
          ? { [BUILDER_CMS_EXECUTION_MARKER_FIELD]: args.intentMarker }
          : {}),
      },
      published: "draft",
    },
  };
}

function builderRequiredFieldBlockers(args: {
  source: ContentDatabaseSource;
  effect: BuilderCmsWriteEffect;
  targetRow: ContentDatabaseSource["rows"][number] | null;
  request: BuilderCmsExecutionPayload["request"];
}) {
  if (
    args.source.sourceTable !== SAFE_WRITE_MODEL ||
    (args.effect !== "create_draft" && args.effect !== "publish")
  ) {
    return [];
  }
  const modelFields = args.source.metadata.builderModelFields;
  // Legacy persisted execution gates predate model-schema snapshots. Preserve
  // their exact behavior; newly prepared safe-model gates carry the schema and
  // are validated below before they can become ready.
  if (!modelFields?.length) return [];
  const existingData = Object.fromEntries(
    Object.entries(args.targetRow?.sourceValues ?? {}).flatMap(([key, value]) =>
      key.startsWith("data.") ? [[key.slice("data.".length), value]] : [],
    ),
  );
  const requestData =
    args.request.body.data &&
    typeof args.request.body.data === "object" &&
    !Array.isArray(args.request.body.data)
      ? (args.request.body.data as Record<string, unknown>)
      : {};
  const effectiveData = { ...existingData, ...requestData };
  if (
    effectiveData.blocks === undefined &&
    typeof args.targetRow?.sourceValues?.[BUILDER_CMS_BODY_BLOCKS_HASH_KEY] ===
      "string" &&
    args.targetRow.sourceValues[BUILDER_CMS_BODY_BLOCKS_HASH_KEY].trim()
  ) {
    // Body blocks are intentionally stored outside sourceValues. A reconciled
    // body hash proves that the hydrated Builder body exists without copying a
    // large blocks payload into SQL merely to satisfy this gate.
    effectiveData.blocks = ["reconciled-builder-body"];
  }
  return modelFields.flatMap((field) => {
    if (!field.required) return [];
    const value = effectiveData[field.name];
    if (hasBuilderRequiredValue(value, field)) return [];
    return [
      `Required Builder field ${field.label?.trim() || field.name} is missing or invalid.`,
    ];
  });
}

function builderSafetyChecks(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  pushMode: ContentDatabaseSourcePushMode;
  effect: BuilderCmsWriteEffect;
  publicationTransition?: BuilderCmsPublicationTransitionIntent | null;
  confirmUnpublish?: boolean;
  entryId: string | null;
  syntheticFixtureTarget: boolean;
  operations: BuilderCmsExecutionOperation[];
  hasBodyOperation: boolean;
  bodyChecks: string[];
  bodyBlockers: string[];
  fieldBlockers: string[];
  requiredFieldBlockers: string[];
}) {
  const checks = [
    "Requires explicit approval before execution.",
    "Uses the stored execution idempotency key.",
    ...args.bodyChecks,
  ];
  const blockers: string[] = [
    ...args.bodyBlockers,
    ...args.fieldBlockers,
    ...args.requiredFieldBlockers,
  ];

  if (args.source.sourceTable !== SAFE_WRITE_MODEL) {
    blockers.push(
      `Live Builder writes are only allowed for ${SAFE_WRITE_MODEL}.`,
    );
  }

  if (args.operations.length === 0 && !args.hasBodyOperation) {
    blockers.push("No Builder operations are available for this change.");
  }
  if (args.effect === "autosave" || args.effect === "update_in_place") {
    const label = args.effect === "autosave" ? "Autosave" : "Update in place";
    checks.push(
      `${label} preserves publication state — no published field is sent.`,
    );
    if (args.syntheticFixtureTarget) {
      blockers.push(
        "This row is not matched to a Builder entry yet. Refresh or match a Builder row before pushing.",
      );
    } else if (!args.entryId) {
      blockers.push(`${label} requires an existing Builder entry ID.`);
    }
  }
  if (args.effect === "create_draft") {
    checks.push(
      "Create draft writes a new Builder entry with published state set to draft.",
    );
    // A create_draft target has no Builder entry by definition — that is the
    // whole point of a create. The unmatched-row blocker only applies to
    // effects that write to an existing entry (autosave / update_in_place).
  }
  if (args.effect === "publish") {
    checks.push(
      "Publish transition sets Builder published state to published.",
    );
    if (args.publicationTransition !== "publish") {
      blockers.push("Publish requires an explicit publication transition.");
    }
    if (args.source.metadata.allowPublicationTransitions !== true) {
      blockers.push("Publication transitions are not enabled for this source.");
    }
  }
  if (args.effect === "unpublish") {
    checks.push("Unpublish transition sets Builder published state to draft.");
    if (args.source.metadata.allowPublicationTransitions !== true) {
      blockers.push("Publication transitions are not enabled for this source.");
    }
    if (args.confirmUnpublish !== true) {
      blockers.push("Unpublish requires explicit confirmation.");
    }
  }

  const allowedModes = args.source.metadata.allowedWriteModes;
  if (allowedModes?.length && !allowedModes.includes(args.pushMode)) {
    blockers.push(`Push mode ${args.pushMode} is not allowed for this source.`);
  }
  if (args.source.capabilities.liveWritesEnabled !== true) {
    checks.push("Does not run while live Builder writes are disabled.");
    if (
      args.effect === "update_in_place" ||
      args.effect === "publish" ||
      args.effect === "unpublish"
    ) {
      blockers.push(
        `${args.effect} requires live Builder writes to be enabled.`,
      );
    }
  }

  return { checks, blockers };
}

export function buildBuilderCmsExecutionPlan(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  pushModeConfirmation?: ContentDatabaseSourcePushMode | null;
  publicationTransition?: BuilderCmsPublicationTransitionIntent | null;
  confirmUnpublish?: boolean;
}): BuilderCmsExecutionPlan {
  if (args.source.sourceType !== "builder-cms") {
    throw new Error("Builder execution plans require a Builder CMS source.");
  }
  if (args.changeSet.direction !== "outbound") {
    throw new Error("Only outbound Builder change sets can be prepared.");
  }
  if (args.changeSet.state !== "approved") {
    throw new Error(
      "Approve the Builder change set before preparing execution.",
    );
  }

  const sourceWriteMode = normalizeSourceWriteMode(
    args.source.metadata.writeMode,
  );
  const pushMode = resolveBuilderCmsExecutionPushMode({
    source: args.source,
    changeSet: args.changeSet,
  });
  const effectivePushMode = pushMode === "none" ? "autosave" : pushMode;
  if (pushMode === "none") {
    if (args.source.capabilities.liveWritesEnabled === true) {
      throw new Error(
        "Builder execution requires Autosave, Draft, or Publish push mode.",
      );
    }
  }
  if (
    pushMode !== "none" &&
    args.pushModeConfirmation &&
    args.pushModeConfirmation !== pushMode
  ) {
    throw new Error(
      `Push mode confirmation did not match approved change set: ${pushMode}.`,
    );
  }

  const {
    targetRow,
    target,
    entryId: targetEntryId,
    sourceQualifiedId: targetSourceQualifiedId,
  } = resolveBuilderCmsWriteTarget({
    source: args.source,
    changeSet: args.changeSet,
  });
  const effect = builderEffectForWrite({
    pushMode: effectivePushMode,
    writeMode: sourceWriteMode,
    entryId: targetEntryId,
    publicationTransition: args.publicationTransition,
  });
  const operations: BuilderCmsExecutionOperation[] = [];
  const fieldBlockers: string[] = [];
  for (const field of args.changeSet.fieldChanges) {
    let candidateValue: unknown = field.proposedValue;
    if (
      args.source.sourceTable === SAFE_WRITE_MODEL &&
      field.builderValueJson !== undefined
    ) {
      try {
        candidateValue = JSON.parse(field.builderValueJson) as unknown;
      } catch {
        fieldBlockers.push(
          `${field.propertyName ?? field.sourceFieldKey} has invalid Builder provider JSON.`,
        );
        continue;
      }
    }
    const converted = builderNativeFieldValue({
      source: args.source,
      sourceFieldKey: field.sourceFieldKey,
      value: candidateValue,
    });
    if (converted.blocker) {
      fieldBlockers.push(converted.blocker);
      continue;
    }
    operations.push({
      sourceFieldKey: field.sourceFieldKey,
      localFieldKey: field.localFieldKey,
      value: converted.value,
    });
  }
  const bodyDiffPatch = builderBodyPatch(args.changeSet);
  const bodyPatch = mergeBuilderPatch(
    mergeBuilderPatch(
      requiredBuilderReferencePatch({ source: args.source, targetRow, effect }),
      nestedBuilderPatch(operations),
    ),
    bodyDiffPatch.patch,
  );
  // State-preserving effects must not include `published` in the body. Builder
  // PATCH preserves omitted publication state, so only transition/create effects
  // are allowed to set it.
  const request = builderRequestForEffect({
    effect,
    model: args.source.sourceTable,
    entryId: targetEntryId,
    bodyPatch,
    currentTitle: targetRow?.sourceDisplayKey ?? null,
    intentMarker:
      effect === "create_draft" && args.source.sourceTable === SAFE_WRITE_MODEL
        ? builderCmsExecutionIntentMarker(
            builderCmsExecutionIdempotencyKey({
              sourceId: args.source.id,
              changeSetId: args.changeSet.id,
              pushMode,
            }),
          )
        : undefined,
  });
  const requiredFieldBlockers = builderRequiredFieldBlockers({
    source: args.source,
    effect,
    targetRow,
    request,
  });
  const safety = builderSafetyChecks({
    source: args.source,
    changeSet: args.changeSet,
    pushMode: effectivePushMode,
    effect,
    publicationTransition: args.publicationTransition,
    confirmUnpublish: args.confirmUnpublish,
    entryId: targetEntryId,
    syntheticFixtureTarget:
      args.source.capabilities.liveWritesEnabled === true &&
      args.source.sourceTable === SAFE_WRITE_MODEL &&
      target?.isSyntheticFixture === true,
    operations,
    hasBodyOperation: bodyDiffPatch.hasBodyOperation,
    bodyChecks: bodyDiffPatch.checks,
    bodyBlockers: bodyDiffPatch.blockers,
    fieldBlockers,
    requiredFieldBlockers,
  });
  const state: ContentDatabaseSourceExecutionState =
    safety.blockers.length > 0
      ? "blocked"
      : args.source.capabilities.liveWritesEnabled === true
        ? "ready"
        : "write_disabled";
  // Key on the RAW resolved push mode (which may be "none" for a read-only
  // tier), not the effective one. Collapsing "none" → "autosave" would let a
  // read-only gate share a key with a stage-only gate for the same change-set,
  // so enabling live writes could reuse a gate prepared under read-only.
  const idempotencyKey = builderCmsExecutionIdempotencyKey({
    sourceId: args.source.id,
    changeSetId: args.changeSet.id,
    pushMode,
  });
  const summaryMode = pushMode === "none" ? "read-only" : pushMode;
  const summary =
    state === "ready"
      ? `Prepared Builder ${summaryMode} execution. Ready to send to Builder.`
      : state === "blocked"
        ? `Prepared Builder ${summaryMode} execution, but it is blocked: ${safety.blockers.join(" ")}`
        : `Prepared Builder ${summaryMode} execution, but live writes are disabled.`;
  const lastError =
    state === "ready"
      ? null
      : state === "blocked"
        ? safety.blockers.join(" ")
        : "Live Builder writes are disabled for this source.";

  return {
    adapter: "builder-cms",
    pushMode: effectivePushMode,
    state,
    idempotencyKey,
    summary,
    payload: {
      sourceId: args.source.id,
      databaseId: args.source.databaseId,
      sourceTable: args.source.sourceTable,
      changeSetId: args.changeSet.id,
      effect,
      target: {
        model: args.source.sourceTable,
        entryId: targetEntryId,
        sourceQualifiedId: targetSourceQualifiedId,
        documentId: args.changeSet.documentId,
        databaseItemId: args.changeSet.databaseItemId,
      },
      pushMode: effectivePushMode,
      request,
      operations,
      safety: {
        liveWritesEnabled: args.source.capabilities.liveWritesEnabled,
        dryRunOnly:
          args.source.capabilities.liveWritesEnabled !== true ||
          state !== "ready",
        checks: safety.checks,
        blockers: safety.blockers,
      },
    },
    lastError,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stripDryRun(
  payload: Partial<BuilderCmsExecutionPayload>,
): Partial<BuilderCmsExecutionPayload> {
  const { dryRun: _dryRun, ...rest } = payload;
  return rest;
}

export function validateBuilderCmsExecutionDryRun(args: {
  storedPayload: Record<string, unknown>;
  plan: BuilderCmsExecutionPlan;
  now: string;
}): BuilderCmsExecutionPayload {
  const storedPayload =
    args.storedPayload as Partial<BuilderCmsExecutionPayload>;
  const storedComparable = stripDryRun(storedPayload);
  const planComparable = stripDryRun(args.plan.payload);
  const mismatches: string[] = [];

  if (
    stableJson(storedComparable.request) !== stableJson(planComparable.request)
  ) {
    mismatches.push(
      "Stored Builder request no longer matches the approved change.",
    );
  }
  if (
    stableJson(storedComparable.operations) !==
    stableJson(planComparable.operations)
  ) {
    mismatches.push(
      "Stored Builder operations no longer match the approved change.",
    );
  }
  if (storedComparable.effect !== planComparable.effect) {
    mismatches.push(
      "Stored Builder effect no longer matches the approved write mode.",
    );
  }
  if (
    stableJson(storedComparable.target) !== stableJson(planComparable.target)
  ) {
    mismatches.push(
      "Stored Builder target no longer matches the current row identity.",
    );
  }

  const blockers = planComparable.safety?.blockers ?? [];
  const status =
    mismatches.length > 0
      ? "stale"
      : blockers.length > 0
        ? "blocked"
        : "validated";

  const basePayload = mismatches.length > 0 ? storedPayload : args.plan.payload;

  return {
    ...basePayload,
    dryRun: {
      status,
      validatedAt: args.now,
      checks: [
        "Rebuilt execution plan from current source state.",
        "Compared request, operations, effect, and target against stored gate.",
        "No Builder API call was made.",
      ],
      mismatches,
    },
  } as BuilderCmsExecutionPayload;
}
