// @vitest-environment happy-dom

import { sourceContentHash } from "@shared/source-workspace";
import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  assert,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Y from "yjs";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";

import { runPublishCanonicalContent } from "../commands/publish-canonical-content";
import {
  runQueueFileContentSave,
  runSaveFileContent,
  type QueueFileContentSaveArgs,
  type SaveFileContentArgs,
} from "../commands/save-file-content";
import { usePublishActiveSourceContent } from "../effects/publish-active-source-content";
import { prepareCanonicalSourceContent } from "../source-publication";
import type { DesignData, DesignFile } from "../types";
import type { EditorCore } from "./use-editor-core";
import { useEditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}

const mocks = vi.hoisted(() => ({
  design: { current: undefined as unknown },
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@agent-native/core/client/hooks", () => {
  const refetch = async () => ({ isSuccess: true });
  const mutations = new Map<string, unknown>();
  return {
    useActionQuery: (name: string) => ({
      data: name === "get-design" ? mocks.design.current : undefined,
      error: null,
      isError: false,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: 1,
      status: "success",
      refetch,
    }),
    useActionMutation: (name: string) => {
      if (!mutations.has(name)) {
        mutations.set(name, {
          mutate: () => {},
          mutateAsync: async () => ({}),
          isPending: false,
        });
      }
      return mutations.get(name);
    },
    actionErrorMessage: () => undefined,
    callAction: async () => ({}),
    getBrowserTabId: () => "tab-1",
    readClientAppState: async () => null,
    setClientAppState: async () => {},
    useChangeVersion: () => 0,
    useChangeVersions: () => 0,
    useAvatarUrl: () => undefined,
  };
});

vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  useIsMcpDirectoryWidgetWriteEmbed: () => false,
}));

vi.mock("@agent-native/core/client/review", () => {
  const sendReviewThreadToAgent = () => {};
  return {
    useReviewComments: () => ({ data: undefined }),
    useSendReviewThreadToAgent: () => sendReviewThreadToAgent,
  };
});

vi.mock("@agent-native/creative-context/client", () => {
  const lab = {};
  return { useCreativeContextLabState: () => lab };
});

vi.mock("@/hooks/use-agent-generating", () => {
  const generation = {
    generating: false,
    submit: () => {},
    reset: () => {},
    track: () => {},
  };
  return { useAgentGenerating: () => generation };
});

vi.mock("@/hooks/use-annotate-lab", () => {
  const annotateLab = {};
  return { useAnnotateLab: () => annotateLab };
});

vi.mock("@/hooks/use-question-flow", () => {
  const questionFlow = {
    questions: null,
    handleSubmit: () => {},
    handleSkip: () => {},
    retryProviderStatus: () => {},
  };
  return { useQuestionFlow: () => questionFlow };
});

vi.mock("@/lib/design-funnel-tracking", () => ({
  useDesignReadyViewTracking: () => {},
}));

type Access = ReturnType<typeof useEditorGenerationAndAccess>;

const DESIGN_ID = "design-1";
const FILE_ID = "screen-1";
const RAW_CONTENT =
  '<html><body><button data-label="initial">Initial</button></body></html>';
const FILES: DesignFile[] = [
  {
    id: FILE_ID,
    filename: "index.html",
    fileType: "html",
    content: RAW_CONTENT,
    createdAt: null,
    updatedAt: "2026-10-24T00:00:00.000Z",
  },
];

function designData(overrides: Partial<DesignData>): DesignData {
  return {
    id: DESIGN_ID,
    title: "Design",
    updatedAt: "2026-10-24T00:00:00.000Z",
    projectType: "prototype",
    accessRole: "editor",
    files: FILES,
    ...overrides,
  };
}

type Surface = { isSignedIn: boolean; isVisualEditSurface: boolean };

const unmounts: Array<() => Promise<void>> = [];

async function mountAccess(
  surface: Surface,
  design: DesignData,
  useWithAccess?: (access: () => Access) => void,
) {
  const queryClient = new QueryClient();
  const editorHistory = {
    shellInput: null,
    setSelectedLayerIdsState: () => {},
    codeLayerOwnerByNodeIdRef: { current: new Map() },
    overviewSelectedScreenIds: [],
    setOverviewSelectedScreenIds: () => {},
    pendingOverviewScreenSelectionRef: { current: null },
    pendingOverviewLayerSelectionRef: { current: null },
    clearPendingOverviewLayerSelectionTimer: () => {},
    schedulePendingOverviewLayerSelectionClear: () => {},
    latestClipboardMutationContentRef: { current: null },
    explicitOverviewScreenSelectionRef: { current: [] },
    captureCurrentSelection: () => null,
  } as unknown as EditorHistory;
  const viewModeRef = { current: "single" };
  const selectedElementRef = { current: null };
  const editorCore = (next: Surface) =>
    ({
      t: (key: string) => key,
      id: DESIGN_ID,
      session: next.isSignedIn ? { email: "person@example.com" } : null,
      isSignedIn: next.isSignedIn,
      sessionResolved: true,
      reviewPreview: false,
      queryClient,
      shellMode: false,
      isVisualEditSurface: next.isVisualEditSurface,
      readOnlyWidget: false,
      viewMode: "single",
      viewModeRef,
      setSelectedElement: () => {},
      selectedElementRef,
      setPendingVisualEditPublicationFailed: () => {},
      activeFileId: FILE_ID,
      setActiveFileId: () => {},
    }) as unknown as EditorCore;
  const latest: { current: Access | null } = { current: null };
  function Harness({ surface }: { surface: Surface }) {
    latest.current = useEditorGenerationAndAccess({
      editorCore: editorCore(surface),
      editorHistory,
    });
    useWithAccess?.(() => required(latest.current));
    return null;
  }
  mocks.design.current = design;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness surface={surface} />));
  unmounts.push(() =>
    act(async () => root.unmount()).then(() => host.remove()),
  );
  return {
    access: () => required(latest.current),
    queryClient,
    rerender: (next: Surface, nextDesign: DesignData) => {
      mocks.design.current = nextDesign;
      return act(async () => root.render(<Harness surface={next} />));
    },
  };
}

function accessRefusal() {
  return Object.assign(new Error("Forbidden"), { status: 403 });
}

function stored(input: Record<string, unknown>) {
  return {
    updated: true,
    versionHash: sourceContentHash(String(input.content)),
    content: input.content,
  };
}

// Wires the hook's own refs and pending-content bookkeeping into the real
// publish, queue and save commands, the way useEditorFilesAndSaving does.
function sourceSync(
  access: () => Access,
  queryClient: QueryClient,
  updateFile: (input: Record<string, unknown>) => Promise<unknown>,
) {
  const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
    { current: {} };
  const acknowledgeOutboxEntry = vi.fn(async () => {});
  const journalOutboxEntry = vi.fn(async () => true);
  const createFileSaveOutboxEntry = (
    pending: FileContentSaveRequest,
  ): DesignSaveOutboxEntry => ({
    key: `${DESIGN_ID}:${pending.id}:update-file`,
    designId: DESIGN_ID,
    actorScope: "user-1",
    actionName: "update-file",
    resourceId: pending.id,
    operationSource: pending.operationSource,
    operationRevision: pending.operationRevision,
    payload: { id: pending.id, content: pending.content },
    updatedAt: 1,
  });
  const updateFileMutation = { mutateAsync: vi.fn(updateFile) };
  const markPendingLocalFileContent: SaveFileContentArgs["markPendingLocalFileContent"] =
    (...args) => access().markPendingLocalFileContent(...args);
  const saveArgs: SaveFileContentArgs = {
    acknowledgeOutboxEntry,
    canEditDesignRef: access().canEditDesignRef,
    createFileSaveOutboxEntry,
    designId: DESIGN_ID,
    fileSaveChainsRef: { current: {} },
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    rollbackPendingLocalFileContent: (...args) =>
      access().rollbackPendingLocalFileContent(...args),
    markPendingLocalFileContent,
    queryClient,
    setPatchProof: () => {},
    t: (key) => key,
    updateFileMutation:
      updateFileMutation as unknown as SaveFileContentArgs["updateFileMutation"],
    warnChangesWillRetry: () => {},
  };
  const completions: Array<Promise<unknown> | void> = [];
  const queueArgs: QueueFileContentSaveArgs = {
    canEditDesignRef: access().canEditDesignRef,
    createFileSaveOutboxEntry,
    fileSaveOperationRevisionRef: { current: {} },
    fileSaveOutboxJournalPromisesRef: { current: new WeakMap() },
    fileSaveTimersRef: { current: {} },
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    markPendingLocalFileContent,
    operationSource: "tab-1",
    pendingFileSavesRef: { current: {} },
    saveFileContent: (pending, journalPromise, onPersistedContent) =>
      runSaveFileContent(saveArgs, pending, journalPromise, onPersistedContent),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (timerId) => window.clearTimeout(timerId),
  };
  const settle = () =>
    act(async () => {
      await Promise.all(completions);
    });
  const publishCanonicalContent = (
    fileId: string,
    sourceContent: string,
    fileType?: string,
  ) =>
    runPublishCanonicalContent(
      {
        canEditDesignRef: access().canEditDesignRef,
        canPersistDesignSourceRef: access().canPersistDesignSourceRef,
        pendingLocalFileContentsRef: access().pendingLocalFileContentsRef,
        cancelIdentityMigration: () => {},
        queueFileContentSave: (fileId, content, options) => {
          completions.push(
            runQueueFileContentSave(queueArgs, fileId, content, options),
          );
        },
      },
      fileId,
      sourceContent,
      fileType,
    );
  return {
    acknowledgeOutboxEntry,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    updateFileMutation,
    settle,
    publishCanonicalContent,
    publish: async () => {
      let canonical = "";
      await act(async () => {
        canonical = publishCanonicalContent(FILE_ID, RAW_CONTENT, "html");
      });
      await settle();
      return canonical;
    },
    saveUserEdit: async (content: string) => {
      await act(async () => {
        completions.push(
          runQueueFileContentSave(queueArgs, FILE_ID, content, {
            expectedVersionHash: "user-edit-base",
            immediate: true,
          }),
        );
      });
      await settle();
    },
  };
}

const VISUAL_EDIT_SIGNED_IN: Surface = {
  isSignedIn: true,
  isVisualEditSurface: true,
};

describe("automatic canonical source persistence", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    for (const fn of Object.values(mocks.toast)) fn.mockClear();
  });

  afterEach(async () => {
    while (unmounts.length) await required(unmounts.pop())();
  });

  it("syncs on a Visual Edit link when the account itself can edit", async () => {
    const { access, queryClient } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: true }),
    );
    const sync = sourceSync(access, queryClient, async (input) => ({
      updated: true,
      versionHash: "persisted",
      content: input.content,
    }));

    await sync.publish();

    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: FILE_ID,
        identityOnly: true,
        content: expect.stringContaining("data-agent-native-node-id"),
      }),
    );
  });

  it("keeps canonical content in memory without syncing when only the link can edit", async () => {
    const { access, queryClient } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: false }),
    );
    const sync = sourceSync(access, queryClient, async () => ({}));

    const canonical = await sync.publish();

    expect(access().canEditDesign).toBe(true);
    expect(access().canPersistDesignSourceRef.current).toBe(false);
    expect(canonical).toContain("data-agent-native-node-id");
    expect(sync.updateFileMutation.mutateAsync).not.toHaveBeenCalled();
    expect(sync.journalOutboxEntry).not.toHaveBeenCalled();
    expect(access().pendingLocalFileContentsRef.current.size).toBe(0);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("starts syncing when a refetch grants account access with the same files", async () => {
    const { access, queryClient, rerender } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: false }),
    );
    expect(access().canPersistDesignSourceRef.current).toBe(false);

    await rerender(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: true }),
    );

    expect(access().design?.files).toBe(FILES);
    expect(access().canPersistDesignSourceRef.current).toBe(true);
    const sync = sourceSync(access, queryClient, async (input) => ({
      updated: true,
      versionHash: "persisted",
      content: input.content,
    }));
    await sync.publish();
    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    { surface: VISUAL_EDIT_SIGNED_IN, persists: false },
    {
      surface: { isSignedIn: true, isVisualEditSurface: false },
      persists: true,
    },
  ])(
    "treats a missing flag as $persists on visualEdit=$surface.isVisualEditSurface",
    async ({ surface, persists }) => {
      const { access } = await mountAccess(surface, designData({}));

      expect(access().canEditDesign).toBe(true);
      expect(access().canPersistDesignSourceRef.current).toBe(persists);
    },
  );

  it("drops a refused automatic sync quietly and does not queue it again", async () => {
    const { access, queryClient } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: true }),
    );
    const sync = sourceSync(access, queryClient, async () => {
      throw accessRefusal();
    });

    const canonical = await sync.publish();

    expect(canonical).toContain("data-agent-native-node-id");
    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(sync.acknowledgeOutboxEntry).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: FILE_ID }),
    );
    expect(sync.latestFileSaveForUnloadRef.current[FILE_ID]).toBeUndefined();
    expect(mocks.toast.error).not.toHaveBeenCalled();

    await sync.publish();

    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("syncs a refused automatic migration once account access returns", async () => {
    const { access, queryClient, rerender } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: true }),
    );
    let refuse = true;
    const sync = sourceSync(access, queryClient, async (input) => {
      if (refuse) throw accessRefusal();
      return stored(input);
    });
    const userEdit = "<html><body>Other screen edit</body></html>";
    await act(async () => {
      access().markPendingLocalFileContent("screen-2", userEdit);
    });

    await sync.publish();
    await rerender(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: false }),
    );
    await sync.publish();
    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(1);

    refuse = false;
    await rerender(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: true }),
    );
    await sync.publish();
    await sync.publish();

    expect(access().design?.files).toBe(FILES);
    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(sync.updateFileMutation.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: FILE_ID, identityOnly: true }),
    );
    expect(
      access().pendingLocalFileContentsRef.current.get("screen-2")?.content,
    ).toBe(userEdit);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("publishes the active synced screen's raw text when account access arrives", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, RAW_CONTENT);
    const canonical = prepareCanonicalSourceContent(RAW_CONTENT, {
      fileId: FILE_ID,
      fileType: "html",
    }).content;
    let sync: ReturnType<typeof sourceSync> | undefined;
    function useActiveScreen(access: () => Access) {
      sync ??= sourceSync(access, new QueryClient(), async (input) =>
        stored(input),
      );
      usePublishActiveSourceContent({
        activeFile: FILES[0],
        activeContent: canonical,
        rawActiveContent: canonical,
        canEditDesign: access().canEditDesign,
        canPersistDesignSource: access().canPersistDesignSource,
        isSynced: true,
        publishCanonicalContent: sync.publishCanonicalContent,
        ydoc: doc,
      });
    }
    const { rerender } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: false }),
      useActiveScreen,
    );
    await required(sync).settle();
    expect(
      required(sync).updateFileMutation.mutateAsync,
    ).not.toHaveBeenCalled();

    await rerender(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: true }),
    );
    await required(sync).settle();

    expect(required(sync).updateFileMutation.mutateAsync).toHaveBeenCalledTimes(
      1,
    );
    expect(required(sync).updateFileMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: FILE_ID,
        identityOnly: true,
        content: canonical,
        expectedVersionHash: sourceContentHash(RAW_CONTENT),
      }),
    );
  });

  it("still reports a refused user edit", async () => {
    const { access, queryClient } = await mountAccess(
      VISUAL_EDIT_SIGNED_IN,
      designData({ canPersistSource: false }),
    );
    const sync = sourceSync(access, queryClient, async () => {
      throw accessRefusal();
    });

    await sync.saveUserEdit("<html><body>Edited</body></html>");

    expect(sync.updateFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(sync.acknowledgeOutboxEntry).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
  });
});
