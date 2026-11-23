import type { Page, Route } from "@playwright/test";
import { assert, expect, it, vi } from "vitest";

import { holdCreationReceipt } from "../e2e/phase1/creation-receipt.js";
import {
  dependencyFingerprint,
  readAttempt,
  readCompletedResultPage,
} from "../e2e/phase1/execution-readback.js";
import type { FlowContext } from "../e2e/phase1/runtime.js";
import { catalogFixtureWarehouse } from "../e2e/phase1/warehouse-fixtures.js";
import { publishFixture } from "../e2e/publish-fixture.js";

it("uses the connection scoped to both regional catalog fixtures", async () => {
  const warehouse = { type: "bigquery", isDraft: false, isDefault: false };
  const regional = {
    ...warehouse,
    id: "regional",
    name: "Parity source a2_parity_q_us, a2_parity_q_east",
  };
  const action = vi.fn(async () => ({
    connections: [
      { ...warehouse, id: "general", name: "Parity Warehouse 01" },
      regional,
    ],
  }));
  const flow = { action } as unknown as FlowContext;
  await expect(catalogFixtureWarehouse(flow)).resolves.toEqual(regional);
  expect(action).toHaveBeenCalledExactlyOnceWith("list-data-connections");
});

it("holds the recovery read until the runner has observed the checking state", async () => {
  const page = {
    route: vi.fn<Page["route"]>(),
    unroute: vi.fn<Page["unroute"]>(),
  };
  const gate = await holdCreationReceipt(page);
  try {
    const registration = page.route.mock.calls[0];
    assert(registration);
    const [pattern, intercept] = registration;
    assert(pattern instanceof RegExp);
    expect(
      pattern.test(
        "http://localhost:4400/_agent-native/actions/get-project-creation?requestId=example",
      ),
    ).toBe(true);
    expect(
      pattern.test(
        "http://localhost:4400/_agent-native/actions/create-project",
      ),
    ).toBe(false);
    const allow = vi.fn(async () => {});
    const pending = intercept(
      { continue: allow } as unknown as Route,
      {} as never,
    );
    await Promise.resolve();
    expect(allow).not.toHaveBeenCalled();
    gate.release();
    await pending;
    expect(allow).toHaveBeenCalledOnce();
  } finally {
    await gate.dispose();
  }
  expect(page.unroute.mock.calls[0]).toEqual(page.route.mock.calls[0]);
});

const draftHead = { versionId: "draft", revision: "3" };
const projectId = "project";
const previewId = "preview";
const previewReceipt = {
  head: draftHead,
  compareReleaseId: null,
  state: "queued",
  projectId,
  previewId,
  runId: "run",
  cursor: "0",
};
const project = {
  id: projectId,
  title: "Project",
  ownerEmail: "qa@example.test",
  language: "python",
  description: "",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-18T00:00:00Z",
  updatedAt: "2026-11-18T00:00:00Z",
  workingVersionId: draftHead.versionId,
  publishedVersionId: null,
  draftHead,
  collectionIds: [],
  cells: [],
};
const manifestId = "verified-manifest";
const manifestRevision = "5";
const previewDetail = {
  ...previewReceipt,
  project,
  manifestId,
  manifestRevision,
  compared: null,
  nextDiffCursor: null,
  diff: [],
  run: null,
};

it("reads the durable E1 attempt and its complete result by the stored identities", () => {
  const attempt = {
    namespaceId: "namespace",
    cellId: "cell",
    runId: "run",
    attemptId: "attempt",
    outputGeneration: "opaque-fence",
  };
  const ref = {
    workspaceId: "workspace",
    projectId,
    head: draftHead,
    eventSeq: "3",
  };
  const complete = {
    attempt,
    state: { status: "complete", resultIds: ["result"] },
  };
  const run = {
    status: "admitted",
    runId: attempt.runId,
    startedAt: "2026-11-18T00:00:00Z",
    request: {
      requestId: "request",
      mode: "cell-only",
      targetCellId: attempt.cellId,
      staleValues: "reject",
      cache: "reuse",
      snapshot: {
        ref,
        namespace: { kind: "draft", namespaceId: attempt.namespaceId },
        inputRevision: "2",
        executionFingerprint: "graph",
      },
    },
    plan: {
      admittedCellIds: [attempt.cellId],
      dependencyResultIds: ["upstream"],
      rejectedCells: [],
    },
    attempts: [{ attempt, state: { status: "queued" } }],
    cursor: "3",
  };
  const stored = {
    status: "found",
    run,
    events: [
      {
        runId: "run",
        sequence: "3",
        event: { type: "attempt", receipt: complete },
      },
    ],
  };
  expect(readAttempt(stored, "run", "cell")).toMatchObject(complete);
  expect(() => readAttempt(stored, "different-run", "cell")).toThrow(
    "Notebook run identity changed",
  );
  const page = {
    status: "ready",
    page: 1,
    rows: [[{ type: "integer", value: "42" }]],
    manifest: {
      status: "complete",
      rowCount: "1",
      fields: [
        { fieldId: "value", name: "value", type: "integer", nullable: false },
      ],
      result: {
        resultId: "result",
        snapshot: ref,
        producer: { ...attempt, exportId: "export" },
        inputRevision: "2",
        dependencyFingerprint: dependencyFingerprint(
          run.plan.dependencyResultIds,
        ),
        kernelGeneration: "1",
        sourceGeneration: null,
      },
    },
  };
  expect(readCompletedResultPage(page, 1, "1", "result")).toEqual(page);
  expect(() => readCompletedResultPage(page, 1, "1", "other")).toThrow(
    "Result identity or complete row count changed",
  );
});

it("publishes only the ready accepted preview and its manifest revision", async () => {
  const release = {
    releaseId: "release",
    releaseNumber: "1",
    head: draftHead,
    manifestId,
    publishedAt: "2026-11-18T00:00:00Z",
    appHref: "/app/project",
    releaseHref: "/app/project/release",
  };
  const action = vi.fn(async (name: string) => {
    switch (name) {
      case "get-project":
        return { project };
      case "create-project-publish-preview":
        return previewReceipt;
      case "get-project-publish-preview":
        return { ...previewDetail, state: "ready", outputs: [] };
      case "publish-project":
        return release;
      default:
        throw new Error(`Unexpected action ${name}`);
    }
  });
  await expect(publishFixture(action, projectId)).resolves.toEqual(release);
  expect(action).toHaveBeenNthCalledWith(
    2,
    "create-project-publish-preview",
    {
      projectId,
      expectedHead: draftHead,
      expectedReleaseId: null,
      requestId: expect.any(String),
    },
    "POST",
  );
  expect(action).toHaveBeenNthCalledWith(
    4,
    "publish-project",
    expect.objectContaining({
      projectId,
      expectedHead: draftHead,
      expectedReleaseId: null,
      previewId,
      expectedManifestRevision: manifestRevision,
      mode: "ready",
    }),
    "POST",
  );
});

it("stops reading after a queued preview fails and never publishes its output", async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({ project })
    .mockResolvedValueOnce(previewReceipt)
    .mockResolvedValueOnce({ ...previewDetail, outputs: [] })
    .mockResolvedValueOnce({
      ...previewDetail,
      state: "failed",
      outputs: [
        {
          cellId: "cell",
          state: "failed",
          resultId: null,
          diagnosticId: "attempt",
        },
      ],
    })
    .mockRejectedValue(
      new Error("Unexpected poll or publish after terminal result"),
    );
  await expect(publishFixture(action, projectId)).rejects.toThrow(
    "Publish preview failed (1 failed, 0 missing)",
  );
  expect(action.mock.calls.map(([name]) => name)).toEqual([
    "get-project",
    "create-project-publish-preview",
    "get-project-publish-preview",
    "get-project-publish-preview",
  ]);
});
