import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecutionState,
  ContentDatabaseSourcePushMode,
} from "../shared/api.js";
import { BUILDER_CMS_SAFE_WRITE_MODEL as SAFE_WRITE_MODEL } from "../shared/api.js";
import { builderCmsSourceRowIdentityState } from "./_builder-cms-source-adapter.js";

export type BuilderCmsWriteIntent =
  | "autosave_revision"
  | "save_draft"
  | "publish";

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
  intent: BuilderCmsWriteIntent;
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

function builderIntentForPushMode(
  pushMode: ContentDatabaseSourcePushMode,
): BuilderCmsWriteIntent {
  if (pushMode === "draft") return "save_draft";
  if (pushMode === "publish") return "publish";
  return "autosave_revision";
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

function builderRequestForIntent(args: {
  intent: BuilderCmsWriteIntent;
  model: string;
  entryId: string | null;
  bodyPatch: Record<string, unknown>;
}): BuilderCmsExecutionPayload["request"] {
  const entryPath = args.entryId ? `/${encodeURIComponent(args.entryId)}` : "";
  const basePath = `/api/v1/write/${encodeURIComponent(args.model)}${entryPath}`;
  if (args.intent === "autosave_revision") {
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
  if (args.intent === "publish") {
    return {
      method: args.entryId ? "PATCH" : "POST",
      path: basePath,
      query: {
        triggerWebhooks: "false",
      },
      body: {
        ...args.bodyPatch,
        published: "published",
      },
    };
  }
  return {
    method: args.entryId ? "PATCH" : "POST",
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
  intent: BuilderCmsWriteIntent;
  entryId: string | null;
  syntheticFixtureTarget: boolean;
  operations: BuilderCmsExecutionOperation[];
}) {
  const checks = [
    "Requires explicit approval before execution.",
    "Uses the stored execution idempotency key.",
    "Does not run while live Builder writes are disabled.",
  ];
  const blockers: string[] = [];

  if (args.operations.length === 0) {
    blockers.push("No field operations are available for this Builder change.");
  }
  if (args.changeSet.bodyChange) {
    blockers.push("Builder body diffs are not executable in this slice.");
  }
  if (args.intent === "autosave_revision") {
    checks.push("Autosave keeps published state unchanged.");
    if (args.syntheticFixtureTarget) {
      blockers.push(
        "This row is not matched to a Builder entry yet. Refresh or match a Builder row before pushing.",
      );
    } else if (!args.entryId) {
      blockers.push("Autosave requires an existing Builder entry ID.");
    }
  }
  if (args.intent === "save_draft") {
    checks.push("Draft writes set Builder published state to draft.");
    if (args.source.metadata.allowDraftWrites !== true) {
      blockers.push(
        "Draft writes require explicit adapter opt-in because draft can affect already-live content.",
      );
    }
  }
  if (args.intent === "publish") {
    checks.push("Publish writes set Builder published state to published.");
    if (args.source.metadata.allowPublishWrites !== true) {
      blockers.push("Publish writes require explicit adapter opt-in.");
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

  return { checks, blockers };
}

export function buildBuilderCmsExecutionPlan(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  pushModeConfirmation?: ContentDatabaseSourcePushMode | null;
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

  const pushMode =
    args.changeSet.pushMode ?? args.source.metadata.pushMode ?? "autosave";
  if (pushMode === "none") {
    throw new Error(
      "Builder execution requires Autosave, Draft, or Publish push mode.",
    );
  }
  if (args.pushModeConfirmation && args.pushModeConfirmation !== pushMode) {
    throw new Error(
      `Push mode confirmation did not match approved change set: ${pushMode}.`,
    );
  }

  const intent = builderIntentForPushMode(pushMode);
  const targetRow =
    args.source.rows.find(
      (row) =>
        row.documentId === args.changeSet.documentId ||
        row.databaseItemId === args.changeSet.databaseItemId,
    ) ?? null;
  const target = targetRow
    ? builderCmsSourceRowIdentityState({
        row: targetRow,
      })
    : null;
  const targetEntryId = target?.isSyntheticFixture
    ? null
    : (target?.sourceRowId ?? null);
  const targetSourceQualifiedId = target?.isSyntheticFixture
    ? null
    : (target?.sourceQualifiedId ?? null);
  const operations = args.changeSet.fieldChanges.map((field) => ({
    sourceFieldKey: field.sourceFieldKey,
    localFieldKey: field.localFieldKey,
    value: field.proposedValue,
  }));
  const bodyPatch = nestedBuilderPatch(operations);
  const request = builderRequestForIntent({
    intent,
    model: args.source.sourceTable,
    entryId: targetEntryId,
    bodyPatch,
  });
  const safety = builderSafetyChecks({
    source: args.source,
    changeSet: args.changeSet,
    pushMode,
    intent,
    entryId: targetEntryId,
    syntheticFixtureTarget:
      args.source.capabilities.liveWritesEnabled === true &&
      args.source.sourceTable === SAFE_WRITE_MODEL &&
      target?.isSyntheticFixture === true,
    operations,
  });
  const state: ContentDatabaseSourceExecutionState =
    safety.blockers.length > 0
      ? "blocked"
      : args.source.capabilities.liveWritesEnabled === true
        ? "ready"
        : "write_disabled";
  const idempotencyKey = builderCmsExecutionIdempotencyKey({
    sourceId: args.source.id,
    changeSetId: args.changeSet.id,
    pushMode,
  });
  const summary =
    state === "ready"
      ? `Prepared Builder ${pushMode} execution. Ready to send to Builder.`
      : state === "blocked"
        ? `Prepared Builder ${pushMode} execution, but it is blocked: ${safety.blockers.join(" ")}`
        : `Prepared Builder ${pushMode} execution, but live writes are disabled.`;
  const lastError =
    state === "ready"
      ? null
      : state === "blocked"
        ? safety.blockers.join(" ")
        : "Live Builder writes are disabled for this source.";

  return {
    adapter: "builder-cms",
    pushMode,
    state,
    idempotencyKey,
    summary,
    payload: {
      sourceId: args.source.id,
      databaseId: args.source.databaseId,
      sourceTable: args.source.sourceTable,
      changeSetId: args.changeSet.id,
      intent,
      target: {
        model: args.source.sourceTable,
        entryId: targetEntryId,
        sourceQualifiedId: targetSourceQualifiedId,
        documentId: args.changeSet.documentId,
        databaseItemId: args.changeSet.databaseItemId,
      },
      pushMode,
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
  if (storedComparable.intent !== planComparable.intent) {
    mismatches.push(
      "Stored Builder intent no longer matches the approved push mode.",
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
        "Compared request, operations, intent, and target against stored gate.",
        "No Builder API call was made.",
      ],
      mismatches,
    },
  } as BuilderCmsExecutionPayload;
}
