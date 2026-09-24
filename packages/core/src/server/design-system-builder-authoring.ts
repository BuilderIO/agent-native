import { createHash } from "node:crypto";

import { fail, isActionContractError } from "../action.js";
import type { BuilderDsiSession } from "../shared/builder-dsi-authoring.js";
import {
  publishBuilderDesignSystemSchema,
  runBuilderDesignSystemSchema,
  type DesignSystemArtifact,
  type DesignSystemBuilderState,
  type DesignSystemWorkspace,
  type DesignSystemWorkspaceSnapshot,
  type PublishBuilderDesignSystemInput,
  type RunBuilderDesignSystemInput,
} from "../shared/design-system-authoring.js";
import { assertBuilderDsiAccess } from "./builder-dsi-access.js";
import {
  getBuilderDsiSession,
  readBuilderDsiSessionByRequest,
  publishBuilderDsiSession,
  readBuilderDsiArtifact,
  sendBuilderDsiMessage,
  startBuilderDsiSession,
} from "./builder-dsi-authoring.js";
import type {
  AuthoringSystemRow,
  DesignSystemAuthoringStore,
} from "./design-system-authoring.js";
import { prepareBuilderDesignSystemSources } from "./design-system-builder-sources.js";

type Operation = DesignSystemBuilderState["operations"][number];
type Loaded = {
  row: AuthoringSystemRow;
  data: Record<string, unknown>;
  workspace: DesignSystemWorkspace;
  canEdit: boolean;
};
type Persistence = {
  parse: (data: string) => Pick<Loaded, "data" | "workspace">;
  save: (loaded: Loaded) => Promise<DesignSystemWorkspaceSnapshot>;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function error(code: string, message: string) {
  return { code, message, retryable: false };
}

function operationError(cause: unknown, code: string, message: string) {
  return error(isActionContractError(cause) ? cause.errorCode : code, message);
}

function mutationSnapshot(
  loaded: Loaded,
  requestId: string,
  session?: BuilderDsiSession,
  statusCode?: number,
): DesignSystemWorkspaceSnapshot {
  const operation = state(loaded.workspace).operations.find(
    (item) => item.requestId === requestId,
  )!;
  if (operation.status === "failed" || operation.status === "unknown") {
    const issue =
      operation.error ??
      error(
        "design_system_builder_failed",
        "Builder could not confirm this operation.",
      );
    return fail(issue.message, {
      errorCode: issue.code,
      statusCode:
        statusCode ??
        (operation.status === "unknown" || issue.retryable ? 502 : 422),
      details: {
        id: loaded.row.id,
        requestId,
        outcome: operation.status,
        retryable: false,
        sourceErrors: state(loaded.workspace).sourceOutcomes.flatMap((source) =>
          source.error
            ? [
                {
                  sourceId: source.sourceId,
                  code: source.error.code,
                  retryable: source.error.retryable,
                },
              ]
            : [],
        ),
      },
    });
  }
  return snapshot(loaded, session);
}

function conflict(message: string): never {
  return fail(message, {
    errorCode: "design_system_revision_conflict",
    statusCode: 409,
  });
}

function state(workspace: DesignSystemWorkspace): DesignSystemBuilderState {
  if (workspace.runtime !== "builder" || !workspace.builder)
    return fail("This workspace does not use the Builder authoring runtime.", {
      errorCode: "design_system_builder_runtime_required",
      statusCode: 409,
    });
  return workspace.builder;
}

function sourceHash(workspace: DesignSystemWorkspace) {
  return hash(
    workspace.sources.map((source) =>
      source.kind === "file"
        ? [
            source.id,
            source.kind,
            source.excluded,
            source.name,
            source.mimeType,
            source.size,
            source.handle,
          ]
        : [source.id, source.kind, source.excluded, source.url],
    ),
  );
}

function batchSources(workspace: DesignSystemWorkspace) {
  const builder = state(workspace);
  return workspace.sources.filter(
    (source) => !builder.sourceIds.includes(source.id),
  );
}

function mergeSourceOutcomes(
  builder: DesignSystemBuilderState,
  outcomes: DesignSystemBuilderState["sourceOutcomes"],
) {
  const updates = new Map(
    outcomes.map((outcome) => [outcome.sourceId, outcome]),
  );
  builder.sourceOutcomes = [
    ...builder.sourceOutcomes.filter(
      (outcome) => !updates.has(outcome.sourceId),
    ),
    ...outcomes,
  ];
}

function unsettled(operation: Operation) {
  return !["completed", "failed"].includes(operation.status);
}

function expirePreparation(workspace: DesignSystemWorkspace) {
  for (const operation of state(workspace).operations) {
    if (
      operation.status !== "preparing" ||
      (operation.preparationLeaseUntil ?? Infinity) > Date.now()
    )
      continue;
    operation.status = "failed";
    operation.error = error(
      "design_system_builder_preparation_interrupted",
      "Source preparation was interrupted before dispatch. Start a new request to retry preparation.",
    );
    if (operation.sourceBatch) operation.sourceBatch.status = "needs-attention";
    operation.updatedAt = new Date().toISOString();
    workspace.run = {
      id: operation.requestId,
      status: "failed",
      stage: "needs-attention",
      error: operation.error,
    };
  }
}

function canPublishBuilderDesignSystem(
  workspace: DesignSystemWorkspace,
): boolean {
  const builder = state(workspace);
  return (
    !!builder.sessionId &&
    !!builder.revision &&
    !!builder.designSystemId &&
    !!builder.projectId &&
    !!builder.branchName &&
    builder.status === "ready" &&
    builder.workspaceStatus === "idle" &&
    builder.sourceHash === sourceHash(workspace) &&
    workspace.artifacts.length > 0 &&
    !builder.operations.some(unsettled) &&
    builder.operations.at(-1)?.status !== "failed" &&
    workspace.sources.every((source) => source.excluded || !source.error)
  );
}

export function canUseBuilderDesignSystem(
  workspace: DesignSystemWorkspace,
): boolean {
  const builder = state(workspace);
  return (
    canPublishBuilderDesignSystem(workspace) &&
    !!builder.publication &&
    builder.publication.sessionId === builder.sessionId &&
    builder.publication.revision === builder.revision &&
    builder.publication.contentRevision === workspace.contentRevision
  );
}

function snapshot(
  loaded: Loaded,
  session?: BuilderDsiSession,
): DesignSystemWorkspaceSnapshot {
  return {
    id: loaded.row.id,
    title: loaded.row.title,
    canEdit: loaded.canEdit,
    workspace: loaded.workspace,
    canUse: canUseBuilderDesignSystem(loaded.workspace),
    canPublish:
      loaded.canEdit && canPublishBuilderDesignSystem(loaded.workspace),
    ...(session ? { builderSession: session } : {}),
  };
}

function applySession(
  workspace: DesignSystemWorkspace,
  session: BuilderDsiSession,
  includeWorkspace = true,
) {
  const builder = state(workspace);
  for (const key of [
    "sessionId",
    "designSystemId",
    "projectId",
    "branchName",
  ] as const) {
    const received = session[key];
    if (builder[key] && received && builder[key] !== received)
      fail("Builder returned a different canonical design-system identity.", {
        errorCode: "design_system_builder_identity_mismatch",
        statusCode: 502,
      });
    if (!builder[key] && received) builder[key] = received;
  }
  if (
    session.workspace?.sessionId &&
    builder.codegenSessionId &&
    session.workspace.sessionId !== builder.codegenSessionId
  )
    fail("Builder returned a workspace for a different session.", {
      errorCode: "design_system_builder_identity_mismatch",
      statusCode: 502,
    });
  if (session.workspace && !builder.codegenSessionId)
    builder.codegenSessionId = session.workspace.sessionId;
  builder.status = session.status;
  if (includeWorkspace && !session.workspace)
    builder.workspaceStatus = undefined;
  const latest = session.latestTurn;
  const operation =
    latest &&
    builder.operations.find(
      (item) =>
        item.providerRequestId === latest.requestId && item.kind !== "publish",
    );
  if (operation && unsettled(operation)) {
    const nextStatus =
      latest.status === "working" ? "submitted" : latest.status;
    const nextError = latest.error
      ? error(latest.error.code, latest.error.message)
      : latest.status === "unknown"
        ? (operation.error ??
          error(
            "design_system_builder_outcome_unknown",
            "Builder has not confirmed this operation. Read its status before continuing.",
          ))
        : null;
    if (
      operation.status !== nextStatus ||
      hash(operation.error) !== hash(nextError)
    ) {
      operation.status = nextStatus;
      operation.error = nextError;
      operation.updatedAt = new Date().toISOString();
    }
    if (operation.sourceBatch) {
      const batch = operation.sourceBatch;
      batch.status =
        operation.status === "completed"
          ? "applied"
          : operation.status === "failed"
            ? "needs-attention"
            : operation.status === "unknown"
              ? "unknown"
              : "submitted";
      if (batch.status === "submitted" || batch.status === "applied") {
        builder.sourceHash = batch.hash;
        builder.sourceIds = batch.sourceIds;
        mergeSourceOutcomes(builder, batch.outcomes);
      }
    }
  }
  if (includeWorkspace && session.workspace) {
    const previous = workspace.artifacts;
    const previewChanged = builder.revision !== session.workspace.revision;
    const now = new Date().toISOString();
    const contentTypes = {
      html: "text/html",
      css: "text/css",
      json: "application/json",
      markdown: "text/markdown",
    } as const;
    if (
      new Set(session.workspace.artifacts.map((item) => item.id)).size !==
      session.workspace.artifacts.length
    )
      fail("Builder returned duplicate artifact IDs.", {
        errorCode: "builder_dsi_response_invalid",
        statusCode: 502,
      });
    const artifacts: DesignSystemArtifact[] = session.workspace.artifacts.map(
      (file) => {
        const id = `builder-${hash(file.id).slice(0, 32)}`;
        const old = previous.find((item) => item.id === id);
        if (
          old?.provider?.id === file.id &&
          old.contentHash === file.hash &&
          old.name === file.name &&
          old.provider.kind === file.kind &&
          !(file.kind === "html" && previewChanged)
        )
          return old;
        return {
          id,
          name: file.name,
          kind:
            file.kind === "html"
              ? "component"
              : file.kind === "markdown"
                ? "usage-rule"
                : "foundation",
          provider: { id: file.id, kind: file.kind },
          revision: (old?.revision ?? 0) + 1,
          provenance: "generated",
          sourceIds: builder.sourceIds,
          content: null,
          contentType: contentTypes[file.kind],
          contentHash: file.hash,
          updatedAt: now,
          history: old
            ? [
                ...old.history,
                {
                  name: old.name,
                  provenance: old.provenance,
                  sourceIds: old.sourceIds,
                  revision: old.revision,
                  content: null,
                  contentType: old.contentType,
                  contentHash: old.contentHash,
                  updatedAt: old.updatedAt,
                },
              ].slice(-20)
            : [],
        };
      },
    );
    if (
      builder.revision !== session.workspace.revision ||
      hash(artifacts) !== hash(previous)
    )
      workspace.contentRevision += 1;
    workspace.artifacts = artifacts;
    builder.revision = session.workspace.revision;
    builder.workspaceStatus = session.workspace.status;
    if (
      workspace.selectedTargetId &&
      !artifacts.some((item) => item.id === workspace.selectedTargetId)
    )
      workspace.selectedTargetId = null;
  }
  if (session.publication) {
    const receipt = session.publication;
    const publication = builder.operations.find(
      (item) =>
        item.kind === "publish" && item.providerRequestId === receipt.requestId,
    );
    if (
      publication?.publicationTarget &&
      ["dispatched", "submitted", "unknown", "completed"].includes(
        publication.status,
      )
    ) {
      if (publication.publicationTarget.expectedRevision !== receipt.revision)
        fail("Builder returned publication proof for a different revision.", {
          errorCode: "builder_dsi_response_invalid",
          statusCode: 502,
        });
      builder.publication = {
        sessionId: session.sessionId,
        revision: receipt.revision,
        published: receipt.published,
        requestId: publication.requestId,
        contentRevision: publication.publicationTarget.contentRevision,
      };
      if (publication.status !== "completed") {
        publication.status = "completed";
        publication.error = null;
        publication.updatedAt = new Date().toISOString();
      }
    }
  }
  const current = builder.operations.at(-1);
  if (
    current &&
    current.kind !== "publish" &&
    unsettled(current) &&
    (session.status === "failed" ||
      (includeWorkspace && session.workspace?.status === "failed"))
  ) {
    const issue = session.error ?? session.workspace?.error;
    current.status = "failed";
    if (current.sourceBatch) current.sourceBatch.status = "needs-attention";
    current.error = error(
      issue?.code ?? "design_system_builder_failed",
      issue?.message ?? "Builder could not complete this operation.",
    );
  }
  const problem = session.error ?? session.workspace?.error ?? current?.error;
  const failed =
    session.status === "failed" ||
    builder.workspaceStatus === "failed" ||
    current?.status === "failed" ||
    current?.status === "unknown";
  const working =
    session.status === "preparing" ||
    builder.workspaceStatus === "working" ||
    (!!current && unsettled(current));
  workspace.run = {
    id: current?.requestId ?? `builder-${hash(session.sessionId).slice(0, 32)}`,
    status: failed ? "failed" : working ? "running" : "completed",
    stage: failed
      ? "needs-attention"
      : working
        ? "building-components"
        : canUseBuilderDesignSystem(workspace)
          ? "ready"
          : "awaiting-input",
    error: problem
      ? error(problem.code, problem.message)
      : failed
        ? error(
            "design_system_builder_failed",
            "Builder could not complete this operation.",
          )
        : null,
  };
}

/** Persists only bindings, receipts and artifact metadata; provider bodies stay in Builder. */
export function createBuilderDesignSystemAuthoringService(
  store: DesignSystemAuthoringStore,
  persistence: Persistence,
) {
  async function load(id: string, write: boolean): Promise<Loaded> {
    const { row, canEdit } = await store.read(id, write);
    if (write && !canEdit)
      fail("Editor access is required.", {
        errorCode: "forbidden",
        statusCode: 403,
      });
    const parsed = persistence.parse(row.data);
    state(parsed.workspace);
    return { row, canEdit, ...parsed };
  }

  async function persist(
    id: string,
    mutate: (loaded: Loaded) => void,
  ): Promise<Loaded> {
    for (let attempt = 0; ; attempt++) {
      const loaded = await load(id, true);
      const before = JSON.stringify(loaded.workspace);
      mutate(loaded);
      if (before === JSON.stringify(loaded.workspace)) return loaded;
      try {
        await persistence.save(loaded);
        return loaded;
      } catch (cause) {
        if (
          !isActionContractError(cause) ||
          cause.errorCode !== "design_system_revision_conflict" ||
          attempt >= 3
        )
          throw cause;
      }
    }
  }

  async function reserve(
    input: RunBuilderDesignSystemInput | PublishBuilderDesignSystemInput,
    kind: Operation["kind"],
  ): Promise<{ loaded: Loaded; operation: Operation; duplicate: boolean }> {
    const inputHash = hash(input);
    let operation!: Operation;
    let duplicate = false;
    const loaded = await persist(input.id, (current) => {
      expirePreparation(current.workspace);
      const builder = state(current.workspace);
      const previous = builder.operations.find(
        (item) => item.requestId === input.requestId,
      );
      if (previous) {
        if (previous.hash !== inputHash || previous.kind !== kind)
          conflict("This request ID already refers to different input.");
        operation = previous;
        duplicate = true;
        return;
      }
      if (builder.operations.some(unsettled))
        fail(
          "A Builder operation is still pending or unconfirmed. Inspect this session before submitting another operation.",
          {
            errorCode: "design_system_builder_operation_pending",
            statusCode: 409,
          },
        );
      if (builder.operations.length >= 1000)
        fail("This workspace has reached its retained operation limit.", {
          errorCode: "design_system_builder_operation_limit",
          statusCode: 409,
        });
      if (kind === "start" && builder.sessionId)
        conflict("This workspace already has a canonical Builder session.");
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== builder.revision
      )
        conflict(
          "The Builder revision changed. Read the workspace before continuing.",
        );
      if (
        builder.sessionId &&
        builder.sourceIds.some(
          (id) =>
            !current.workspace.sources.some(
              (source) => source.id === id && !source.excluded,
            ),
        )
      )
        fail(
          "Builder cannot retract an already-ingested reference from this session. Restore its inclusion before continuing; no upload or new system was started.",
          {
            errorCode: "design_system_builder_source_retraction_unsupported",
            statusCode: 409,
          },
        );
      if (
        kind !== "start" &&
        (!builder.sessionId ||
          builder.status !== "ready" ||
          builder.workspaceStatus !== "idle")
      )
        fail("The Builder workspace is not ready for this operation.", {
          errorCode: "design_system_builder_not_ready",
          statusCode: 409,
        });
      if (
        kind === "publish" &&
        !canPublishBuilderDesignSystem(current.workspace)
      )
        fail(
          "Resolve source errors and generate actual artifacts before publishing.",
          { errorCode: "design_system_builder_not_ready", statusCode: 409 },
        );
      if (
        "targetId" in input &&
        input.targetId &&
        !current.workspace.artifacts.some(
          (artifact) => artifact.id === input.targetId,
        )
      )
        fail("Selected Builder artifact not found.", {
          errorCode: "design_system_target_not_found",
          statusCode: 404,
        });
      const now = new Date().toISOString();
      operation = {
        requestId: input.requestId,
        providerRequestId: `an-${hash([store.ownerApp, input.id, input.requestId])}`,
        hash: inputHash,
        kind,
        status: "preparing",
        error: null,
        createdAt: now,
        updatedAt: now,
        preparationLeaseUntil: Date.now() + 10 * 60_000,
        ...(kind === "publish"
          ? {
              publicationTarget: {
                expectedRevision: input.expectedRevision!,
                contentRevision: current.workspace.contentRevision,
              },
            }
          : {}),
        ...(kind !== "publish" &&
        builder.sourceHash !== sourceHash(current.workspace)
          ? {
              sourceBatch: {
                hash: sourceHash(current.workspace),
                sourceIds: current.workspace.sources
                  .filter((source) => !source.excluded)
                  .map((source) => source.id),
                addedSourceIds: batchSources(current.workspace)
                  .filter((source) => !source.excluded)
                  .map((source) => source.id),
                status: "preparing" as const,
                outcomes: [],
              },
            }
          : {}),
      };
      builder.operations.push(operation);
      current.workspace.run = {
        id: input.requestId,
        status: "queued",
        stage: kind === "start" ? "reading-sources" : "awaiting-input",
        error: null,
      };
    });
    return { loaded, operation, duplicate };
  }

  async function markError(
    id: string,
    requestId: string,
    status: "failed" | "unknown",
    issue: NonNullable<Operation["error"]>,
  ) {
    return persist(id, ({ workspace }) => {
      const operation = state(workspace).operations.find(
        (item) => item.requestId === requestId,
      )!;
      if (operation.status === "completed") return;
      if (status === "failed" && operation.status !== "preparing") return;
      operation.status = status;
      if (operation.sourceBatch)
        operation.sourceBatch.status =
          status === "unknown" ? "unknown" : "needs-attention";
      operation.error = issue;
      operation.updatedAt = new Date().toISOString();
      if (state(workspace).operations.at(-1)?.requestId === requestId)
        workspace.run = {
          id: requestId,
          status: "failed",
          stage: "needs-attention",
          error: issue,
        };
    });
  }

  async function beforeDispatch(
    id: string,
    requestId: string,
    mutate: (loaded: Loaded) => void,
  ) {
    try {
      return await persist(id, mutate);
    } catch (cause) {
      await markError(
        id,
        requestId,
        "failed",
        error(
          "design_system_builder_dispatch_precondition",
          "The workspace changed before dispatch. Read it again and submit a new request; no provider mutation was sent.",
        ),
      );
      throw cause;
    }
  }

  async function get(id: string): Promise<DesignSystemWorkspaceSnapshot> {
    await assertBuilderDsiAccess();
    for (let attempt = 0; ; attempt++) {
      const loaded = await load(id, false);
      const builder = state(loaded.workspace);
      let session: BuilderDsiSession;
      if (!builder.sessionId) {
        const start = builder.operations.findLast(
          (operation) =>
            operation.kind === "start" &&
            ["dispatched", "submitted", "unknown"].includes(operation.status),
        );
        if (!start) {
          if (loaded.canEdit)
            return snapshot(
              await persist(id, ({ workspace }) =>
                expirePreparation(workspace),
              ),
            );
          return snapshot(loaded);
        }
        try {
          session = await readBuilderDsiSessionByRequest(
            start.providerRequestId,
          );
        } catch (cause) {
          // Absence during recovery is not permission to repeat a mutation.
          if (
            isActionContractError(cause) &&
            cause.errorCode === "builder_dsi_not_found"
          )
            return snapshot(loaded);
          throw cause;
        }
      } else session = await getBuilderDsiSession(builder.sessionId);
      const latest = await store.read(id, false);
      if (latest.row.data !== loaded.row.data) {
        if (attempt >= 3)
          conflict(
            "The workspace changed while reading Builder. Read it again.",
          );
        continue;
      }
      loaded.canEdit = latest.canEdit;
      const before = JSON.stringify(loaded.workspace);
      if (!builder.sessionId) {
        const start = builder.operations.findLast(
          (operation) =>
            operation.kind === "start" &&
            ["dispatched", "submitted", "unknown"].includes(operation.status),
        )!;
        start.status = "submitted";
        start.error = null;
      }
      applySession(loaded.workspace, session);
      if (loaded.canEdit && before !== JSON.stringify(loaded.workspace)) {
        try {
          await persistence.save(loaded);
        } catch (cause) {
          if (
            !isActionContractError(cause) ||
            cause.errorCode !== "design_system_revision_conflict" ||
            attempt >= 3
          )
            throw cause;
          continue;
        }
      }
      return snapshot(loaded, session);
    }
  }

  async function runBuilder(
    raw: RunBuilderDesignSystemInput,
  ): Promise<DesignSystemWorkspaceSnapshot> {
    await assertBuilderDsiAccess();
    const input = runBuilderDesignSystemSchema.parse(raw);
    const initial = await load(input.id, true);
    const prior = state(initial.workspace).operations.find(
      (item) => item.requestId === input.requestId,
    );
    const kind =
      prior?.kind ?? (state(initial.workspace).sessionId ? "message" : "start");
    if (kind === "publish")
      conflict("This request ID already belongs to a publication.");
    const reservation = await reserve(input, kind);
    if (reservation.duplicate)
      return mutationSnapshot(reservation.loaded, input.requestId);
    const intent = reservation.loaded.workspace.sources.some(
      (source) => !source.excluded,
    )
      ? "references"
      : reservation.loaded.workspace.intent;
    let preparedSources:
      | Awaited<ReturnType<typeof prepareBuilderDesignSystemSources>>
      | undefined;
    if (reservation.operation.sourceBatch) {
      const sources = batchSources(reservation.loaded.workspace);
      try {
        preparedSources = await prepareBuilderDesignSystemSources({
          intent:
            kind === "start"
              ? intent
              : sources.some((source) => !source.excluded)
                ? "references"
                : "fresh",
          sources,
          readSourceEvidence: (sourceId) => {
            if (!store.readSourceEvidence)
              fail("Scoped source reading is not configured.", {
                errorCode: "design_system_source_reader_missing",
                statusCode: 503,
              });
            return store.readSourceEvidence(input.id, sourceId);
          },
        });
        await persist(input.id, ({ workspace }) => {
          const builder = state(workspace);
          if (
            builder.operations.find(
              (item) => item.requestId === input.requestId,
            )?.status !== "preparing"
          )
            conflict("The source preparation claim is no longer current.");
          const batch = builder.operations.find(
            (item) => item.requestId === input.requestId,
          )!.sourceBatch!;
          batch.outcomes = preparedSources!.outcomes;
          batch.status =
            preparedSources!.status === "ready"
              ? "uploaded"
              : "needs-attention";
          mergeSourceOutcomes(builder, preparedSources!.outcomes);
          for (const outcome of preparedSources!.outcomes) {
            const source = workspace.sources.find(
              (item) => item.id === outcome.sourceId,
            )!;
            if (outcome.error) {
              source.status = "needs-attention";
              source.error = outcome.error;
            } else if (
              outcome.status === "ready" &&
              source.error &&
              hash(source.error) ===
                hash(
                  reservation.loaded.workspace.sources.find(
                    (item) => item.id === source.id,
                  )?.error,
                )
            ) {
              source.error = null;
              source.status =
                source.evidence && source.provenance ? "ready" : "staged";
            }
          }
        });
      } catch (cause) {
        return mutationSnapshot(
          await markError(
            input.id,
            input.requestId,
            "failed",
            operationError(
              cause,
              "design_system_builder_sources_failed",
              "The source batch could not be prepared. No Builder generation was started.",
            ),
          ),
          input.requestId,
          undefined,
          isActionContractError(cause) ? cause.statusCode : 502,
        );
      }
      if (preparedSources.status !== "ready") {
        const issues = preparedSources.outcomes.flatMap((source) =>
          source.error ? [source.error] : [],
        );
        const codes = new Set(issues.map((issue) => issue.code));
        return mutationSnapshot(
          await markError(input.id, input.requestId, "failed", {
            code:
              codes.size === 1
                ? issues[0].code
                : "design_system_builder_sources_need_attention",
            message:
              "One or more references could not be uploaded. Resolve the retained source errors before starting Builder.",
            retryable: issues.some((issue) => issue.retryable),
          }),
          input.requestId,
        );
      }
    }
    const dispatched = await beforeDispatch(
      input.id,
      input.requestId,
      ({ workspace }) => {
        if (sourceHash(workspace) !== sourceHash(reservation.loaded.workspace))
          conflict("References changed while preparing the Builder request.");
        const builder = state(workspace);
        const operation = builder.operations.find(
          (item) => item.requestId === input.requestId,
        )!;
        if (operation.status !== "preparing")
          conflict("The Builder dispatch claim is no longer current.");
        if (
          input.expectedRevision !== undefined &&
          builder.revision !== input.expectedRevision
        )
          conflict("The Builder revision changed before dispatch.");
        operation.status = "dispatched";
        operation.updatedAt = new Date().toISOString();
        workspace.run = {
          id: input.requestId,
          status: "running",
          stage: "building-components",
          error: null,
        };
      },
    );
    const builder = state(dispatched.workspace);
    let session: BuilderDsiSession;
    let saved: Loaded;
    try {
      session =
        kind === "start"
          ? await startBuilderDsiSession({
              requestId: reservation.operation.providerRequestId,
              title: dispatched.row.title,
              intent,
              prompt: input.prompt,
              sources:
                preparedSources?.status === "ready"
                  ? preparedSources.sources.map((source) => ({
                      ...source,
                      uploadToken: source.uploadToken!,
                    }))
                  : [],
            })
          : await sendBuilderDsiMessage({
              sessionId: builder.sessionId!,
              requestId: reservation.operation.providerRequestId,
              prompt: input.prompt,
              expectedRevision: builder.revision,
              targetId: input.targetId
                ? dispatched.workspace.artifacts.find(
                    (item) => item.id === input.targetId,
                  )!.provider!.id
                : undefined,
              ...(preparedSources?.status === "ready" &&
              preparedSources.sources.length
                ? {
                    sources: preparedSources.sources.map((source) => ({
                      ...source,
                      uploadToken: source.uploadToken!,
                    })),
                  }
                : {}),
            });
      saved = await persist(input.id, ({ workspace }) => {
        const current = state(workspace);
        const operation = current.operations.find(
          (item) => item.requestId === input.requestId,
        )!;
        if (operation.status === "dispatched") operation.status = "submitted";
        applySession(
          workspace,
          session,
          !current.revision || current.revision === builder.revision,
        );
      });
    } catch (cause) {
      // A transport or receipt-persistence failure after dispatch cannot prove absence of a mutation.
      return mutationSnapshot(
        await markError(
          input.id,
          input.requestId,
          "unknown",
          operationError(
            cause,
            "design_system_builder_outcome_unknown",
            "Builder may have accepted this request. Inspect this session; do not resubmit it automatically.",
          ),
        ),
        input.requestId,
        undefined,
        isActionContractError(cause) ? cause.statusCode : 502,
      );
    }
    return mutationSnapshot(saved, input.requestId, session);
  }

  async function publishBuilder(
    raw: PublishBuilderDesignSystemInput,
  ): Promise<DesignSystemWorkspaceSnapshot> {
    await assertBuilderDsiAccess();
    const input = publishBuilderDesignSystemSchema.parse(raw);
    const reservation = await reserve(input, "publish");
    if (reservation.duplicate)
      return mutationSnapshot(reservation.loaded, input.requestId);
    const dispatched = await beforeDispatch(
      input.id,
      input.requestId,
      ({ workspace }) => {
        const builder = state(workspace);
        if (builder.revision !== input.expectedRevision)
          conflict("The Builder revision changed before publication.");
        const operation = builder.operations.find(
          (item) => item.requestId === input.requestId,
        )!;
        if (operation.status !== "preparing")
          conflict("The publication claim is no longer current.");
        if (
          operation.publicationTarget?.contentRevision !==
          workspace.contentRevision
        )
          conflict("The design-system content changed before publication.");
        operation.status = "dispatched";
      },
    );
    try {
      const receipt = await publishBuilderDsiSession({
        sessionId: state(dispatched.workspace).sessionId!,
        requestId: reservation.operation.providerRequestId,
        expectedRevision: input.expectedRevision,
      });
      const saved = await persist(input.id, ({ workspace }) => {
        const builder = state(workspace);
        if (
          receipt.sessionId !== builder.sessionId ||
          receipt.revision !== input.expectedRevision ||
          receipt.published < 1
        )
          fail("Invalid Builder publication receipt.", {
            errorCode: "builder_dsi_response_invalid",
            statusCode: 502,
          });
        builder.publication = {
          ...receipt,
          requestId: input.requestId,
          contentRevision:
            reservation.operation.publicationTarget!.contentRevision,
        };
        const operation = builder.operations.find(
          (item) => item.requestId === input.requestId,
        )!;
        operation.status = "completed";
        operation.error = null;
        workspace.run = {
          id: input.requestId,
          status: "completed",
          stage: canUseBuilderDesignSystem(workspace)
            ? "ready"
            : "awaiting-input",
          error: null,
        };
      });
      return snapshot(saved);
    } catch (cause) {
      return mutationSnapshot(
        await markError(
          input.id,
          input.requestId,
          "unknown",
          operationError(
            cause,
            "design_system_builder_publication_unknown",
            "Builder publication was not confirmed. Do not use this draft as a published system.",
          ),
        ),
        input.requestId,
        undefined,
        isActionContractError(cause) ? cause.statusCode : 502,
      );
    }
  }

  async function getArtifact(id: string, targetId: string, revision?: number) {
    await assertBuilderDsiAccess();
    const loaded = await load(id, false);
    const builder = state(loaded.workspace);
    const artifact = loaded.workspace.artifacts.find(
      (item) => item.id === targetId,
    );
    if (!artifact?.provider || !builder.sessionId)
      fail("Builder artifact not found.", {
        errorCode: "design_system_target_not_found",
        statusCode: 404,
      });
    const saved =
      revision === undefined || revision === artifact.revision
        ? artifact
        : artifact.history.find((item) => item.revision === revision);
    if (!saved?.contentHash)
      fail("Artifact revision is not retained.", {
        errorCode: "design_system_revision_not_found",
        statusCode: 404,
      });
    const body = await readBuilderDsiArtifact({
      sessionId: builder.sessionId,
      artifactId: artifact.provider.id,
      revision: saved.contentHash,
    });
    if (
      body.id !== artifact.provider.id ||
      body.hash !== saved.contentHash ||
      body.contentType !== saved.contentType
    )
      fail("Builder returned a different artifact revision.", {
        errorCode: "builder_dsi_response_invalid",
        statusCode: 502,
      });
    return {
      id,
      ownerApp: loaded.workspace.ownerApp,
      workspaceRevision: loaded.workspace.revision,
      artifact: { ...artifact, ...saved, history: artifact.history },
      html: body.contentType === "text/html" ? body.body : null,
      text: body.contentType !== "text/html" ? body.body : null,
    };
  }

  return { get, runBuilder, publishBuilder, getArtifact };
}
