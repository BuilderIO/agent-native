import { createHash, randomUUID } from "node:crypto";

import { parseHTML } from "linkedom";
export {
  storeDesignSystemSourceUpload,
  readDesignSystemSourceFile,
  readDesignSystemSourceUploadBytes,
  DESIGN_SYSTEM_SOURCE_MAX_BYTES,
} from "./design-system-source-files.js";
export {
  readDesignSystemSource,
  readFigmaDesignSystemEvidence,
} from "./design-system-source-reader.js";
export {
  readOwnerDesignSystem,
  readOwnerDesignSystemArtifact,
} from "./design-system-owner-read.js";
export { resolveDesignSystemGenerationSelection } from "./design-system-generation-selection.js";

import { fail } from "../action.js";
import { putPrivateBlob, readPrivateBlob } from "../private-blob/index.js";
import {
  designSystemWorkspaceSchema,
  startDesignSystemAuthoringSchema,
  updateDesignSystemWorkspaceSchema,
  writeDesignSystemArtifactSchema,
  type DesignSystemArtifact,
  type DesignSystemSourceInput,
  type DesignSystemWorkspace,
  type DesignSystemWorkspaceSnapshot,
  type StartDesignSystemAuthoringInput,
  type UpdateDesignSystemWorkspaceInput,
  type WriteDesignSystemArtifactInput,
  type DesignSystemArtifactWriteResult,
} from "../shared/design-system-authoring.js";
import {
  designSystemReadinessGaps,
  projectDesignSystemFoundation,
  legacyDesignSystemFoundations,
} from "../shared/design-system-projection.js";
import { assertBuilderDsiAccess } from "./builder-dsi-access.js";
import { createBuilderDesignSystemAuthoringService } from "./design-system-builder-authoring.js";
import type { PrepareBuilderDesignSystemSourcesOptions } from "./design-system-builder-sources.js";
import {
  readDesignSystemNativeThreadState,
  type DesignSystemNativeThreadState,
} from "./design-system-native-run.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export interface AuthoringSystemRow {
  id: string;
  title: string;
  data: string;
}

export interface DesignSystemAuthoringStore {
  ownerApp: "design" | "slides";
  /** Applies only to new workspaces; legacy workspaces retain their runtime. */
  runtime?: "native" | "builder";
  readSourceEvidence?: (
    id: string,
    sourceId: string,
  ) => ReturnType<
    PrepareBuilderDesignSystemSourcesOptions["readSourceEvidence"]
  >;
  read: (
    id: string,
    write: boolean,
  ) => Promise<{ row: AuthoringSystemRow; canEdit: boolean }>;
  insert: (
    row: AuthoringSystemRow & {
      ownerEmail: string;
      orgId: string | null;
      visibility: "org" | "private";
      isDefault: false;
      createdAt: string;
      updatedAt: string;
    },
  ) => Promise<void>;
  compareAndSwap: (
    row: AuthoringSystemRow,
    data: string,
    updatedAt: string,
  ) => Promise<boolean>;
  nativeThreadState?: (
    workspace: DesignSystemWorkspace,
    options?: { runId: string },
  ) => Promise<DesignSystemNativeThreadState>;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function conflict(message: string): never {
  return fail(message, {
    errorCode: "design_system_revision_conflict",
    statusCode: 409,
  });
}

export function parseDesignSystemAuthoringData(data: string): {
  data: Record<string, unknown>;
  workspace: DesignSystemWorkspace | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return fail("Stored design system data is unreadable.", {
      errorCode: "design_system_corrupt",
      statusCode: 422,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("Stored design system data must be an object.", {
      errorCode: "design_system_corrupt",
      statusCode: 422,
    });
  }
  const record = parsed as Record<string, unknown>;
  if (record.authoring === undefined) return { data: record, workspace: null };
  const result = designSystemWorkspaceSchema.safeParse(record.authoring);
  if (!result.success)
    return fail("Stored authoring workspace is unreadable.", {
      errorCode: "design_system_corrupt",
      statusCode: 422,
    });
  return { data: record, workspace: result.data };
}

function requireWorkspace(data: string): {
  data: Record<string, unknown>;
  workspace: DesignSystemWorkspace;
} {
  const parsed = parseDesignSystemAuthoringData(data);
  if (!parsed.workspace)
    return fail(
      "This legacy system has no authoring workspace. Open it with resume-design-system-authoring first.",
      { errorCode: "design_system_workspace_missing", statusCode: 409 },
    );
  return { data: parsed.data, workspace: parsed.workspace };
}

export function designSystemGenerationData(
  raw: string,
): Record<string, unknown> {
  const { data, workspace } = parseDesignSystemAuthoringData(raw);
  return (workspace?.artifacts ?? []).reduce(
    (projected, artifact) =>
      artifact.kind === "foundation"
        ? projectDesignSystemFoundation(projected, artifact)
        : projected,
    data,
  );
}

function writeResult(
  snapshot: DesignSystemWorkspaceSnapshot,
  input: WriteDesignSystemArtifactInput,
): DesignSystemArtifactWriteResult {
  return {
    ...snapshot,
    receipt: {
      persisted: true,
      operationId: input.operationId,
      targetId: input.targetId,
      revision: input.expectedRevision + 1,
      kind: input.kind,
      tokenCount: Object.keys(input.values ?? {}).length,
      contentHash:
        input.html || input.text ? digest(input.html ?? input.text!) : null,
    },
  };
}

function addSources(
  workspace: DesignSystemWorkspace,
  sources: DesignSystemSourceInput[],
  now: string,
): void {
  for (const source of sources) {
    const previous = workspace.sources.find((item) => item.id === source.id);
    if (previous) {
      const {
        status: _status,
        error: _error,
        evidence: _evidence,
        provenance: _provenance,
        updatedAt: _updatedAt,
        excluded: _excluded,
        ...input
      } = previous;
      if (canonical(input) !== canonical(source))
        conflict(
          `Source ${source.id} already refers to different input. Use a new source ID.`,
        );
      continue;
    }
    workspace.sources.push({
      ...source,
      excluded: false,
      status: "staged",
      error: null,
      evidence: null,
      provenance: null,
      updatedAt: now,
    });
  }
  if (workspace.sources.length > 50)
    fail("A system can hold up to 50 sources.", {
      errorCode: "design_system_source_limit",
    });
}

function initialWorkspace(
  store: DesignSystemAuthoringStore,
  id: string,
  input: StartDesignSystemAuthoringInput,
  now: string,
): DesignSystemWorkspace {
  const workspace: DesignSystemWorkspace = {
    schemaVersion: 1,
    ...(store.runtime === "builder"
      ? {
          runtime: "builder" as const,
          builder: {
            sourceIds: [],
            sourceOutcomes: [],
            operations: [],
            publication: null,
          },
        }
      : {}),
    ownerApp: store.ownerApp,
    systemId: id,
    revision: 0,
    contentRevision: 0,
    conversationId: `design-system-${id}`,
    conversationScope: `design-system:${id}`,
    intent: input.intent,
    sources: [],
    artifacts: [],
    run: null,
    kickoff: {
      status: "pending",
      requestId: `kickoff-${id}`,
      claimId: null,
      leaseUntil: null,
      error: null,
    },
    selectedTargetId: null,
    originDraft: input.originDraft ?? null,
    updatedAt: now,
    creationHash: digest(canonical(input)),
    operations: [],
  };
  addSources(workspace, input.sources, now);
  return workspace;
}

function snapshot(
  row: AuthoringSystemRow,
  workspace: DesignSystemWorkspace | null,
  canEdit: boolean,
): DesignSystemWorkspaceSnapshot {
  return { id: row.id, title: row.title, canEdit, workspace };
}

function checkOperation(
  workspace: DesignSystemWorkspace,
  id: string,
  input: unknown,
): boolean {
  const previous = workspace.operations.find(
    (operation) => operation.id === id,
  );
  if (!previous) return false;
  if (previous.hash !== digest(canonical(input)))
    conflict("This operation ID was already used with different input.");
  return true;
}

async function save(
  store: DesignSystemAuthoringStore,
  row: AuthoringSystemRow,
  data: Record<string, unknown>,
  workspace: DesignSystemWorkspace,
  operationId: string,
  input: unknown,
): Promise<DesignSystemWorkspaceSnapshot> {
  workspace.revision += 1;
  workspace.updatedAt = new Date().toISOString();
  workspace.operations = [
    ...workspace.operations,
    { id: operationId, hash: digest(canonical(input)) },
  ].slice(-100);
  designSystemWorkspaceSchema.parse(workspace);
  const next = JSON.stringify({ ...data, authoring: workspace });
  if (!(await store.compareAndSwap(row, next, workspace.updatedAt)))
    conflict(
      "The system changed during this operation. Read the workspace and retry against the current revision.",
    );
  return snapshot(row, workspace, true);
}

function nativeRunProjection(
  workspace: DesignSystemWorkspace,
  run: NonNullable<DesignSystemNativeThreadState["run"]>,
): NonNullable<DesignSystemWorkspace["run"]> {
  if (["completed", "done"].includes(run.status)) {
    const usable =
      designSystemReadinessGaps(workspace.artifacts).length === 0 &&
      workspace.sources.every(
        (source) =>
          source.excluded || (source.status === "ready" && !source.error),
      );
    return {
      id: run.runId,
      status: "completed",
      stage: usable ? "ready" : "awaiting-input",
      error: null,
    };
  }
  const cancelled = ["cancelled", "canceled", "aborted"].includes(run.status);
  if (
    cancelled ||
    ["error", "errored", "truncated", "failed"].includes(run.status)
  )
    return {
      id: run.runId,
      status: cancelled ? "cancelled" : "failed",
      stage: "needs-attention",
      error: {
        code: "design_system_run_stopped",
        message: run.terminalReason ?? "The native authoring run stopped.",
        retryable: true,
      },
    };
  return {
    id: run.runId,
    status: "running",
    stage:
      workspace.run?.id === run.runId && workspace.run.status === "running"
        ? workspace.run.stage
        : workspace.sources.some(
              (source) => !source.excluded && source.status !== "ready",
            )
          ? "reading-sources"
          : "drafting-foundations",
    error: null,
  };
}

export function createDesignSystemAuthoringService(
  store: DesignSystemAuthoringStore,
) {
  const nativeState =
    store.nativeThreadState ?? readDesignSystemNativeThreadState;
  const builder = createBuilderDesignSystemAuthoringService(store, {
    parse: requireWorkspace,
    save: ({ row, data, workspace }) =>
      save(store, row, data, workspace, randomUUID(), { builder: true }),
  });
  function requireNative(workspace: DesignSystemWorkspace) {
    if (workspace.runtime === "builder")
      fail(
        "This workspace is authored in Builder. Use its same-session run or publication action, not the local writer or native run lifecycle.",
        {
          errorCode: "design_system_builder_runtime_only",
          statusCode: 409,
        },
      );
  }
  function requireNativeUploads(sources: DesignSystemSourceInput[]) {
    if (
      sources.some(
        (source) =>
          source.kind === "file" && source.handle.kind === "builder-upload",
      )
    )
      fail(
        "Re-upload reference files through the private source uploader. Signed Builder upload tokens cannot be persisted in an authoring workspace.",
        {
          errorCode: "design_system_builder_upload_unverifiable",
          statusCode: 409,
        },
      );
  }
  return {
    runBuilder: builder.runBuilder,
    publishBuilder: builder.publishBuilder,
    async start(
      raw: StartDesignSystemAuthoringInput,
    ): Promise<DesignSystemWorkspaceSnapshot> {
      const input = startDesignSystemAuthoringSchema.parse(raw);
      if (store.runtime === "builder") {
        await assertBuilderDsiAccess();
        requireNativeUploads(input.sources);
      }
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail)
        return fail("Sign in to create a design system.", {
          errorCode: "unauthorized",
          statusCode: 401,
        });
      if (input.intent === "references" && input.sources.length === 0)
        return fail("Add at least one reference.", {
          errorCode: "design_system_sources_required",
        });
      const orgId = getRequestOrgId() ?? null;
      const id = `ds-${digest(canonical([store.ownerApp, ownerEmail.toLowerCase(), orgId, input.requestId])).slice(0, 32)}`;
      const now = new Date().toISOString();
      const workspace = initialWorkspace(store, id, input, now);
      await store.insert({
        id,
        title: input.title,
        data: JSON.stringify({ authoring: workspace }),
        ownerEmail,
        orgId,
        visibility: orgId ? "org" : "private",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      const existing = await store.read(id, true);
      const saved = requireWorkspace(existing.row.data).workspace;
      if (saved.runtime === "builder") await assertBuilderDsiAccess();
      if (saved.creationHash !== workspace.creationHash)
        conflict(
          "This creation request ID was already used for different input.",
        );
      return snapshot(existing.row, saved, existing.canEdit);
    },

    async get(id: string): Promise<DesignSystemWorkspaceSnapshot> {
      const { row, canEdit } = await store.read(id, false);
      const { data, workspace } = parseDesignSystemAuthoringData(row.data);
      if (workspace?.runtime === "builder") return builder.get(id);
      if (workspace && canEdit) {
        const { run } = await nativeState(workspace);
        const projected = run ? nativeRunProjection(workspace, run) : null;
        if (
          run &&
          projected &&
          canonical(workspace.run) !== canonical(projected)
        ) {
          workspace.run = projected;
          return save(
            store,
            row,
            data,
            workspace,
            `reconcile-${run.runId}-${run.status}`,
            { runId: run.runId, status: run.status },
          );
        }
      }
      return snapshot(row, workspace, canEdit);
    },

    async bindRun(input: {
      id: string;
      runId: string;
    }): Promise<DesignSystemWorkspaceSnapshot> {
      const { row } = await store.read(input.id, true);
      const { data, workspace } = requireWorkspace(row.data);
      requireNative(workspace);
      const state = await nativeState(workspace, { runId: input.runId });
      if (!state.exists || state.run?.runId !== input.runId)
        return fail(
          "The run is not persisted in this system's native conversation.",
          { errorCode: "design_system_run_not_found", statusCode: 409 },
        );
      const run = nativeRunProjection(workspace, state.run);
      if (canonical(workspace.run) === canonical(run))
        return snapshot(row, workspace, true);
      workspace.run = run;
      return save(store, row, data, workspace, randomUUID(), {
        bindRun: input.runId,
        status: run.status,
      });
    },

    async claimKickoff(id: string) {
      const { row } = await store.read(id, true);
      const { data, workspace } = requireWorkspace(row.data);
      if (workspace.runtime === "builder") await assertBuilderDsiAccess();
      const state = await nativeState(workspace);
      const kickoff = workspace.kickoff ?? {
        status: "pending" as const,
        requestId: `kickoff-${id}`,
        claimId: null,
        leaseUntil: null,
        error: null,
      };
      const result = {
        conversationId: workspace.conversationId,
        requestId: kickoff.requestId,
        knownNewThread: !state.exists,
      };
      if (state.kickoffReceived) {
        if (kickoff.status !== "delivered") {
          workspace.kickoff = {
            ...kickoff,
            status: "delivered",
            leaseUntil: null,
            error: null,
          };
          await save(store, row, data, workspace, randomUUID(), {
            kickoff: "reconciled",
          });
        }
        return { ...result, shouldDispatch: false, claimId: kickoff.claimId };
      }
      if (
        kickoff.status === "delivered" ||
        (kickoff.status === "claimed" && (kickoff.leaseUntil ?? 0) > Date.now())
      )
        return { ...result, shouldDispatch: false, claimId: null };
      const claimId = randomUUID();
      workspace.kickoff = {
        ...kickoff,
        status: "claimed",
        claimId,
        leaseUntil: Date.now() + 60000,
        error: null,
      };
      await save(store, row, data, workspace, claimId, { kickoff: "claimed" });
      return { ...result, shouldDispatch: true, claimId };
    },

    async completeKickoff(input: {
      id: string;
      claimId: string;
      status: "delivered" | "failed";
      error?: string;
    }) {
      const { row } = await store.read(input.id, true);
      const { data, workspace } = requireWorkspace(row.data);
      if (workspace.runtime === "builder") await assertBuilderDsiAccess();
      const kickoff = workspace.kickoff;
      if (!kickoff || kickoff.claimId !== input.claimId)
        conflict("This kickoff claim is no longer current.");
      if (kickoff.status === "delivered") return snapshot(row, workspace, true);
      if (input.status === "failed" && !input.error?.trim())
        return fail("A failed dispatch requires an error.", {
          errorCode: "design_system_kickoff_error_required",
        });
      const state = await nativeState(workspace);
      workspace.kickoff = state.kickoffReceived
        ? { ...kickoff, status: "delivered", leaseUntil: null, error: null }
        : input.status === "delivered"
          ? {
              ...kickoff,
              status: "claimed",
              leaseUntil: Date.now() + 60000,
              error: null,
            }
          : {
              ...kickoff,
              status: "failed",
              leaseUntil: null,
              error: input.error!,
            };
      return save(store, row, data, workspace, `ack-${input.claimId}`, input);
    },

    async resume(id: string): Promise<DesignSystemWorkspaceSnapshot> {
      const { row, canEdit } = await store.read(id, true);
      const parsed = parseDesignSystemAuthoringData(row.data);
      if (parsed.workspace) {
        if (parsed.workspace.runtime === "builder") return builder.get(id);
        return snapshot(row, parsed.workspace, canEdit);
      }
      const now = new Date().toISOString();
      const workspace = initialWorkspace(
        { ...store, runtime: "native" },
        id,
        {
          requestId: `resume-${id}`,
          title: row.title,
          intent: "fresh",
          sources: [],
        },
        now,
      );
      workspace.artifacts = legacyDesignSystemFoundations(parsed.data, now);
      return save(store, row, parsed.data, workspace, `resume-${id}`, { id });
    },

    async update(
      raw: UpdateDesignSystemWorkspaceInput,
    ): Promise<DesignSystemWorkspaceSnapshot> {
      const input = updateDesignSystemWorkspaceSchema.parse(raw);
      const { row } = await store.read(input.id, true);
      const { data, workspace } = requireWorkspace(row.data);
      if (workspace.runtime === "builder") {
        await assertBuilderDsiAccess();
        requireNativeUploads(input.sources ?? []);
        if (input.run) requireNative(workspace);
        const ingestedExclusion = input.sourceExclusions?.find(
          (source) =>
            source.excluded && workspace.builder?.sourceIds.includes(source.id),
        );
        if (ingestedExclusion)
          fail(
            "This reference was already shared with the Builder session and cannot be removed from it.",
            {
              errorCode: "design_system_builder_source_retraction_unsupported",
              statusCode: 409,
              details: { id: input.id, sourceId: ingestedExclusion.id },
            },
          );
        if (
          (input.sources?.length || input.sourceExclusions?.length) &&
          workspace.builder?.operations.some(
            (operation) => !["completed", "failed"].includes(operation.status),
          )
        )
          fail(
            "Wait for the current Builder operation before changing references.",
            {
              errorCode: "design_system_builder_operation_pending",
              statusCode: 409,
            },
          );
      }
      if (checkOperation(workspace, input.operationId, input))
        return snapshot(row, workspace, true);
      if (input.expectedRevision !== workspace.revision)
        conflict(
          "The workspace changed. Read its current revision before updating sources or progress.",
        );
      const now = new Date().toISOString();
      let contentChanged = false;
      if (input.sources) {
        const previousSourceCount = workspace.sources.length;
        addSources(workspace, input.sources, now);
        if (workspace.sources.length > previousSourceCount) {
          contentChanged = true;
          workspace.kickoff = {
            status: "pending",
            requestId: `sources-${digest(canonical([input.id, input.operationId])).slice(0, 32)}`,
            claimId: null,
            leaseUntil: null,
            error: null,
          };
        }
      }
      for (const update of input.sourceUpdates ?? []) {
        const source = workspace.sources.find((item) => item.id === update.id);
        if (!source)
          return fail("Source not found in this system.", {
            errorCode: "design_system_source_not_found",
            statusCode: 404,
          });
        if (
          update.status === "ready" &&
          (!update.evidence?.trim() || !update.provenance || update.error)
        )
          return fail(
            "A ready source requires actual evidence, provenance, and no error.",
            { errorCode: "design_system_source_evidence_required" },
          );
        if (
          ["failed", "needs-attention"].includes(update.status) &&
          !update.error
        )
          return fail("A source failure requires an explicit error.", {
            errorCode: "design_system_source_error_required",
          });
        if (
          source.evidence !== update.evidence ||
          source.provenance !== update.provenance
        )
          contentChanged = true;
        Object.assign(source, update, { updatedAt: now });
      }
      for (const exclusion of input.sourceExclusions ?? []) {
        const source = workspace.sources.find(
          (item) => item.id === exclusion.id,
        );
        if (!source)
          return fail("Source not found in this system.", {
            errorCode: "design_system_source_not_found",
            statusCode: 404,
          });
        if (source.excluded !== exclusion.excluded) contentChanged = true;
        source.excluded = exclusion.excluded;
        source.updatedAt = now;
      }
      if (input.selectedTargetId !== undefined) {
        if (
          input.selectedTargetId !== null &&
          !workspace.artifacts.some(
            (artifact) => artifact.id === input.selectedTargetId,
          )
        )
          return fail("Selected artifact not found.", {
            errorCode: "design_system_target_not_found",
            statusCode: 404,
          });
        workspace.selectedTargetId = input.selectedTargetId;
      }
      if (input.originDraft) workspace.originDraft = input.originDraft;
      if (input.run) {
        const actual = await nativeState(workspace, { runId: input.run.id });
        if (!actual.exists || actual.run?.runId !== input.run.id)
          return fail(
            "This run is not persisted in the system's native conversation. Use the actual native run ID after dispatch.",
            { errorCode: "design_system_run_not_found", statusCode: 409 },
          );
        if (input.run.status === "failed" && !input.run.error)
          return fail("A failed run requires an explicit error.", {
            errorCode: "design_system_run_error_required",
          });
        if (input.run.status === "completed") {
          if (!["completed", "done"].includes(actual.run.status))
            return fail("The native turn has not completed.", {
              errorCode: "design_system_run_in_progress",
              statusCode: 409,
            });
        }
        if (
          input.run.status === "completed" &&
          input.run.stage !== "awaiting-input"
        ) {
          const missing = designSystemReadinessGaps(workspace.artifacts);
          if (
            missing.length ||
            workspace.sources.some(
              (source) => !source.excluded && source.status !== "ready",
            ) ||
            input.run.error ||
            input.run.stage !== "ready"
          )
            return fail(
              `The system is incomplete. Missing artifacts/tokens: ${missing.join(", ") || "none"}. Resolve all source errors and finish actual work before completing the run.`,
              { errorCode: "design_system_incomplete" },
            );
        }
        workspace.run = input.run;
      }
      if (contentChanged) workspace.contentRevision += 1;
      return save(store, row, data, workspace, input.operationId, input);
    },

    async write(
      raw: WriteDesignSystemArtifactInput,
    ): Promise<DesignSystemArtifactWriteResult> {
      const input = writeDesignSystemArtifactSchema.parse(raw);
      const { row } = await store.read(input.id, true);
      const { data, workspace } = requireWorkspace(row.data);
      requireNative(workspace);
      if (checkOperation(workspace, input.operationId, input))
        return writeResult(snapshot(row, workspace, true), input);
      const previous = workspace.artifacts.find(
        (artifact) => artifact.id === input.targetId,
      );
      if (input.expectedRevision !== (previous?.revision ?? 0))
        conflict(
          "The selected artifact changed. Read it and use its current revision before editing.",
        );
      if (previous && previous.kind !== input.kind)
        conflict("An existing target cannot change its artifact kind.");
      if (
        input.sourceIds.some(
          (id) =>
            !workspace.sources.some(
              (source) =>
                source.id === id &&
                !source.excluded &&
                source.status === "ready",
            ),
        )
      )
        return fail(
          "Read each active referenced source successfully before deriving an artifact from it.",
          { errorCode: "design_system_source_not_ready" },
        );
      if (input.provenance === "extracted" && !input.sourceIds.length)
        return fail("Extracted content must name its source evidence.", {
          errorCode: "design_system_source_evidence_required",
        });
      if (
        input.html &&
        (!/<html[\s>]/i.test(input.html) || !/<body[\s>]/i.test(input.html))
      )
        return fail(
          "Component HTML must be a complete standalone HTML document with a body.",
          { errorCode: "design_system_html_incomplete" },
        );
      if (input.html) {
        const { document } = parseHTML(input.html);
        const body = document.body.cloneNode(true) as HTMLElement;
        body
          .querySelectorAll("script,style,link,meta,template")
          .forEach((node) => node.remove());
        if (
          !body.textContent?.trim() &&
          !body.querySelector(
            "img,svg,input,textarea,select,button,canvas,video",
          )
        )
          return fail("Component HTML has no usable rendered content.", {
            errorCode: "design_system_html_empty",
          });
      }
      const body = input.html ?? input.text;
      const contentType = input.html
        ? "text/html"
        : input.text
          ? "text/markdown"
          : null;
      const contentHash = body ? digest(body) : null;
      const content = body
        ? await putPrivateBlob({
            data: Buffer.from(body),
            mimeType: contentType!,
            filename: `${digest(input.targetId).slice(0, 16)}.${input.html ? "html" : "md"}`,
            ownerEmail: getRequestUserEmail(),
            metadata: {
              systemId: input.id,
              targetId: input.targetId,
              revision: (previous?.revision ?? 0) + 1,
            },
          })
        : null;
      if (body && !content)
        return fail(
          "Private file storage is not configured. Configure file storage before saving component or usage artifacts.",
          { errorCode: "design_system_storage_unavailable", statusCode: 503 },
        );
      const artifact: DesignSystemArtifact = {
        id: input.targetId,
        kind: input.kind,
        name: input.name,
        revision: (previous?.revision ?? 0) + 1,
        provenance: input.provenance,
        sourceIds: input.sourceIds,
        values: input.values
          ? { ...previous?.values, ...input.values }
          : undefined,
        content,
        contentType,
        contentHash,
        updatedAt: new Date().toISOString(),
        history: previous
          ? [
              ...previous.history,
              {
                name: previous.name,
                provenance: previous.provenance,
                sourceIds: previous.sourceIds,
                revision: previous.revision,
                content: previous.content,
                contentType: previous.contentType,
                contentHash: previous.contentHash,
                values: previous.values,
                updatedAt: previous.updatedAt,
              },
            ].slice(-20)
          : [],
      };
      workspace.artifacts = [
        ...workspace.artifacts.filter((item) => item.id !== artifact.id),
        artifact,
      ];
      workspace.contentRevision += 1;
      const projected =
        artifact.kind === "foundation"
          ? projectDesignSystemFoundation(data, artifact)
          : data;
      return writeResult(
        await save(store, row, projected, workspace, input.operationId, input),
        input,
      );
    },

    async getArtifact(id: string, targetId: string, revision?: number) {
      const { row } = await store.read(id, false);
      const { workspace } = requireWorkspace(row.data);
      if (workspace.runtime === "builder")
        return builder.getArtifact(id, targetId, revision);
      const artifact = workspace.artifacts.find((item) => item.id === targetId);
      if (!artifact)
        return fail("Artifact not found.", {
          errorCode: "design_system_target_not_found",
          statusCode: 404,
        });
      const saved =
        revision === undefined || artifact.revision === revision
          ? artifact
          : artifact.history.find((item) => item.revision === revision);
      if (!saved)
        return fail("Artifact revision is not retained.", {
          errorCode: "design_system_revision_not_found",
          statusCode: 404,
        });
      const body = saved.content
        ? new TextDecoder().decode((await readPrivateBlob(saved.content)).data)
        : null;
      if (body !== null && digest(body) !== saved.contentHash)
        return fail("Artifact content failed its integrity check.", {
          errorCode: "design_system_content_corrupt",
          statusCode: 422,
        });
      return {
        id,
        ownerApp: workspace.ownerApp,
        workspaceRevision: workspace.revision,
        artifact: { ...artifact, ...saved, history: artifact.history },
        html: saved.contentType === "text/html" ? body : null,
        text: saved.contentType === "text/markdown" ? body : null,
      };
    },
  };
}

export function authoredDesignSystemAgentContext(
  workspace: DesignSystemWorkspace,
): string {
  if (workspace.runtime === "builder") {
    const lines = [
      `Builder-backed design system ${workspace.ownerApp}:${workspace.systemId}, consumed revision ${workspace.contentRevision}.`,
      "Builder stores the canonical files. Metadata is not token or component content. Read the actual provider artifact bodies with get-design-system-artifact before generating from this system; do not invent values or use the local artifact writer.",
      `Builder revision: ${workspace.builder?.revision ?? "not-started"}; publication revision: ${workspace.builder?.publication?.revision ?? "unpublished"}.`,
    ];
    const inventory = (remaining: number) =>
      `${remaining} additional files not listed. Read get-design-system-workspace ${JSON.stringify({ id: workspace.systemId, ownerApp: workspace.ownerApp })} for the full inventory; metadata is not content.`;
    const ordered = [...workspace.artifacts].sort(
      (a, b) => Number(a.kind === "component") - Number(b.kind === "component"),
    );
    const footerBudget = inventory(workspace.artifacts.length).length + 1;
    let length = lines.join("\n").length;
    let shown = 0;
    for (const artifact of ordered.slice(0, 30)) {
      const line = `${JSON.stringify(artifact.name)} [${artifact.id}@${artifact.revision}; ${artifact.provider?.kind ?? artifact.kind}]: read get-design-system-artifact ${JSON.stringify({ id: workspace.systemId, ownerApp: workspace.ownerApp, targetId: artifact.id, revision: artifact.revision })} for the actual file.`;
      if (length + line.length + 1 + footerBudget > 10_000) break;
      lines.push(line);
      length += line.length + 1;
      shown++;
    }
    if (shown < workspace.artifacts.length)
      lines.push(inventory(workspace.artifacts.length - shown));
    return lines.join("\n");
  }
  const lines = [
    `Native design system ${workspace.ownerApp}:${workspace.systemId}, consumed revision ${workspace.contentRevision}.`,
    `Run status: ${workspace.run?.status ?? "not-started"}. Preserve authored artifacts over earlier source extraction.`,
    ...workspace.artifacts.map((artifact) =>
      artifact.kind === "foundation"
        ? `${artifact.name} [${artifact.id}@${artifact.revision}; ${artifact.provenance}]: ${JSON.stringify(artifact.values)}`
        : `${artifact.name} [${artifact.id}@${artifact.revision}; ${artifact.provenance}]: read get-design-system-artifact {id:"${workspace.systemId}",ownerApp:"${workspace.ownerApp}",targetId:"${artifact.id}",revision:${artifact.revision}} for the actual ${artifact.kind === "component" ? "HTML to follow" : "usage guidance"}.`,
    ),
    ...workspace.sources
      .filter((source) => source.excluded || source.status !== "ready")
      .map(
        (source) =>
          `Source ${source.id}: ${source.excluded ? "excluded by user" : source.status}${source.error ? ` — ${source.error.message}` : ""}`,
      ),
  ];
  return lines.join("\n");
}
