import { beforeEach, describe, expect, it, vi } from "vitest";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const TAB_ID = "test-tab";
const DESIGN_ID = "design-test";

const mocks = vi.hoisted(() => ({
  states: new Map<string, unknown>(),
  classifyNavigation: vi.fn(() => "matching"),
  readVersion: vi.fn(async () => ({
    versionHash: "source-v1",
    content: "<html></html>",
  })),
  read: vi.fn(async (key: string) => mocks.states.get(key) ?? null),
  save: vi.fn(async (key: string, current: unknown, next: unknown) => {
    if (
      JSON.stringify(mocks.states.get(key) ?? null) !== JSON.stringify(current)
    )
      return false;
    mocks.states.set(key, next);
    return true;
  }),
  saveMany: vi.fn(
    async (
      operations: Array<{
        key: string;
        expectedValue: unknown;
        nextValue: unknown;
      }>,
    ) => {
      if (
        operations.some(
          ({ key, expectedValue }) =>
            JSON.stringify(mocks.states.get(key) ?? null) !==
            JSON.stringify(expectedValue),
        )
      )
        return false;
      for (const { key, nextValue } of operations)
        mocks.states.set(key, nextValue);
      return true;
    },
  ),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, details: object) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mocks.save,
  compareAndSetManyAppState: mocks.saveMany,
  getCurrentRequestBrowserTabId: () => TAB_ID,
  readAppState: mocks.read,
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: vi.fn() }));
vi.mock("../shared/native-effects.js", () => ({
  parseEffectsFromHtml: () => ({
    errors: [],
    document: { instances: [{ enabled: true }] },
  }),
}));
vi.mock("../server/source-workspace.js", () => ({}));
vi.mock("./_native-local-export-server.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./_native-local-export-server.js")>();
  return {
    assertNativeLocalExportEditor: vi.fn(),
    classifyNativeLocalExportNavigation: mocks.classifyNavigation,
    expireNativeLocalExportState: async (state: unknown) => state,
    markNativeLocalExportDocumentReplaced:
      original.markNativeLocalExportDocumentReplaced,
    readNativeLocalExportState: async (designId: string, tabId: string) =>
      mocks.states.get(`native-local-export:${designId}:${tabId}`) ?? null,
    readNativeLocalExportVersion: mocks.readVersion,
    requireNativeLocalExportTabId: () => TAB_ID,
  };
});

import {
  readNativeRenderContextSnapshot,
  registerNativeRenderContext,
} from "./_native-render-contexts";
import claim from "./claim-native-local-export";
import request from "./request-native-local-export";

const requestInput = {
  designId: DESIGN_ID,
  fileId: "file-test",
  expectedVersionHash: "source-v1",
  export: {
    format: "png",
    viewport: { width: 640, height: 480 },
    pixelRatio: 1,
  },
};

function run(action: unknown, args: unknown): Promise<any> {
  return (action as { run(args: unknown): Promise<any> }).run(args);
}

beforeEach(() => {
  mocks.states.clear();
  mocks.classifyNavigation.mockReset();
  mocks.classifyNavigation.mockReturnValue("matching");
  mocks.read.mockClear();
  mocks.save.mockClear();
  mocks.saveMany.mockClear();
  mocks.readVersion.mockReset();
  mocks.readVersion.mockResolvedValue({
    versionHash: "source-v1",
    content: "<html></html>",
  });
  mocks.states.set(`navigation:${TAB_ID}`, {
    view: "editor",
    designId: DESIGN_ID,
  });
});

describe("native local export document ownership", () => {
  it("binds a registered external request and rejects another document before claim", async () => {
    await registerNativeRenderContext(DESIGN_ID, DOCUMENT_ID);
    await expect(
      readNativeRenderContextSnapshot(DESIGN_ID, TAB_ID),
    ).resolves.toMatchObject({
      contexts: [expect.objectContaining({ documentId: DOCUMENT_ID })],
    });

    const created = await run(request, {
      ...requestInput,
      targetTabId: TAB_ID,
    });
    const key = `native-local-export:${DESIGN_ID}:${TAB_ID}`;
    expect(mocks.states.get(key)).toMatchObject({
      requestId: created.requestId,
      targetDocumentId: DOCUMENT_ID,
      status: "pending",
    });
    const savesBeforeWrongClaim = mocks.save.mock.calls.length;
    await expect(
      run(claim, {
        designId: DESIGN_ID,
        requestId: created.requestId,
        documentId: OTHER_DOCUMENT_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_document_replaced" });
    expect(mocks.save).toHaveBeenCalledTimes(savesBeforeWrongClaim);
    expect(mocks.states.get(key)).toMatchObject({ status: "pending" });

    await expect(
      run(claim, {
        designId: DESIGN_ID,
        requestId: created.requestId,
        documentId: DOCUMENT_ID,
      }),
    ).resolves.toMatchObject({
      status: "running",
      targetDocumentId: DOCUMENT_ID,
      ownerDocumentId: DOCUMENT_ID,
    });
  });

  it("binds a request issued within a registered editor tab", async () => {
    await registerNativeRenderContext(DESIGN_ID, DOCUMENT_ID);
    const ledger = mocks.states.get("native-render-contexts-v1") as {
      schemaVersion: 1;
      contexts: Array<{
        tabId: string;
        designId: string;
        documentId?: string;
        expiresAt: number;
      }>;
    };
    mocks.states.set("native-render-contexts-v1", {
      ...ledger,
      contexts: [
        ...ledger.contexts,
        {
          tabId: "other-tab",
          designId: DESIGN_ID,
          expiresAt: Date.now() + 30_000,
        },
      ],
    });
    mocks.read.mockClear();
    const created = await run(request, requestInput);
    expect(
      mocks.states.get(`native-local-export:${DESIGN_ID}:${TAB_ID}`),
    ).toMatchObject({
      requestId: created.requestId,
      targetDocumentId: DOCUMENT_ID,
    });
    expect(mocks.read).not.toHaveBeenCalledWith("navigation:other-tab");
  });

  it("fails when the selected tab's navigation is unreadable", async () => {
    await registerNativeRenderContext(DESIGN_ID, DOCUMENT_ID);
    mocks.classifyNavigation.mockReturnValue("unreadable");
    await expect(
      readNativeRenderContextSnapshot(DESIGN_ID, TAB_ID),
    ).rejects.toMatchObject({ errorCode: "native_export_context_unreadable" });
  });

  it("rejects an external request without a live target context", async () => {
    await expect(
      run(request, { ...requestInput, targetTabId: TAB_ID }),
    ).rejects.toMatchObject({ errorCode: "native_export_context_not_found" });
    expect(mocks.saveMany).not.toHaveBeenCalled();
  });

  it("keeps a legacy context's request claimable without document binding", async () => {
    mocks.states.set("native-render-contexts-v1", {
      schemaVersion: 1,
      contexts: [
        { tabId: TAB_ID, designId: DESIGN_ID, expiresAt: Date.now() + 30_000 },
      ],
    });
    const created = await run(request, {
      ...requestInput,
      targetTabId: TAB_ID,
    });
    const pending = mocks.states.get(
      `native-local-export:${DESIGN_ID}:${TAB_ID}`,
    ) as Record<string, unknown>;
    expect(pending.targetDocumentId).toBeUndefined();
    await expect(
      run(claim, {
        designId: DESIGN_ID,
        requestId: created.requestId,
        documentId: OTHER_DOCUMENT_ID,
      }),
    ).resolves.toMatchObject({
      status: "running",
      ownerDocumentId: OTHER_DOCUMENT_ID,
    });
  });

  it("keeps a local no-context request claimable for older clients", async () => {
    const created = await run(request, requestInput);
    const pending = mocks.states.get(
      `native-local-export:${DESIGN_ID}:${TAB_ID}`,
    ) as Record<string, unknown>;
    expect(pending.targetDocumentId).toBeUndefined();
    await expect(
      run(claim, {
        designId: DESIGN_ID,
        requestId: created.requestId,
        documentId: DOCUMENT_ID,
      }),
    ).resolves.toMatchObject({ status: "running" });
  });

  it("adopts a no-context request on registration and keeps it claimable", async () => {
    const created = await run(request, requestInput);
    const key = `native-local-export:${DESIGN_ID}:${TAB_ID}`;
    expect(mocks.states.get(key)).toMatchObject({ status: "pending" });

    await registerNativeRenderContext(DESIGN_ID, DOCUMENT_ID);
    expect(mocks.states.get(key)).toMatchObject({
      status: "pending",
      targetDocumentId: DOCUMENT_ID,
    });
    await registerNativeRenderContext(DESIGN_ID, DOCUMENT_ID);
    expect(mocks.states.get(key)).toMatchObject({ status: "pending" });

    await expect(
      run(claim, {
        designId: DESIGN_ID,
        requestId: created.requestId,
        documentId: DOCUMENT_ID,
      }),
    ).resolves.toMatchObject({
      status: "running",
      ownerDocumentId: DOCUMENT_ID,
    });
  });

  it("rejects an export when its selected context changes during source preparation", async () => {
    await registerNativeRenderContext(DESIGN_ID, DOCUMENT_ID);
    mocks.readVersion.mockImplementationOnce(async () => {
      mocks.states.set("native-render-contexts-v1", {
        schemaVersion: 1,
        contexts: [
          {
            tabId: TAB_ID,
            designId: DESIGN_ID,
            documentId: OTHER_DOCUMENT_ID,
            expiresAt: Date.now() + 30_000,
          },
        ],
      });
      return { versionHash: "source-v1", content: "<html></html>" };
    });
    await expect(run(request, requestInput)).rejects.toMatchObject({
      errorCode: "native_export_request_conflict",
    });
    expect(
      mocks.states.get(`native-local-export:${DESIGN_ID}:${TAB_ID}`),
    ).toBeUndefined();
  });

  it("does not publish an unbound request over a new registration", async () => {
    mocks.readVersion.mockImplementationOnce(async () => {
      mocks.states.set("native-render-contexts-v1", {
        schemaVersion: 1,
        contexts: [
          {
            tabId: TAB_ID,
            designId: DESIGN_ID,
            documentId: DOCUMENT_ID,
            expiresAt: Date.now() + 30_000,
          },
        ],
      });
      return { versionHash: "source-v1", content: "<html></html>" };
    });
    await expect(run(request, requestInput)).rejects.toMatchObject({
      errorCode: "native_export_request_conflict",
    });
    expect(
      mocks.states.get(`native-local-export:${DESIGN_ID}:${TAB_ID}`),
    ).toBeUndefined();
  });
});
