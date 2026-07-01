import type {
  BuilderCmsPublicationTransitionIntent,
  BuilderCmsWriteEffect,
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecutionState,
  ContentDatabaseSourcePushMode,
  ContentDatabaseSourceWriteMode,
} from "../shared/api.js";
import { BUILDER_CMS_SAFE_WRITE_MODEL as SAFE_WRITE_MODEL } from "../shared/api.js";
import { builderCmsSourceRowIdentityState } from "./_builder-cms-source-adapter.js";
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
}): BuilderCmsExecutionPayload["request"] {
  const entryPath = args.entryId ? `/${encodeURIComponent(args.entryId)}` : "";
  const basePath = `/api/v1/write/${encodeURIComponent(args.model)}${entryPath}`;
  if (args.effect === "autosave") {
    return {
      method: "PATCH",
      path: basePath,
      query: {
        autoSaveOnly: "true",
        triggerWebhooks: "false",
      },
      body: args.bodyPatch,
    };
  }
  if (args.effect === "update_in_place") {
    return {
      method: "PATCH",
      path: basePath,
      query: {
        triggerWebhooks: "true",
      },
      body: args.bodyPatch,
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
      published: "draft",
    },
  };
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
}) {
  const checks = [
    "Requires explicit approval before execution.",
    "Uses the stored execution idempotency key.",
    ...args.bodyChecks,
  ];
  const blockers: string[] = [...args.bodyBlockers];

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
  if (
    args.source.capabilities.liveWritesEnabled === true &&
    args.source.sourceTable !== SAFE_WRITE_MODEL
  ) {
    blockers.push(
      `Live Builder writes are only allowed for ${SAFE_WRITE_MODEL}.`,
    );
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
  const operations = args.changeSet.fieldChanges.map((field) => ({
    sourceFieldKey: field.sourceFieldKey,
    localFieldKey: field.localFieldKey,
    value: field.proposedValue,
  }));
  const bodyDiffPatch = builderBodyPatch(args.changeSet);
  const bodyPatch = mergeBuilderPatch(
    nestedBuilderPatch(operations),
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
