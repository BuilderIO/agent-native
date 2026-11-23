export type SchemaRefreshLifecycleState =
  | { status: "untracked"; connectionId: string }
  | { status: "pending"; connectionId: string }
  | { status: "failed"; connectionId: string; errorCode: string }
  | { status: "malformed"; connectionId: string; errorCode: string }
  | {
      status: "complete";
      connectionId: string;
      verifiedTableReferences: string[];
      validEmptyTableReferences: string[];
    }
  | {
      status: "valid-empty";
      connectionId: string;
      tableReference: string;
    }
  | { status: "unverified"; connectionId: string; tableReference: string };

export type SchemaRefreshLifecycleRead =
  | { kind: "untracked" }
  | { kind: "malformed" }
  | { kind: "tracked"; states: SchemaRefreshLifecycleState[] };

// This boundary is request-scoped until Analytics-2 owns durable refresh state.

type SemanticModelSource = {
  connectionId?: unknown;
  sourceReference?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tableReferences(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (reference) =>
        typeof reference === "string" &&
        reference.trim().length > 0 &&
        reference.length <= 512,
    )
  );
}

function parseLifecycleState(
  value: unknown,
): SchemaRefreshLifecycleState | null {
  if (!isRecord(value) || typeof value.connectionId !== "string") {
    return null;
  }
  const connectionId = value.connectionId.trim();
  if (!connectionId || connectionId.length > 512) return null;

  if (value.status === "untracked" || value.status === "pending") {
    return { status: value.status, connectionId };
  }
  if (value.status === "failed" || value.status === "malformed") {
    return typeof value.errorCode === "string" && value.errorCode.length <= 160
      ? { status: value.status, connectionId, errorCode: value.errorCode }
      : null;
  }
  if (value.status === "complete") {
    const verified = value.verifiedTableReferences;
    const validEmpty = value.validEmptyTableReferences;
    if (
      !tableReferences(verified) ||
      !tableReferences(validEmpty) ||
      verified.some((reference) => validEmpty.includes(reference))
    ) {
      return null;
    }
    return {
      status: "complete",
      connectionId,
      verifiedTableReferences: verified,
      validEmptyTableReferences: validEmpty,
    };
  }
  if (value.status === "valid-empty" || value.status === "unverified") {
    return typeof value.tableReference === "string" &&
      value.tableReference.trim().length > 0 &&
      value.tableReference.length <= 512
      ? {
          status: value.status,
          connectionId,
          tableReference: value.tableReference,
        }
      : null;
  }
  return null;
}

export function readSchemaRefreshLifecycles(
  value: unknown,
): SchemaRefreshLifecycleRead {
  if (value === undefined) return { kind: "untracked" };
  if (!isRecord(value)) return { kind: "malformed" };
  const states = value.analytics2SchemaRefreshLifecycles;
  if (states === undefined) return { kind: "untracked" };
  if (!Array.isArray(states)) return { kind: "malformed" };

  const parsed = states.map(parseLifecycleState);
  if (parsed.some((state) => state === null)) return { kind: "malformed" };
  const validStates = parsed as SchemaRefreshLifecycleState[];
  const connectionIds = validStates.map((state) => state.connectionId);
  if (new Set(connectionIds).size !== connectionIds.length) {
    return { kind: "malformed" };
  }
  return { kind: "tracked", states: validStates };
}

export function schemaRefreshLifecyclesFromEvent(
  event: unknown,
): SchemaRefreshLifecycleRead {
  if (!isRecord(event) || event.context === undefined) {
    return { kind: "untracked" };
  }
  if (!isRecord(event.context)) return { kind: "malformed" };
  const threadContext = event.context.analytics2ThreadContext;
  if (threadContext === undefined) return { kind: "untracked" };
  if (!isRecord(threadContext)) return { kind: "malformed" };
  if (threadContext.schemaRefreshLifecycles === undefined) {
    return { kind: "untracked" };
  }
  return readSchemaRefreshLifecycles({
    analytics2SchemaRefreshLifecycles: threadContext.schemaRefreshLifecycles,
  });
}

export function schemaRefreshStateForConnection(
  lifecycle: SchemaRefreshLifecycleRead,
  connectionId: string,
): SchemaRefreshLifecycleState {
  if (lifecycle.kind === "untracked") {
    return { status: "untracked", connectionId };
  }
  if (lifecycle.kind === "malformed") {
    return {
      status: "malformed",
      connectionId,
      errorCode: "schema_refresh_context_malformed",
    };
  }
  return (
    lifecycle.states.find((state) => state.connectionId === connectionId) ?? {
      status: "untracked",
      connectionId,
    }
  );
}

export function schemaRefreshStateForModel(
  model: SemanticModelSource,
  lifecycle: SchemaRefreshLifecycleRead,
): SchemaRefreshLifecycleState {
  const connectionId =
    typeof model.connectionId === "string" ? model.connectionId : "";
  const sourceReference =
    typeof model.sourceReference === "string" ? model.sourceReference : "";
  if (!connectionId) return { status: "untracked", connectionId: "" };

  const state = schemaRefreshStateForConnection(lifecycle, connectionId);
  if (state.status !== "complete") return state;
  if (state.verifiedTableReferences.includes(sourceReference)) {
    return {
      status: "complete",
      connectionId,
      verifiedTableReferences: [sourceReference],
      validEmptyTableReferences: [],
    };
  }
  if (state.validEmptyTableReferences.includes(sourceReference)) {
    return {
      status: "valid-empty",
      connectionId,
      tableReference: sourceReference,
    };
  }
  return {
    status: "unverified",
    connectionId,
    tableReference: sourceReference,
  };
}

export function isSchemaRefreshModelAdmitted(
  state: SchemaRefreshLifecycleState,
): boolean {
  return state.status === "untracked" || state.status === "complete";
}

export function filterSemanticModelListForSchemaRefresh(
  result: unknown,
  lifecycle: SchemaRefreshLifecycleRead,
): unknown {
  if (!isRecord(result) || !Array.isArray(result.models)) return result;
  if (lifecycle.kind === "untracked") return result;
  const models =
    lifecycle.kind === "malformed"
      ? []
      : result.models.filter((model) =>
          isSchemaRefreshModelAdmitted(
            schemaRefreshStateForModel(isRecord(model) ? model : {}, lifecycle),
          ),
        );
  return {
    ...result,
    models: models.map((model) => {
      if (!isRecord(model)) return model;
      return {
        ...model,
        schemaRefreshLifecycle: schemaRefreshStateForModel(model, lifecycle),
      };
    }),
    schemaRefreshLifecycleRead: lifecycle,
  };
}

export function schemaRefreshFailureState(
  connectionId: string,
  errorCode: string,
): SchemaRefreshLifecycleState {
  return errorCode === "bigquery_schema_malformed"
    ? { status: "malformed", connectionId, errorCode }
    : { status: "failed", connectionId, errorCode };
}

export function schemaRefreshStateForDiscovery(
  connectionId: string,
  tableReference: string,
  columnCount: number,
): SchemaRefreshLifecycleState {
  return columnCount === 0
    ? { status: "valid-empty", connectionId, tableReference }
    : {
        status: "complete",
        connectionId,
        verifiedTableReferences: [tableReference],
        validEmptyTableReferences: [],
      };
}

export function schemaRefreshStateForRequestContext(
  context: unknown,
  connectionId: string,
): SchemaRefreshLifecycleState {
  return schemaRefreshStateForConnection(
    readSchemaRefreshLifecycles(context),
    connectionId,
  );
}
