import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tabId: "tab-1" as string | null,
  navigation: { view: "editor", designId: "design-1" } as Record<
    string,
    unknown
  > | null,
  state: null as Record<string, unknown> | null,
  ledger: null as Record<string, unknown> | null,
  liveVersionHash: "v1",
  content:
    '<html><body><div data-agent-native-node-id="frame-1"></div></body></html>',
  compareAndSetAppState: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  getCurrentRequestBrowserTabId: () => mocks.tabId,
  readAppStateForCurrentTab: async () => mocks.navigation,
  readAppState: async (key: string) =>
    key === "native-render-contexts-v1"
      ? mocks.ledger
      : key.startsWith("navigation:")
        ? mocks.navigation
        : mocks.state,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: async () => ({
    sourceType: "inline",
    files: [{ id: "screen-1", filename: "index.html", fileType: "html" }],
  }),
  loadSelectedSourceWorkspaceFile: async (file: unknown) => file,
  readLiveSourceFile: async () => ({
    versionHash: mocks.liveVersionHash,
    content: mocks.content,
  }),
}));

import cancel from "./cancel-native-local-export.js";
import claim from "./claim-native-local-export.js";
import finish from "./finish-native-local-export.js";
import get from "./get-native-local-export.js";
import getContexts from "./get-native-render-contexts.js";
import registerContext from "./register-native-render-context.js";
import request from "./request-native-local-export.js";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000010";
const OTHER_DOCUMENT_ID = "00000000-0000-4000-8000-000000000011";

const sourceViewport = { width: 1440, height: 3200 };

const exportOptions = {
  format: "png" as const,
  viewport: { width: 640, height: 480 },
  pixelRatio: 1,
};

describe("native local export actions", () => {
  beforeEach(() => {
    mocks.tabId = "tab-1";
    mocks.navigation = { view: "editor", designId: "design-1" };
    mocks.state = null;
    mocks.ledger = null;
    mocks.liveVersionHash = "v1";
    mocks.content =
      '<html><body><div data-agent-native-node-id="frame-1"></div></body></html>';
    mocks.assertAccess.mockReset();
    mocks.compareAndSetAppState.mockReset();
    mocks.compareAndSetAppState.mockImplementation(
      async (key: string, expected: unknown, next: Record<string, unknown>) => {
        const current =
          key === "native-render-contexts-v1" ? mocks.ledger : mocks.state;
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
        if (key === "native-render-contexts-v1") mocks.ledger = next;
        else mocks.state = next;
        return true;
      },
    );
  });

  it("claims one current-tab request and reports only download initiation", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    expect(queued).toMatchObject({ status: "pending", localOnly: true });
    const claimed = await claim.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(claimed.status).toBe("running");
    const completed = await finish.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
      result: { status: "download-initiated" },
    });
    expect(completed).toMatchObject({
      status: "download-initiated",
      localOnly: true,
    });
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({ status: "download-initiated", localOnly: true });
    expect(mocks.state).not.toHaveProperty("content");
    expect(mocks.state).not.toHaveProperty("blob");
  });

  it("pins one unique authored crop through request and claim without storing pixels", async () => {
    const crop = {
      nodeId: "frame-1",
      x: 218,
      y: 2069,
      width: 1162,
      height: 887,
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: {
        format: "png",
        viewport: { width: 1162, height: 887 },
        pixelRatio: 1,
      },
      crop,
      sourceViewport,
    });
    expect(mocks.state).toMatchObject({
      crop,
      sourceViewport,
      status: "pending",
    });
    expect(mocks.state).not.toHaveProperty("html");
    const claimed = await claim.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(claimed).toMatchObject({ crop, sourceViewport, status: "running" });
  });

  it("rejects absent, outside, or density-overflow source viewports without queueing", async () => {
    const crop = { nodeId: "frame-1", x: 0, y: 0, width: 2, height: 2 };
    for (const invalidSource of [
      undefined,
      { width: 1, height: 2 },
      { width: 2049, height: 1024 },
    ]) {
      await expect(
        request.run({
          designId: "design-1",
          fileId: "screen-1",
          expectedVersionHash: "v1",
          crop,
          sourceViewport: invalidSource,
          export: {
            format: "png",
            viewport: { width: 2, height: 2 },
            pixelRatio: 2,
          },
        }),
      ).rejects.toMatchObject({ errorCode: "native_export_crop_unsupported" });
    }
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
    expect(mocks.state).toBeNull();
  });

  it("keeps a legacy pending crop readable and cancelable without inferring a viewport", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    mocks.state = {
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
      crop: { nodeId: "frame-1", x: 0, y: 0, width: 640, height: 480 },
      schemaVersion: 1,
      requestId,
      tabId: "tab-1",
      status: "pending",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    expect(await get.run({ designId: "design-1", requestId })).toMatchObject({
      status: "pending",
    });
    expect(await cancel.run({ designId: "design-1", requestId })).toMatchObject(
      { status: "canceled" },
    );
    expect(mocks.state).not.toHaveProperty("sourceViewport");
  });

  it("recovers an abandoned claim only when a different document registers in the same tab", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    await claim.run({
      designId: "design-1",
      requestId: queued.requestId,
      documentId: DOCUMENT_ID,
    });
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        documentId: OTHER_DOCUMENT_ID,
        result: { status: "download-initiated" },
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_document_replaced" });
    await registerContext.run({
      designId: "design-1",
      documentId: DOCUMENT_ID,
    });
    expect(mocks.state).toMatchObject({
      status: "running",
      ownerDocumentId: DOCUMENT_ID,
    });
    await registerContext.run({
      designId: "design-1",
      documentId: OTHER_DOCUMENT_ID,
    });
    expect(mocks.state).toMatchObject({
      status: "failed",
      ownerDocumentId: DOCUMENT_ID,
      failure: { code: "client-unavailable" },
    });
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        documentId: DOCUMENT_ID,
        result: { status: "download-initiated" },
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_request_not_running" });
    expect(mocks.state).toMatchObject({ status: "failed" });
  });

  it("does not infer an unknown legacy document owner during recovery", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    mocks.state = {
      ...mocks.state,
      status: "running",
      expiresAt: Date.now() + 60_000,
    };
    await registerContext.run({
      designId: "design-1",
      documentId: OTHER_DOCUMENT_ID,
    });
    expect(mocks.state).toMatchObject({
      requestId: queued.requestId,
      status: "running",
    });
    expect(mocks.state).not.toHaveProperty("ownerDocumentId");
  });

  it("refuses a crop node removed after queueing, even when the version lookup is unchanged", async () => {
    const crop = {
      nodeId: "frame-1",
      x: 218,
      y: 2069,
      width: 1162,
      height: 887,
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: {
        format: "png",
        viewport: { width: 1162, height: 887 },
        pixelRatio: 1,
      },
      crop,
      sourceViewport,
    });
    mocks.content =
      '<html><body><div data-agent-native-node-id="other"></div></body></html>';
    await expect(
      claim.run({
        documentId: DOCUMENT_ID,
        designId: "design-1",
        requestId: queued.requestId,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_crop_node_unavailable",
    });
    expect(mocks.state).toMatchObject({ status: "pending", crop });
  });

  it("accepts selected HTML/ZIP while refusing mismatched, stale, missing, and ambiguous crops", async () => {
    const crop = {
      nodeId: "frame-1",
      x: 218,
      y: 2069,
      width: 1162,
      height: 887,
    };
    const base = {
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      crop,
    };
    for (const format of ["html", "zip"] as const) {
      mocks.state = null;
      const queued = await request.run({
        ...base,
        export: {
          format,
          viewport: { width: 1162, height: 887 },
          pixelRatio: 1,
        },
      });
      expect(queued).toMatchObject({ status: "pending", localOnly: true });
      expect(mocks.state).toMatchObject({ crop, export: { format } });
    }
    mocks.state = null;
    await expect(
      request.run({ ...base, export: exportOptions }),
    ).rejects.toMatchObject({ errorCode: "native_export_crop_unsupported" });
    mocks.liveVersionHash = "v2";
    await expect(
      request.run({
        ...base,
        sourceViewport,
        export: {
          format: "png",
          viewport: { width: 1162, height: 887 },
          pixelRatio: 1,
        },
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_source_stale" });
    mocks.liveVersionHash = "v1";
    mocks.content =
      '<html><body><div data-agent-native-node-id="other"></div></body></html>';
    await expect(
      request.run({
        ...base,
        sourceViewport,
        export: {
          format: "png",
          viewport: { width: 1162, height: 887 },
          pixelRatio: 1,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_crop_node_unavailable",
    });
    mocks.content =
      '<div data-agent-native-node-id="frame-1"></div><div data-agent-native-node-id="frame-1"></div>';
    await expect(
      request.run({
        ...base,
        sourceViewport,
        export: {
          format: "png",
          viewport: { width: 1162, height: 887 },
          pixelRatio: 1,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_crop_node_unavailable",
    });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledTimes(2);
  });

  it("queues each image/vector/standalone format as metadata without rendered bytes", async () => {
    for (const format of [
      "jpg",
      "webp",
      "avif",
      "svg",
      "pdf",
      "html",
      "zip",
    ] as const) {
      mocks.state = null;
      const queued = await request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        export: { ...exportOptions, format },
      });
      expect(queued).toMatchObject({ status: "pending", localOnly: true });
      expect(mocks.state).toMatchObject({ export: { format } });
      expect(mocks.state).not.toHaveProperty("blob");
    }
  });

  it("discovers a bounded live editor context and targets it without a caller tab header", async () => {
    const registered = await registerContext.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
    });
    expect(registered.tabId).toBe("tab-1");
    expect(await getContexts.run({ designId: "design-1" })).toMatchObject({
      contexts: [{ tabId: "tab-1", designId: "design-1" }],
    });
    mocks.tabId = null;
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
      targetTabId: "tab-1",
    });
    expect(queued.status).toBe("pending");
    expect(
      await get.run({
        designId: "design-1",
        requestId: queued.requestId,
        targetTabId: "tab-1",
      }),
    ).toMatchObject({ status: "pending" });
    expect(mocks.state).not.toHaveProperty("targetTabId");
  });

  it("does not discover an expired or departed editor context", async () => {
    await registerContext.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
    });
    mocks.ledger = {
      schemaVersion: 1,
      contexts: [
        { tabId: "tab-1", designId: "design-1", expiresAt: Date.now() - 1 },
      ],
    };
    expect(await getContexts.run({ designId: "design-1" })).toMatchObject({
      contexts: [],
    });
    mocks.tabId = null;
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        export: exportOptions,
        targetTabId: "tab-1",
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_context_not_found" });
    mocks.ledger = {
      schemaVersion: 1,
      contexts: [
        {
          tabId: "tab-1",
          designId: "design-1",
          expiresAt: Date.now() + 30_000,
        },
      ],
    };
    mocks.navigation = { view: "list", designId: "design-1" };
    expect(await getContexts.run({ designId: "design-1" })).toMatchObject({
      contexts: [],
    });
  });

  it("rejects a target from another Design and an unreadable context ledger", async () => {
    mocks.tabId = null;
    mocks.ledger = {
      schemaVersion: 1,
      contexts: [
        {
          tabId: "tab-1",
          designId: "design-2",
          expiresAt: Date.now() + 30_000,
        },
      ],
    };
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        export: exportOptions,
        targetTabId: "tab-1",
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_context_not_found" });
    mocks.ledger = { schemaVersion: 1, contexts: "corrupt" };
    await expect(
      getContexts.run({ designId: "design-1" }),
    ).rejects.toMatchObject({
      errorCode: "native_export_context_unreadable",
    });
  });

  it("preserves all eight live contexts when a ninth tab tries to register", async () => {
    const contexts = Array.from({ length: 8 }, (_, index) => ({
      tabId: `tab-${index}`,
      designId: "design-1",
      expiresAt: Date.now() + 30_000,
    }));
    mocks.ledger = { schemaVersion: 1, contexts };
    mocks.tabId = "tab-9";
    await expect(
      registerContext.run({ documentId: DOCUMENT_ID, designId: "design-1" }),
    ).rejects.toMatchObject({ errorCode: "native_export_context_capacity" });
    expect(mocks.ledger).toEqual({ schemaVersion: 1, contexts });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("reports malformed tab navigation as unreadable, not no live editor", async () => {
    mocks.ledger = {
      schemaVersion: 1,
      contexts: [
        {
          tabId: "tab-1",
          designId: "design-1",
          expiresAt: Date.now() + 30_000,
        },
      ],
    };
    mocks.navigation = { view: 42 };
    await expect(
      getContexts.run({ designId: "design-1" }),
    ).rejects.toMatchObject({ errorCode: "native_export_context_unreadable" });
    await expect(
      registerContext.run({ documentId: DOCUMENT_ID, designId: "design-1" }),
    ).rejects.toMatchObject({ errorCode: "native_export_context_unreadable" });
  });

  it("does not disclose context metadata without Design viewer access", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("forbidden"));
    await expect(getContexts.run({ designId: "design-1" })).rejects.toThrow(
      "forbidden",
    );
  });

  it("rejects a source change before claim and leaves a typed failed status", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    mocks.liveVersionHash = "v2";
    await expect(
      claim.run({
        documentId: DOCUMENT_ID,
        designId: "design-1",
        requestId: queued.requestId,
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_source_stale" });
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "failed",
      failure: { code: "source-stale" },
    });
  });

  it("records a pinned download even if the editor changed afterward", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    await claim.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
    });
    mocks.liveVersionHash = "v2";
    await finish.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
      result: { status: "download-initiated" },
    });
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "download-initiated",
    });
  });

  it("requires an actual current browser tab and selected editor", async () => {
    mocks.tabId = null;
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        export: exportOptions,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_local_client_required",
    });
    mocks.tabId = "tab-1";
    mocks.navigation = { view: "list", designId: "design-1" };
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        export: exportOptions,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_local_client_required",
    });
  });

  it("distinguishes a tab that left the editor from a still-pending export", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({ status: "pending" });
    mocks.navigation = { view: "list", designId: "design-1" };
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "expired",
      failure: { code: "editor-left" },
    });
  });

  it("marks absent navigation as unavailable instead of assuming the editor is alive", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    mocks.navigation = null;
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "expired",
      failure: { code: "client-unavailable" },
    });
  });

  it("reports malformed navigation separately from an absent or departed editor", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    mocks.navigation = { view: 42 };
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "expired",
      failure: { code: "navigation-unreadable" },
    });
  });

  it("cancels a pending request before the editor can claim it", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    expect(
      await cancel.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({ status: "canceled", cancelRequested: false });
    await expect(
      claim.run({
        documentId: DOCUMENT_ID,
        designId: "design-1",
        requestId: queued.requestId,
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_request_not_pending" });
  });

  it("requests in-flight cancellation and accepts the browser's cancel acknowledgment", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    await claim.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(
      await cancel.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({ status: "cancel-requested", cancelRequested: true });
    expect(
      await finish.run({
        documentId: DOCUMENT_ID,
        designId: "design-1",
        requestId: queued.requestId,
        result: {
          status: "failed",
          code: "canceled",
          message: "Canceled before download.",
        },
      }),
    ).toMatchObject({ status: "canceled" });
  });

  it("preserves a download that raced with cancellation", async () => {
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: exportOptions,
    });
    await claim.run({
      documentId: DOCUMENT_ID,
      designId: "design-1",
      requestId: queued.requestId,
    });
    await cancel.run({ designId: "design-1", requestId: queued.requestId });
    expect(
      await finish.run({
        documentId: DOCUMENT_ID,
        designId: "design-1",
        requestId: queued.requestId,
        result: { status: "download-initiated" },
      }),
    ).toMatchObject({ status: "download-initiated" });
    expect(
      await cancel.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "download-initiated",
      cancelRequested: false,
    });
  });
});
