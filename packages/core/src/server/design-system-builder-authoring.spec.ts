import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  get: vi.fn(),
  getByRequest: vi.fn(),
  message: vi.fn(),
  publish: vi.fn(),
  artifact: vi.fn(),
  native: vi.fn(),
}));
vi.mock("./builder-dsi-access.js", () => ({
  assertBuilderDsiAccess: mocks.access,
}));
vi.mock("./design-system-builder-sources.js", () => ({
  prepareBuilderDesignSystemSources: mocks.prepare,
}));
vi.mock("./builder-dsi-authoring.js", () => ({
  startBuilderDsiSession: mocks.start,
  getBuilderDsiSession: mocks.get,
  readBuilderDsiSessionByRequest: mocks.getByRequest,
  sendBuilderDsiMessage: mocks.message,
  publishBuilderDsiSession: mocks.publish,
  readBuilderDsiArtifact: mocks.artifact,
}));

import { ActionContractError } from "../action.js";
import type { BuilderDsiSession } from "../shared/builder-dsi-authoring.js";
import { designSystemWorkspaceSchema } from "../shared/design-system-authoring.js";
import {
  authoredDesignSystemAgentContext,
  createDesignSystemAuthoringService,
  type AuthoringSystemRow,
  type DesignSystemAuthoringStore,
} from "./design-system-authoring.js";
import { runWithRequestContext } from "./request-context.js";

describe("Builder runtime authoring with durable CAS receipts", () => {
  let rows: Map<string, AuthoringSystemRow>;
  let service: ReturnType<typeof createDesignSystemAuthoringService>;
  let store: DesignSystemAuthoringStore;
  let remote: BuilderDsiSession;
  let canEdit: boolean;
  let failWrites: number;
  const asOwner = <T>(fn: () => T) =>
    runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "example-org" },
      fn,
    );
  const stored = (id: string) =>
    designSystemWorkspaceSchema.parse(JSON.parse(rows.get(id)!.data).authoring);
  const create = (
    sources: Array<{ id: string; kind: "website"; url: string }> = [],
  ) =>
    service.start({
      requestId: "create",
      title: "Example system",
      intent: sources.length ? "references" : "fresh",
      sources,
    });
  const run = (
    id: string,
    requestId = "first",
    prompt = "Create the requested system",
  ) => service.runBuilder({ id, requestId, prompt });

  beforeEach(() => {
    vi.resetAllMocks();
    rows = new Map();
    canEdit = true;
    failWrites = 0;
    mocks.access.mockResolvedValue(undefined);
    mocks.native.mockRejectedValue(
      new Error("Builder must not use a native thread"),
    );
    remote = {
      sessionId: "control-session",
      designSystemId: "canonical-dsi",
      projectId: "canonical-project",
      branchName: "canonical-branch",
      status: "ready",
      workspace: {
        sessionId: "codegen-session",
        revision: "provider-rev-1",
        status: "idle",
        artifacts: [
          {
            id: "src/theme.css",
            name: "Theme",
            kind: "css",
            hash: "css-hash-1",
          },
          {
            id: "components/actual.html",
            name: "Actual component",
            kind: "html",
            hash: "html-hash-1",
          },
          {
            id: "guidance.md",
            name: "Usage",
            kind: "markdown",
            hash: "md-hash-1",
          },
          {
            id: "tokens.json",
            name: "Tokens",
            kind: "json",
            hash: "json-hash-1",
          },
        ],
        messages: [
          {
            id: "message-1",
            role: "assistant",
            text: "Actual provider message not to persist in SQL",
          },
        ],
      },
    };
    mocks.prepare.mockImplementation(async ({ sources }) => ({
      status: "ready",
      sources: sources.map(() => ({
        kind: "file",
        uploadToken: "<EXAMPLE_UPLOAD_SECRET>",
      })),
      outcomes: sources.map((source: { id: string }) => ({
        sourceId: source.id,
        status: "ready",
        excluded: false,
        representation: "extracted-text",
        warnings: ["Bounded extraction"],
        error: null,
        upload: { name: "evidence.txt", mimeType: "text/plain", size: 32 },
      })),
    }));
    mocks.start.mockImplementation(async ({ requestId }) => {
      remote.latestTurn = { requestId, status: "completed" };
      return structuredClone(remote);
    });
    mocks.get.mockImplementation(async () => structuredClone(remote));
    mocks.getByRequest.mockRejectedValue(
      new ActionContractError("Not found", {
        errorCode: "builder_dsi_not_found",
        statusCode: 404,
      }),
    );
    mocks.message.mockImplementation(async ({ requestId }) => {
      remote.latestTurn = { requestId, status: "completed" };
      remote.workspace!.revision = "provider-rev-2";
      return structuredClone(remote);
    });
    mocks.publish.mockImplementation(async (input) => ({
      sessionId: input.sessionId,
      revision: input.expectedRevision,
      published: 4,
    }));
    mocks.artifact.mockImplementation(async ({ artifactId, revision }) => ({
      id: artifactId,
      hash: revision,
      contentType: artifactId.endsWith(".css") ? "text/css" : "text/html",
      body: "Real provider file body",
    }));
    store = {
      ownerApp: "design",
      runtime: "builder",
      nativeThreadState: mocks.native,
      async read(id, write) {
        const row = rows.get(id);
        if (!row)
          throw new ActionContractError("Not found", {
            errorCode: "not_found",
            statusCode: 404,
          });
        if (write && !canEdit)
          throw new ActionContractError("Editor required", {
            errorCode: "forbidden",
            statusCode: 403,
          });
        return { row: { ...row }, canEdit };
      },
      async insert(row) {
        if (!rows.has(row.id))
          rows.set(row.id, { id: row.id, title: row.title, data: row.data });
      },
      async compareAndSwap(row, data) {
        if (failWrites > 0) {
          failWrites--;
          return false;
        }
        if (rows.get(row.id)?.data !== row.data) return false;
        rows.set(row.id, { ...row, data });
        return true;
      },
      async readSourceEvidence(id, sourceId) {
        const current = await service.get(id);
        await service.update({
          id,
          expectedRevision: current.workspace!.revision,
          operationId: `read-${sourceId}`,
          sourceUpdates: [
            {
              id: sourceId,
              status: "ready",
              evidence: "Actual scoped source evidence",
              provenance: "extracted",
              error: null,
            },
          ],
        });
        return {
          sourceId,
          evidence: "Actual scoped source evidence",
          warnings: ["Scoped reader limit"],
        };
      },
    };
    service = createDesignSystemAuthoringService(store);
  });

  it("starts once with a persisted receipt, maps real files and separates control/Codegen identities", () =>
    asOwner(async () => {
      const { id } = await create();
      expect(stored(id).runtime).toBe("builder");
      expect(stored(id).kickoff!.status).toBe("pending");
      mocks.start.mockImplementationOnce(async (input) => {
        const workspace = stored(id);
        expect(workspace.builder!.operations[0]).toMatchObject({
          status: "dispatched",
          providerRequestId: input.requestId,
        });
        expect(workspace.builder!.sourceHash).toBeUndefined();
        expect(workspace.builder!.operations[0].sourceBatch!.hash).toHaveLength(
          64,
        );
        remote.latestTurn = { requestId: input.requestId, status: "completed" };
        return remote;
      });
      const result = await run(id);
      expect(result.workspace!.builder).toMatchObject({
        sessionId: "control-session",
        codegenSessionId: "codegen-session",
        designSystemId: "canonical-dsi",
        projectId: "canonical-project",
        branchName: "canonical-branch",
        revision: "provider-rev-1",
      });
      expect(result.workspace!.artifacts).toHaveLength(4);
      expect(
        result.workspace!.artifacts.map((item) => item.contentType),
      ).toEqual(["text/css", "text/html", "text/markdown", "application/json"]);
      expect(
        result.workspace!.artifacts.every(
          (item) => item.content === null && item.values === undefined,
        ),
      ).toBe(true);
      expect(result.canPublish).toBe(true);
      expect(result.canUse).toBe(false);
      expect(result.builderSession!.workspace!.messages[0].text).toContain(
        "Actual provider",
      );
      expect(rows.get(id)!.data).not.toContain("Actual provider message");
      expect(rows.get(id)!.data).not.toContain("Create the requested system");
      expect(rows.get(id)!.data).not.toContain("EXAMPLE_UPLOAD_SECRET");
      await run(id);
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.prepare).toHaveBeenCalledOnce();
      expect(mocks.native).not.toHaveBeenCalled();
    }));

  it("continues the same session and maps the local selected target to a provider file", () =>
    asOwner(async () => {
      const { id } = await create();
      const first = await run(id);
      const target = first.workspace!.artifacts[1];
      await service.runBuilder({
        id,
        requestId: "follow-up",
        prompt: "Refine the button",
        targetId: target.id,
        expectedRevision: "provider-rev-1",
      });
      expect(mocks.message).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "control-session",
          targetId: "components/actual.html",
          expectedRevision: "provider-rev-1",
          prompt: "Refine the button",
        }),
      );
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.prepare).toHaveBeenCalledOnce();
      expect(stored(id).builder!.operations).toHaveLength(2);
      expect(stored(id).builder!.revision).toBe("provider-rev-2");
    }));

  it("rejects reused IDs with changed prompts and stale expected provider revisions", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      await expect(run(id, "first", "Different prompt")).rejects.toMatchObject({
        errorCode: "design_system_revision_conflict",
      });
      await expect(
        service.runBuilder({
          id,
          requestId: "stale",
          prompt: "Change",
          expectedRevision: "wrong",
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_revision_conflict" });
      expect(mocks.message).not.toHaveBeenCalled();
    }));

  it("serializes concurrent starts through CAS and never dispatches duplicates", () =>
    asOwner(async () => {
      const { id } = await create();
      const result = await Promise.all([run(id), run(id)]);
      expect(result).toHaveLength(2);
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(stored(id).builder!.operations).toHaveLength(1);
    }));

  it("retains unknown starts and never silently starts another system", () =>
    asOwner(async () => {
      const { id } = await create();
      mocks.start.mockRejectedValueOnce(new Error("socket interrupted"));
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_builder_outcome_unknown",
        details: {
          id,
          requestId: "first",
          outcome: "unknown",
          retryable: false,
        },
      });
      const result = await service.get(id);
      expect(result.workspace!.builder!.operations[0].status).toBe("unknown");
      expect(result.workspace!.run!.stage).toBe("needs-attention");
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_builder_outcome_unknown",
      });
      await expect(run(id, "another")).rejects.toMatchObject({
        errorCode: "design_system_builder_operation_pending",
      });
      await service.get(id);
      expect(mocks.start).toHaveBeenCalledOnce();
    }));

  it("reconciles an unknown follow-up through a real matching provider turn, not resubmission", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      mocks.message.mockImplementationOnce(async ({ requestId }) => {
        remote.latestTurn = { requestId, status: "completed" };
        remote.workspace!.revision = "provider-rev-2";
        throw new Error("lost response");
      });
      await expect(run(id, "second")).rejects.toMatchObject({
        errorCode: "design_system_builder_outcome_unknown",
      });
      expect(stored(id).builder!.operations[1].status).toBe("unknown");
      const reconciled = await service.get(id);
      expect(reconciled.workspace!.builder!.operations[1].status).toBe(
        "completed",
      );
      await run(id, "second");
      expect(mocks.message).toHaveBeenCalledOnce();
    }));

  it("persists scoped source-reader updates before dispatch, without stale CAS overwrite", () =>
    asOwner(async () => {
      const { id } = await create([
        { id: "site", kind: "website", url: "https://example.test" },
      ]);
      const prepare = mocks.prepare.getMockImplementation()!;
      mocks.prepare.mockImplementationOnce(async (input) => {
        await input.readSourceEvidence("site");
        return prepare(input);
      });
      await run(id);
      expect(stored(id).sources[0]).toMatchObject({
        evidence: "Actual scoped source evidence",
        status: "ready",
        provenance: "extracted",
      });
      expect(stored(id).builder!.sourceOutcomes[0].warnings).toContain(
        "Bounded extraction",
      );
      expect(mocks.start.mock.calls[0][0].sources).toEqual([
        { kind: "file", uploadToken: "<EXAMPLE_UPLOAD_SECRET>" },
      ]);
      expect(rows.get(id)!.data).not.toContain("EXAMPLE_UPLOAD_SECRET");
    }));

  it("preserves per-source preparation failures and allows an explicit new preparation request", () =>
    asOwner(async () => {
      const { id } = await create([
        { id: "site", kind: "website", url: "https://example.test" },
      ]);
      mocks.prepare.mockResolvedValueOnce({
        status: "needs-attention",
        sources: null,
        outcomes: [
          {
            sourceId: "site",
            status: "needs-attention",
            excluded: false,
            representation: null,
            warnings: [],
            upload: null,
            error: {
              code: "source_denied",
              message: "Access denied",
              retryable: false,
            },
          },
        ],
      });
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "source_denied",
        details: {
          sourceErrors: [
            { sourceId: "site", code: "source_denied", retryable: false },
          ],
        },
      });
      const failed = await service.get(id);
      expect(failed.workspace!.sources[0].error!.code).toBe("source_denied");
      expect(failed.workspace!.builder!.operations[0].status).toBe("failed");
      expect(mocks.start).not.toHaveBeenCalled();
      await run(id, "explicit-retry");
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(stored(id).sources[0].error).toBeNull();
      expect(
        stored(id).builder!.operations[0].sourceBatch!.outcomes[0].error!.code,
      ).toBe("source_denied");
      expect((await service.get(id)).canPublish).toBe(true);
    }));

  it("appends a single batch to the same session and polls a pending receipt without reuploading", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      const originalHash = stored(id).builder!.sourceHash;
      await service.update({
        id,
        expectedRevision: stored(id).revision,
        operationId: "add",
        sources: [{ id: "site", kind: "website", url: "https://example.test" }],
      });
      mocks.message.mockImplementationOnce(async ({ requestId }) => {
        expect(stored(id).builder!.sourceHash).toBe(originalHash);
        expect(
          stored(id).builder!.operations.at(-1)!.sourceBatch,
        ).toMatchObject({ status: "uploaded", addedSourceIds: ["site"] });
        remote.latestTurn = { requestId, status: "submitted" };
        return {
          ...structuredClone(remote),
          status: "preparing",
          workspace: undefined,
        };
      });
      const result = await run(id, "with-reference");
      expect(mocks.prepare.mock.calls[1][0]).toMatchObject({
        intent: "references",
        sources: [expect.objectContaining({ id: "site" })],
      });
      expect(mocks.message).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "control-session",
          sources: [{ kind: "file", uploadToken: "<EXAMPLE_UPLOAD_SECRET>" }],
        }),
      );
      expect(result.workspace!.builder!.operations.at(-1)).toMatchObject({
        status: "submitted",
        sourceBatch: { status: "submitted", addedSourceIds: ["site"] },
      });
      expect(result.workspace!.builder!.sourceHash).not.toBe(originalHash);
      expect(result.canPublish).toBe(false);
      expect(result.canUse).toBe(false);
      expect(result.workspace!.builder!.workspaceStatus).toBeUndefined();
      await run(id, "with-reference");
      const pending = await service.get(id);
      expect(pending.workspace!.run!.status).toBe("running");
      expect(pending.canPublish).toBe(false);
      remote.latestTurn!.status = "completed";
      const completed = await service.get(id);
      expect(
        completed.workspace!.builder!.operations.at(-1)!.sourceBatch!.status,
      ).toBe("applied");
      expect(completed.canPublish).toBe(true);
      expect(stored(id).sources).toHaveLength(1);
      expect(stored(id).kickoff!.status).toBe("pending");
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.message).toHaveBeenCalledOnce();
      expect(mocks.prepare).toHaveBeenCalledTimes(2);
      expect(rows.get(id)!.data).not.toContain("EXAMPLE_UPLOAD_SECRET");
    }));

  it("does not erase a newer scoped reader error while saving successful upload outcomes", () =>
    asOwner(async () => {
      const { id } = await create([
        { id: "site", kind: "website", url: "https://example.test" },
      ]);
      const updateError = (code: string) =>
        service.update({
          id,
          expectedRevision: stored(id).revision,
          operationId: code,
          sourceUpdates: [
            {
              id: "site",
              status: "needs-attention",
              evidence: null,
              provenance: null,
              error: { code, message: "Read failed", retryable: false },
            },
          ],
        });
      await updateError("prior-error");
      const original = mocks.prepare.getMockImplementation()!;
      mocks.prepare.mockImplementationOnce(async (input) => {
        await updateError("newer-error");
        return original(input);
      });
      await run(id);
      const result = await service.get(id);
      expect(result.workspace!.sources[0].error!.code).toBe("newer-error");
      expect(result.canPublish).toBe(false);
    }));

  it("uploads only newly added references and preserves prior source outcomes", () =>
    asOwner(async () => {
      const { id } = await create([
        {
          id: "first-site",
          kind: "website",
          url: "https://example.test/first",
        },
      ]);
      await run(id);
      await service.update({
        id,
        expectedRevision: stored(id).revision,
        operationId: "add",
        sources: [
          {
            id: "next-site",
            kind: "website",
            url: "https://example.test/next",
          },
        ],
      });
      await run(id, "append");
      expect(
        mocks.prepare.mock.calls[1][0].sources.map(
          (source: { id: string }) => source.id,
        ),
      ).toEqual(["next-site"]);
      expect(stored(id).builder!.sourceIds).toEqual([
        "first-site",
        "next-site",
      ]);
      expect(
        stored(id).builder!.sourceOutcomes.map((source) => source.sourceId),
      ).toEqual(["first-site", "next-site"]);
      expect(stored(id).builder!.operations[1].sourceBatch).toMatchObject({
        sourceIds: ["first-site", "next-site"],
        addedSourceIds: ["next-site"],
        status: "applied",
      });
    }));

  it("retains unknown append receipts and reconciles them without repeating uploads or messages", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      const originalHash = stored(id).builder!.sourceHash;
      await service.update({
        id,
        expectedRevision: stored(id).revision,
        operationId: "add",
        sources: [{ id: "site", kind: "website", url: "https://example.test" }],
      });
      mocks.message.mockImplementationOnce(async ({ requestId }) => {
        remote.latestTurn = { requestId, status: "unknown" };
        throw new ActionContractError("Response interrupted", {
          errorCode: "builder_dsi_outcome_unknown",
          statusCode: 502,
        });
      });
      await expect(run(id, "append")).rejects.toMatchObject({
        errorCode: "builder_dsi_outcome_unknown",
        details: { outcome: "unknown" },
      });
      await expect(run(id, "append")).rejects.toMatchObject({
        errorCode: "builder_dsi_outcome_unknown",
      });
      const unknown = await service.get(id);
      expect(
        unknown.workspace!.builder!.operations[1].sourceBatch!.status,
      ).toBe("unknown");
      expect(unknown.workspace!.builder!.sourceHash).toBe(originalHash);
      expect(unknown.canPublish).toBe(false);
      expect(unknown.canUse).toBe(false);
      remote.latestTurn!.status = "submitted";
      expect(
        (await service.get(id)).workspace!.builder!.operations[1].sourceBatch!
          .status,
      ).toBe("submitted");
      remote.latestTurn!.status = "completed";
      const completed = await service.get(id);
      expect(
        completed.workspace!.builder!.operations[1].sourceBatch!.status,
      ).toBe("applied");
      expect(completed.canPublish).toBe(true);
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.message).toHaveBeenCalledOnce();
      expect(mocks.prepare).toHaveBeenCalledTimes(2);
    }));

  it("rejects retraction of previously ingested references before preparing any new upload", () =>
    asOwner(async () => {
      const { id } = await create([
        { id: "site", kind: "website", url: "https://example.test" },
      ]);
      await run(id);
      const before = rows.get(id)!.data;
      await expect(
        service.update({
          id,
          expectedRevision: stored(id).revision,
          operationId: "exclude",
          sourceExclusions: [{ id: "site", excluded: true }],
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_source_retraction_unsupported",
        details: { id, sourceId: "site" },
      });
      expect(rows.get(id)!.data).toBe(before);
      expect(mocks.prepare).toHaveBeenCalledOnce();
      expect(mocks.message).not.toHaveBeenCalled();
      expect((await service.get(id)).canPublish).toBe(true);
    }));

  it("allows excluding a never-ingested source after a failed preparation", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      await service.update({
        id,
        expectedRevision: stored(id).revision,
        operationId: "add",
        sources: [{ id: "site", kind: "website", url: "https://example.test" }],
      });
      mocks.prepare.mockResolvedValueOnce({
        status: "needs-attention",
        sources: null,
        outcomes: [
          {
            sourceId: "site",
            status: "needs-attention",
            excluded: false,
            representation: null,
            warnings: [],
            upload: null,
            error: {
              code: "source_denied",
              message: "Access denied",
              retryable: false,
            },
          },
        ],
      });
      await expect(run(id, "failed-append")).rejects.toMatchObject({
        errorCode: "source_denied",
      });
      await service.update({
        id,
        expectedRevision: stored(id).revision,
        operationId: "exclude",
        sourceExclusions: [{ id: "site", excluded: true }],
      });
      expect(stored(id).sources[0].excluded).toBe(true);
      expect(stored(id).sources[0].error!.code).toBe("source_denied");
      expect(stored(id).builder!.sourceIds).not.toContain("site");
      expect(mocks.message).not.toHaveBeenCalled();
    }));

  it("includes references explicitly added to a fresh workspace before its first turn", () =>
    asOwner(async () => {
      const { id } = await create();
      await service.update({
        id,
        expectedRevision: stored(id).revision,
        operationId: "add-before-start",
        sources: [{ id: "site", kind: "website", url: "https://example.test" }],
      });
      await run(id);
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: "references",
          sources: [expect.objectContaining({ id: "site" })],
        }),
      );
      expect(mocks.start).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: "references",
          sources: [{ kind: "file", uploadToken: "<EXAMPLE_UPLOAD_SECRET>" }],
        }),
      );
    }));

  it.each([
    ["design_system_builder_source_unsupported", false, 422],
    ["design_system_builder_source_upload_failed", true, 502],
  ] as const)(
    "preserves %s source failures in the mutation and saved state",
    (code, retryable, statusCode) =>
      asOwner(async () => {
        const { id } = await create([
          { id: "site", kind: "website", url: "https://example.test" },
        ]);
        mocks.prepare.mockResolvedValueOnce({
          status: "needs-attention",
          sources: null,
          outcomes: [
            {
              sourceId: "site",
              status: "needs-attention",
              excluded: false,
              representation: null,
              warnings: [],
              upload: null,
              error: { code, message: "Source failure", retryable },
            },
          ],
        });
        await expect(run(id)).rejects.toMatchObject({
          errorCode: code,
          statusCode,
          details: { id, outcome: "failed" },
        });
        const result = await service.get(id);
        expect(result.workspace!.sources[0].error).toMatchObject({
          code,
          retryable,
        });
        expect(result.workspace!.builder!.operations[0]).toMatchObject({
          status: "failed",
          error: { code },
        });
        await expect(run(id)).rejects.toMatchObject({ errorCode: code });
        expect(mocks.prepare).toHaveBeenCalledOnce();
        expect(mocks.start).not.toHaveBeenCalled();
      }),
  );

  it("preserves thrown preparation codes without exposing raw provider details", () =>
    asOwner(async () => {
      const { id } = await create();
      mocks.prepare.mockRejectedValueOnce(
        new ActionContractError("<EXAMPLE_PRIVATE_PROVIDER_TEXT>", {
          errorCode: "design_system_source_reader_missing",
          statusCode: 503,
        }),
      );
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_source_reader_missing",
        statusCode: 503,
      });
      expect(rows.get(id)!.data).not.toContain("EXAMPLE_PRIVATE_PROVIDER_TEXT");
      expect(
        (await service.get(id)).workspace!.builder!.operations[0].status,
      ).toBe("failed");
      expect(mocks.start).not.toHaveBeenCalled();
    }));

  it.each(["turn", "session"])(
    "rejects an actual failed provider %s after persisting its receipt",
    (kind) =>
      asOwner(async () => {
        const { id } = await create();
        mocks.start.mockImplementationOnce(async ({ requestId }) => {
          const error = {
            code: "provider_generation_failed",
            message: "Provider generation failed",
          };
          if (kind === "turn")
            remote.latestTurn = { requestId, status: "failed", error };
          else {
            remote.status = "failed";
            remote.error = error;
          }
          return structuredClone(remote);
        });
        await expect(run(id)).rejects.toMatchObject({
          errorCode: "provider_generation_failed",
          details: { outcome: "failed" },
        });
        const result = await service.get(id);
        expect(result.workspace!.builder!.operations[0].status).toBe("failed");
        expect(result.canUse).toBe(false);
        expect(result.canPublish).toBe(false);
      }),
  );

  it("requires explicit verified publication and scopes canPublish to editors", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      const result = await service.publishBuilder({
        id,
        requestId: "publish",
        expectedRevision: "provider-rev-1",
      });
      expect(result.canUse).toBe(true);
      expect(result.workspace!.builder!.publication).toMatchObject({
        sessionId: "control-session",
        revision: "provider-rev-1",
        published: 4,
        contentRevision: result.workspace!.contentRevision,
      });
      await service.publishBuilder({
        id,
        requestId: "publish",
        expectedRevision: "provider-rev-1",
      });
      expect(mocks.publish).toHaveBeenCalledOnce();
      canEdit = false;
      const viewer = await service.get(id);
      expect(viewer.canUse).toBe(true);
      expect(viewer.canPublish).toBe(false);
      await expect(
        service.publishBuilder({
          id,
          requestId: "denied",
          expectedRevision: "provider-rev-1",
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mocks.publish).toHaveBeenCalledOnce();
    }));

  it.each(["wrong-session", "wrong-revision", "zero", "interrupted"])(
    "does not enable Use for %s publication",
    (mode) =>
      asOwner(async () => {
        const { id } = await create();
        await run(id);
        mocks.publish.mockImplementationOnce(async () => {
          if (mode === "interrupted") throw new Error("timeout");
          return {
            sessionId:
              mode === "wrong-session" ? "other-session" : "control-session",
            revision:
              mode === "wrong-revision" ? "other-revision" : "provider-rev-1",
            published: mode === "zero" ? 0 : 4,
          };
        });
        const input = {
          id,
          requestId: "publish",
          expectedRevision: "provider-rev-1",
        };
        const errorCode =
          mode === "interrupted"
            ? "design_system_builder_publication_unknown"
            : "builder_dsi_response_invalid";
        await expect(service.publishBuilder(input)).rejects.toMatchObject({
          errorCode,
        });
        const result = await service.get(id);
        expect(result.canUse).toBe(false);
        expect(result.workspace!.builder!.publication).toBeNull();
        await expect(service.publishBuilder(input)).rejects.toMatchObject({
          errorCode,
        });
        expect(mocks.publish).toHaveBeenCalledOnce();
      }),
  );

  it("recovers a confirmed publication through GET after a lost POST response", () =>
    asOwner(async () => {
      const { id } = await create();
      const initial = await run(id);
      const input = {
        id,
        requestId: "publish",
        expectedRevision: "provider-rev-1",
      };
      mocks.publish.mockImplementationOnce(
        async ({ requestId, expectedRevision }) => {
          expect(stored(id).builder!.operations.at(-1)).toMatchObject({
            status: "dispatched",
            publicationTarget: {
              expectedRevision,
              contentRevision: initial.workspace!.contentRevision,
            },
          });
          remote.publication = {
            requestId,
            revision: expectedRevision,
            published: 4,
          };
          throw new Error("Lost publication response");
        },
      );
      await expect(service.publishBuilder(input)).rejects.toMatchObject({
        errorCode: "design_system_builder_publication_unknown",
      });
      expect(stored(id).builder!.publication).toBeNull();
      const recovered = await service.get(id);
      expect(recovered.canUse).toBe(true);
      expect(recovered.workspace!.builder!.operations.at(-1)!.status).toBe(
        "completed",
      );
      expect(recovered.workspace!.builder!.publication).toMatchObject({
        revision: input.expectedRevision,
        published: 4,
        requestId: input.requestId,
        contentRevision: initial.workspace!.contentRevision,
      });
      await service.publishBuilder(input);
      expect(mocks.publish).toHaveBeenCalledOnce();
    }));

  it.each([
    "foreign-request",
    "wrong-revision",
    "new-content",
    "completed-turn-only",
  ])("does not enable Use for %s publication recovery", (mode) =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      mocks.publish.mockRejectedValueOnce(
        new Error("Lost publication response"),
      );
      await expect(
        service.publishBuilder({
          id,
          requestId: "publish",
          expectedRevision: "provider-rev-1",
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_publication_unknown",
      });
      const operation = stored(id).builder!.operations.at(-1)!;
      if (mode === "completed-turn-only")
        remote.latestTurn = {
          requestId: operation.providerRequestId,
          status: "completed",
        };
      else
        remote.publication = {
          requestId:
            mode === "foreign-request"
              ? "unrelated-publication"
              : operation.providerRequestId,
          revision:
            mode === "wrong-revision" ? "wrong-revision" : "provider-rev-1",
          published: 4,
        };
      if (mode === "new-content")
        remote.workspace!.revision = "new-content-revision";
      if (mode === "wrong-revision") {
        await expect(service.get(id)).rejects.toMatchObject({
          errorCode: "builder_dsi_response_invalid",
        });
        expect(stored(id).builder!.publication).toBeNull();
      } else {
        const result = await service.get(id);
        expect(result.canUse).toBe(false);
        if (mode !== "new-content")
          expect(result.workspace!.builder!.publication).toBeNull();
        else
          expect(result.workspace!.builder!.publication!.contentRevision).toBe(
            operation.publicationTarget!.contentRevision,
          );
      }
      expect(mocks.publish).toHaveBeenCalledOnce();
    }),
  );

  it("invalidates a publication when provider files change, without fake fixed foundations", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      await service.publishBuilder({
        id,
        requestId: "publish",
        expectedRevision: "provider-rev-1",
      });
      remote.workspace!.revision = "provider-rev-2";
      remote.workspace!.artifacts = [
        {
          id: "new.md",
          name: "Actual new file",
          kind: "markdown",
          hash: "new-hash",
        },
      ];
      const result = await service.get(id);
      expect(result.canUse).toBe(false);
      expect(result.canPublish).toBe(true);
      expect(result.workspace!.artifacts).toHaveLength(1);
      expect(result.workspace!.artifacts[0].name).toBe("Actual new file");
    }));

  it.each(["sessionId", "projectId", "designSystemId", "branchName"] as const)(
    "rejects immutable %s remapping",
    (field) =>
      asOwner(async () => {
        const { id } = await create();
        await run(id);
        const before = rows.get(id)!.data;
        remote[field] = "unexpected-other-identity";
        await expect(service.get(id)).rejects.toMatchObject({
          errorCode: "design_system_builder_identity_mismatch",
        });
        expect(rows.get(id)!.data).toBe(before);
      }),
  );

  it("invalidates derived HTML previews when only the aggregate Builder revision changes", () =>
    asOwner(async () => {
      const { id } = await create();
      const initial = await run(id);
      const html = initial.workspace!.artifacts.find(
        (artifact) => artifact.provider?.kind === "html",
      )!;
      const css = initial.workspace!.artifacts.find(
        (artifact) => artifact.provider?.kind === "css",
      )!;
      remote.workspace!.revision = "asset-only-revision";
      const updated = await service.get(id);
      const preview = updated.workspace!.artifacts.find(
        (artifact) => artifact.id === html.id,
      )!;
      expect(preview.revision).toBe(html.revision + 1);
      expect(preview.contentHash).toBe(html.contentHash);
      expect(preview.history.at(-1)!.contentHash).toBe(html.contentHash);
      expect(
        updated.workspace!.artifacts.find((artifact) => artifact.id === css.id)!
          .revision,
      ).toBe(css.revision);
      const stable = await service.get(id);
      expect(
        stable.workspace!.artifacts.find((artifact) => artifact.id === html.id)!
          .revision,
      ).toBe(preview.revision);
      await service.getArtifact(id, html.id, preview.revision);
      expect(mocks.artifact).toHaveBeenCalledWith({
        sessionId: "control-session",
        artifactId: html.provider!.id,
        revision: html.contentHash,
      });
    }));

  it("reads real provider artifact bodies with the saved hash and rejects a mismatched receipt", () =>
    asOwner(async () => {
      const { id } = await create();
      const result = await run(id);
      const artifact = result.workspace!.artifacts[0];
      const body = await service.getArtifact(
        id,
        artifact.id,
        artifact.revision,
      );
      expect(body.text).toBe("Real provider file body");
      expect(mocks.artifact).toHaveBeenCalledWith({
        sessionId: "control-session",
        artifactId: "src/theme.css",
        revision: "css-hash-1",
      });
      expect(rows.get(id)!.data).not.toContain("Real provider file body");
      mocks.artifact.mockResolvedValueOnce({
        id: "other",
        hash: "css-hash-1",
        contentType: "text/css",
        body: "wrong",
      });
      await expect(service.getArtifact(id, artifact.id)).rejects.toMatchObject({
        errorCode: "builder_dsi_response_invalid",
      });
      const context = authoredDesignSystemAgentContext(result.workspace!);
      expect(context).toContain("read get-design-system-artifact");
      expect(context).not.toContain("undefined");
    }));

  it("bounds Builder agent inventory by count and characters with foundations and rules first", () =>
    asOwner(async () => {
      const { id } = await create();
      const result = await run(id);
      const workspace = result.workspace!;
      const component = workspace.artifacts.find(
        (artifact) => artifact.kind === "component",
      )!;
      const foundation = workspace.artifacts.find(
        (artifact) => artifact.kind === "foundation",
      )!;
      const rule = workspace.artifacts.find(
        (artifact) => artifact.kind === "usage-rule",
      )!;
      for (const longNames of [false, true]) {
        workspace.artifacts = [
          ...Array.from({ length: 198 }, (_, index) => ({
            ...component,
            id: `component-${index}`,
            name: longNames ? "x".repeat(255) : `Component ${index}`,
          })),
          foundation,
          rule,
        ];
        const context = authoredDesignSystemAgentContext(workspace);
        const shown = (context.match(/for the actual file\./g) ?? []).length;
        expect(shown).toBeGreaterThan(0);
        expect(shown).toBeLessThanOrEqual(30);
        expect(context.length).toBeLessThanOrEqual(10_000);
        expect(context).toContain(`${200 - shown} additional files not listed`);
        expect(context).toContain("Read get-design-system-workspace");
        expect(context).toContain("metadata is not content");
        expect(context.indexOf(foundation.name)).toBeLessThan(
          context.indexOf("component-0"),
        );
        expect(context.indexOf(rule.name)).toBeLessThan(
          context.indexOf("component-0"),
        );
      }
    }));

  it("rejects local writes, bindRun and update.run for Builder workspaces", () =>
    asOwner(async () => {
      const { id } = await create();
      await expect(
        service.write({
          id,
          targetId: "colors",
          operationId: "local",
          expectedRevision: 0,
          kind: "foundation",
          name: "Colors",
          provenance: "generated",
          sourceIds: [],
          values: { primary: "red" },
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_runtime_only",
      });
      await expect(
        service.bindRun({ id, runId: "native" }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_runtime_only",
      });
      await expect(
        service.update({
          id,
          expectedRevision: stored(id).revision,
          operationId: "local-run",
          run: {
            id: "native",
            status: "running",
            stage: "reading-sources",
            error: null,
          },
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_runtime_only",
      });
      expect(mocks.native).not.toHaveBeenCalled();
    }));

  it("denies personal Builder access before provider reads or mutations", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      mocks.access.mockRejectedValue(
        new ActionContractError("Connect Builder", {
          errorCode: "builder_dsi_missing",
          statusCode: 403,
        }),
      );
      const beforeReads = mocks.get.mock.calls.length;
      await expect(service.get(id)).rejects.toMatchObject({
        errorCode: "builder_dsi_missing",
      });
      await expect(run(id, "denied")).rejects.toMatchObject({
        errorCode: "builder_dsi_missing",
      });
      await expect(
        service.publishBuilder({
          id,
          requestId: "denied",
          expectedRevision: "provider-rev-1",
        }),
      ).rejects.toMatchObject({ errorCode: "builder_dsi_missing" });
      expect(mocks.get).toHaveBeenCalledTimes(beforeReads);
      expect(mocks.message).not.toHaveBeenCalled();
      expect(mocks.publish).not.toHaveBeenCalled();
    }));

  it.each(["fresh", "references"] as const)(
    "durably delivers %s kickoff through outer chat without projecting its run as Builder state",
    (intent) =>
      asOwner(async () => {
        const native = {
          exists: false,
          kickoffReceived: false,
          run: null,
          messageCount: 0,
        };
        mocks.native.mockImplementation(async () => ({
          ...native,
          run: { runId: "outer-chat", status: "completed" },
        }));
        const { id } = await create(
          intent === "references"
            ? [
                {
                  id: "initial-site",
                  kind: "website",
                  url: "https://example.test/initial",
                },
              ]
            : [],
        );
        const attempts = await Promise.allSettled([
          service.claimKickoff(id),
          service.claimKickoff(id),
        ]);
        const claimed = attempts.flatMap((result) =>
          result.status === "fulfilled" && result.value.shouldDispatch
            ? [result.value]
            : [],
        );
        expect(claimed).toHaveLength(1);
        expect(claimed[0].knownNewThread).toBe(true);
        await service.completeKickoff({
          id,
          claimId: claimed[0].claimId!,
          status: "delivered",
        });
        expect(stored(id).kickoff!.status).toBe("claimed");
        native.exists = true;
        native.kickoffReceived = true;
        expect((await service.claimKickoff(id)).shouldDispatch).toBe(false);
        expect(stored(id).kickoff!.status).toBe("delivered");
        expect(stored(id).run).toBeNull();
        expect(mocks.start).not.toHaveBeenCalled();
        await run(id);
        const providerRun = stored(id).run;
        const nativeCalls = mocks.native.mock.calls.length;
        await service.get(id);
        expect(mocks.native).toHaveBeenCalledTimes(nativeCalls);
        expect(stored(id).run).toEqual(providerRun);
        const originalKickoff = stored(id).kickoff!.requestId;
        await service.update({
          id,
          expectedRevision: stored(id).revision,
          operationId: "added-reference",
          sources: [
            {
              id: "later-site",
              kind: "website",
              url: "https://example.test/later",
            },
          ],
        });
        expect(stored(id).kickoff).toMatchObject({
          status: "pending",
          claimId: null,
        });
        expect(stored(id).kickoff!.requestId).not.toBe(originalKickoff);
        native.kickoffReceived = false;
        const append = await service.claimKickoff(id);
        expect(append).toMatchObject({
          shouldDispatch: true,
          knownNewThread: false,
          conversationId: stored(id).conversationId,
        });
        native.kickoffReceived = true;
        await service.completeKickoff({
          id,
          claimId: append.claimId!,
          status: "delivered",
        });
        expect(stored(id).kickoff!.status).toBe("delivered");
        expect(mocks.message).not.toHaveBeenCalled();
        await run(id, "append-action");
        expect(mocks.start).toHaveBeenCalledOnce();
        expect(mocks.message).toHaveBeenCalledOnce();
      }),
  );

  it("preserves legacy runtime when store defaults new workspaces to Builder", () =>
    asOwner(async () => {
      rows.set("legacy", {
        id: "legacy",
        title: "Legacy",
        data: JSON.stringify({ colors: { accent: "red" } }),
      });
      const result = await service.resume("legacy");
      expect(result.workspace!.runtime).not.toBe("builder");
      expect(result.workspace!.builder).toBeUndefined();
      expect(mocks.start).not.toHaveBeenCalled();
    }));

  it("does not retry provider mutation when receipt CAS repeatedly fails", () =>
    asOwner(async () => {
      const { id } = await create();
      mocks.start.mockImplementationOnce(async ({ requestId }) => {
        failWrites = 4;
        remote.latestTurn = { requestId, status: "completed" };
        return remote;
      });
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_revision_conflict",
        details: { outcome: "unknown" },
      });
      const result = await service.get(id);
      expect(result.workspace!.builder!.operations[0].status).toBe("unknown");
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_revision_conflict",
      });
      expect(mocks.start).toHaveBeenCalledOnce();
    }));

  it("expires interrupted preparation without replaying a dispatched mutation", () =>
    asOwner(async () => {
      const { id } = await create();
      let release!: () => void;
      const prepared = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = mocks.prepare.getMockImplementation()!;
      mocks.prepare.mockImplementationOnce(async (input) => {
        await prepared;
        return original(input);
      });
      const ongoing = run(id);
      await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
      const row = rows.get(id)!;
      const workspace = stored(id);
      workspace.builder!.operations[0].preparationLeaseUntil = 0;
      rows.set(id, { ...row, data: JSON.stringify({ authoring: workspace }) });
      const expired = await service.get(id);
      expect(expired.workspace!.builder!.operations[0].status).toBe("failed");
      release();
      await expect(ongoing).rejects.toMatchObject({
        errorCode: "design_system_builder_preparation_interrupted",
      });
      expect(mocks.start).not.toHaveBeenCalled();
      await run(id, "new-request");
      expect(mocks.start).toHaveBeenCalledOnce();
    }));

  it("does not advertise publication or use from a missing live snapshot or empty files", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      await service.publishBuilder({
        id,
        requestId: "publish",
        expectedRevision: "provider-rev-1",
      });
      const workspace = remote.workspace!;
      delete remote.workspace;
      const missing = await service.get(id);
      expect(missing.canUse).toBe(false);
      expect(missing.canPublish).toBe(false);
      remote.workspace = { ...workspace, artifacts: [] };
      const empty = await service.get(id);
      expect(empty.workspace!.artifacts).toEqual([]);
      expect(empty.canPublish).toBe(false);
      expect(empty.canUse).toBe(false);
    }));

  it("re-polls after a concurrent write instead of applying an older provider snapshot", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      let release!: (session: BuilderDsiSession) => void;
      const oldSession = structuredClone(remote);
      mocks.get.mockImplementationOnce(
        () =>
          new Promise<BuilderDsiSession>((resolve) => {
            release = resolve;
          }),
      );
      const poll = service.get(id);
      await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
      await run(id, "new-turn");
      release(oldSession);
      const result = await poll;
      expect(result.workspace!.builder!.revision).toBe("provider-rev-2");
      expect(stored(id).builder!.revision).toBe("provider-rev-2");
      expect(mocks.get).toHaveBeenCalledTimes(2);
    }));

  it("keeps provider read failures loud instead of returning cached readiness", () =>
    asOwner(async () => {
      const { id } = await create();
      await run(id);
      await service.publishBuilder({
        id,
        requestId: "publish",
        expectedRevision: "provider-rev-1",
      });
      mocks.get.mockRejectedValueOnce(
        new ActionContractError("Unavailable", {
          errorCode: "builder_dsi_unavailable",
          statusCode: 502,
        }),
      );
      await expect(service.get(id)).rejects.toMatchObject({
        errorCode: "builder_dsi_unavailable",
      });
    }));

  it("recovers an interrupted start by its persisted provider request ID without another POST", () =>
    asOwner(async () => {
      const { id } = await create();
      mocks.start.mockImplementationOnce(async ({ requestId }) => {
        remote.latestTurn = { requestId, status: "completed" };
        throw new Error("Lost start response");
      });
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_builder_outcome_unknown",
      });
      const requestId = stored(id).builder!.operations[0].providerRequestId;
      mocks.getByRequest.mockResolvedValueOnce(structuredClone(remote));
      const result = await service.get(id);
      expect(mocks.getByRequest).toHaveBeenCalledWith(requestId);
      expect(result.workspace!.builder!.sessionId).toBe("control-session");
      expect(result.workspace!.builder!.operations[0].status).toBe("completed");
      await run(id);
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.prepare).toHaveBeenCalledOnce();
      expect(result.canPublish).toBe(true);
      expect(result.canUse).toBe(false);
    }));

  it("does not treat an unavailable recovery lookup as an absent session", () =>
    asOwner(async () => {
      const { id } = await create();
      mocks.start.mockRejectedValueOnce(new Error("Lost response"));
      await expect(run(id)).rejects.toMatchObject({
        errorCode: "design_system_builder_outcome_unknown",
      });
      mocks.getByRequest.mockRejectedValueOnce(
        new ActionContractError("Unavailable", {
          errorCode: "builder_dsi_unavailable",
          statusCode: 502,
        }),
      );
      await expect(service.get(id)).rejects.toMatchObject({
        errorCode: "builder_dsi_unavailable",
      });
      expect(stored(id).builder!.operations[0].status).toBe("unknown");
      expect(mocks.start).toHaveBeenCalledOnce();
    }));

  it("never stores signed Builder upload tokens as workspace source inputs", () =>
    asOwner(async () => {
      const source = {
        id: "signed",
        kind: "file" as const,
        name: "brand.pdf",
        mimeType: "application/pdf",
        size: 4,
        handle: {
          kind: "builder-upload" as const,
          uploadToken: "<EXAMPLE_UPLOAD_TOKEN>",
        },
      };
      await expect(
        service.start({
          requestId: "signed",
          title: "Example",
          intent: "references",
          sources: [source],
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_upload_unverifiable",
      });
      expect(rows.size).toBe(0);
      const { id } = await create();
      await expect(
        service.update({
          id,
          expectedRevision: 0,
          operationId: "signed",
          sources: [source],
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_builder_upload_unverifiable",
      });
      expect(rows.get(id)!.data).not.toContain("EXAMPLE_UPLOAD_TOKEN");
    }));
});
