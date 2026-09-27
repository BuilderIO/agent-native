// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StorageStatus = {
  data?: { configured: boolean };
  isError: boolean;
  isSuccess: boolean;
};

const storageMocks = vi.hoisted(() => ({
  status: null as unknown as StorageStatus,
  refetch: vi.fn<
    () => Promise<{
      isError: boolean;
      data?: { configured?: unknown };
    }>
  >(),
  upload: vi.fn<(formData: FormData) => void>(),
  open: false,
  retry: null as (() => void) | null,
  dismiss: null as (() => void) | null,
  setup: null as (() => void) | null,
}));

vi.mock("../uploads/use-file-upload-status.js", () => ({
  useFileUploadStatus: () => ({
    ...storageMocks.status,
    refetch: storageMocks.refetch,
  }),
}));
vi.mock("../uploads/use-upload-resource.js", () => ({
  useUploadResource: () => ({ mutate: storageMocks.upload }),
}));
vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgId: "org-test", role: "member" } }),
}));
vi.mock("../i18n.js", () => ({ useT: () => (key: string) => key }));
vi.mock("./use-resources.js", () => ({
  useResourceTree: () => ({ data: [], isLoading: false }),
  useResource: () => ({ data: undefined, isError: false }),
  useCreateResource: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateResource: () => ({ mutate: vi.fn() }),
  useDeleteResource: () => ({ isPending: false, mutate: vi.fn() }),
  useExportResourcePack: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useImportResourcePack: () => ({ isPending: false, mutateAsync: vi.fn() }),
  resourceDownloadUrl: (id: string) => id,
  withMcpServersFolder: (tree: unknown[]) => tree,
  withAgentScratchFolder: (tree: unknown[]) => tree,
}));
vi.mock("./use-mcp-servers.js", () => ({
  useMcpServers: () => ({ data: undefined }),
  useCreateMcpServer: () => ({ mutateAsync: vi.fn() }),
  useDeleteMcpServer: () => ({ isPending: false, mutate: vi.fn() }),
  parseMcpVirtualId: () => null,
}));
vi.mock("./use-builtin-capabilities.js", () => ({
  useBuiltinCapabilities: () => ({ data: undefined }),
  parseMcpBuiltinVirtualId: () => null,
}));
vi.mock("./ResourceTree.js", () => ({ ResourceTree: () => null }));
vi.mock("../FileStorageSetupPopover.js", () => ({
  FileStorageSetupPopover: ({
    open,
    onOpenChange,
    onRetry,
  }: {
    open: boolean;
    onOpenChange: (open: boolean, reason?: string) => void;
    onRetry?: () => void;
  }) => {
    storageMocks.open = open;
    if (open) {
      storageMocks.retry = onRetry ?? null;
      storageMocks.dismiss = () => onOpenChange(false, "dismiss");
      storageMocks.setup = () => onOpenChange(false, "setup");
    }
    return null;
  },
}));

import {
  canUploadResourceFile,
  filterResourceTree,
  hasAvailableMcpIntegrations,
  mergePendingResourceUploads,
  normalizeResourceFileName,
  resolveInitialResourceScope,
  resolveResourceCreateMenuMode,
  shouldClearPendingResourceUploads,
  resourcePackImportToast,
  resourcePackPrefixForView,
  shouldRenderResourceSectionCreateMenu,
  takePendingResourceUploads,
  ResourcesPanel,
} from "./ResourcesPanel.js";
import type { TreeNode } from "./use-resources.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveInitialResourceScope", () => {
  it("preserves an explicitly requested organization scope for read-only members", () => {
    expect(resolveInitialResourceScope("shared", false)).toBe("shared");
  });

  it("keeps the existing fallback when the panel has no requested scope", () => {
    expect(resolveInitialResourceScope(undefined, false)).toBe("personal");
    expect(resolveInitialResourceScope(undefined, true)).toBe("shared");
  });
});

describe("hasAvailableMcpIntegrations", () => {
  it("keeps custom MCP setup available when ejected presets are disabled", () => {
    vi.stubGlobal("__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__", {
      enabled: true,
      defaults: { enabled: false },
      custom: true,
    });

    expect(hasAvailableMcpIntegrations([])).toBe(true);
    expect(
      resolveResourceCreateMenuMode(
        "shared",
        false,
        undefined,
        hasAvailableMcpIntegrations([]),
      ),
    ).toBe("personal-mcp");
  });

  it("hides MCP setup when neither presets nor custom servers are available", () => {
    vi.stubGlobal("__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__", {
      enabled: true,
      defaults: { enabled: false },
      custom: false,
    });

    expect(hasAvailableMcpIntegrations([])).toBe(false);
  });
});

describe("resolveResourceCreateMenuMode", () => {
  it("keeps only personal MCP connections available to members in shared resource views", () => {
    expect(
      resolveResourceCreateMenuMode("shared", false, undefined, true),
    ).toBe("personal-mcp");
    expect(resolveResourceCreateMenuMode("shared", false, "files", true)).toBe(
      "personal-mcp",
    );
  });

  it("hides the exception in filtered resource views and without integrations", () => {
    expect(resolveResourceCreateMenuMode("shared", false, "agents", true)).toBe(
      "hidden",
    );
    expect(
      resolveResourceCreateMenuMode("shared", false, undefined, false),
    ).toBe("hidden");
  });

  it("keeps full creation available in personal scope and to organization admins", () => {
    expect(
      resolveResourceCreateMenuMode("personal", false, undefined, true),
    ).toBe("full");
    expect(resolveResourceCreateMenuMode("shared", true, undefined, true)).toBe(
      "full",
    );
  });
});

describe("shouldRenderResourceSectionCreateMenu", () => {
  it("does not put a personal MCP action under the read-only Organization heading", () => {
    expect(
      shouldRenderResourceSectionCreateMenu("personal-mcp", undefined),
    ).toBe(false);
    expect(shouldRenderResourceSectionCreateMenu("personal-mcp", "files")).toBe(
      false,
    );
  });

  it("keeps collection-specific section actions for editable agent and skill trees", () => {
    expect(shouldRenderResourceSectionCreateMenu("full", "agents")).toBe(true);
    expect(shouldRenderResourceSectionCreateMenu("full", "skills")).toBe(true);
    expect(shouldRenderResourceSectionCreateMenu("full", undefined)).toBe(
      false,
    );
  });
});

describe("normalizeResourceFileName", () => {
  it("adds a Markdown extension when the file name has no extension", () => {
    expect(normalizeResourceFileName("notes")).toBe("notes.md");
    expect(normalizeResourceFileName("research/ideas")).toBe(
      "research/ideas.md",
    );
  });

  it("preserves nested names that already include an extension", () => {
    expect(normalizeResourceFileName("foo/bar.whatever")).toBe(
      "foo/bar.whatever",
    );
    expect(normalizeResourceFileName("config/.env")).toBe("config/.env");
  });

  it("trims input and rejects blank or folder-only names", () => {
    expect(normalizeResourceFileName("  notes.txt  ")).toBe("notes.txt");
    expect(normalizeResourceFileName("   ")).toBe("");
    expect(normalizeResourceFileName("notes/")).toBe("");
  });
});

describe("canUploadResourceFile", () => {
  it("keeps text and JSON resource uploads available without object storage", () => {
    expect(canUploadResourceFile("text/markdown", false)).toBe(true);
    expect(canUploadResourceFile("application/json", false)).toBe(true);
  });

  it("requires configured storage for binary files and unknown MIME types", () => {
    expect(canUploadResourceFile("image/png", false)).toBe(false);
    expect(canUploadResourceFile("", false)).toBe(false);
    expect(canUploadResourceFile("image/png", true)).toBe(true);
  });
});

describe("mergePendingResourceUploads", () => {
  it("replaces a queued file for the same resource path and keeps other scopes", () => {
    const first = new File(["first"], "notes.bin", { lastModified: 1 });
    const latest = new File(["latest"], "notes.bin", { lastModified: 2 });
    const pending = [{ file: first, targetScope: "personal" as const }];

    expect(
      mergePendingResourceUploads(pending, [
        { file: latest, targetScope: "personal" },
        { file: first, targetScope: "shared" },
      ]),
    ).toEqual([
      { file: latest, targetScope: "personal" },
      { file: first, targetScope: "shared" },
    ]);
  });
});

describe("takePendingResourceUploads", () => {
  it("keeps a failed probe batch for retry and consumes it once on a valid status", () => {
    const batch = [
      {
        file: new File(["notes"], "notes.md", { type: "text/markdown" }),
        targetScope: "personal" as const,
      },
      {
        file: new File(["image"], "image.png", { type: "image/png" }),
        targetScope: "shared" as const,
      },
    ];
    const pending = mergePendingResourceUploads([], batch);

    expect(takePendingResourceUploads(pending, { isError: true })).toBeNull();
    expect(pending).toEqual(batch);

    const retry = takePendingResourceUploads(pending, {
      isError: false,
      data: { configured: false },
    });
    expect(retry).toEqual({ uploads: batch, storageConfigured: false });
    expect(pending).toEqual([]);
    expect(
      canUploadResourceFile("text/markdown", retry!.storageConfigured),
    ).toBe(true);
    expect(canUploadResourceFile("image/png", retry!.storageConfigured)).toBe(
      false,
    );
    expect(
      takePendingResourceUploads(pending, {
        isError: false,
        data: { configured: false },
      }),
    ).toEqual({ uploads: [], storageConfigured: false });
  });
});

describe("shouldClearPendingResourceUploads", () => {
  it("discards only when the user dismisses the storage popover", () => {
    expect(shouldClearPendingResourceUploads(false, "dismiss")).toBe(true);
    expect(shouldClearPendingResourceUploads(false, "setup")).toBe(false);
    expect(shouldClearPendingResourceUploads(false, "connected")).toBe(false);
    expect(shouldClearPendingResourceUploads(true, "dismiss")).toBe(false);
  });
});

describe("filterResourceTree", () => {
  const resource = (path: string) => ({
    id: path,
    path,
    owner: "owner",
    mimeType: "text/markdown",
    size: 10,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "user" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  });
  const file = (path: string, kind?: TreeNode["kind"]): TreeNode => ({
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
    ...(kind ? { kind } : {}),
    resource: resource(path),
  });
  const folder = (path: string, children: TreeNode[]): TreeNode => ({
    name: path,
    path,
    type: "folder",
    children,
  });
  const tree: TreeNode[] = [
    file("notes.md"),
    file("AGENTS.md"),
    file("LEARNINGS.md"),
    folder("memory", [file("memory/MEMORY.md")]),
    folder("agents", [
      file("agents/designer.md", "agent"),
      file("agents/researcher.json", "remote-agent"),
    ]),
    folder("skills", [file("skills/review/SKILL.md", "skill")]),
    folder("remote-agents", [
      file("remote-agents/researcher.json", "remote-agent"),
    ]),
  ];

  it("keeps plain files out of special resource collections", () => {
    const result = filterResourceTree(tree, "files");
    expect(result.map((node) => node.path)).toEqual(["notes.md"]);
  });

  it("keeps custom agents separate from remote agent manifests", () => {
    expect(filterResourceTree(tree, "agents")).toEqual([
      expect.objectContaining({
        path: "agents",
        children: [expect.objectContaining({ path: "agents/designer.md" })],
      }),
    ]);
    expect(filterResourceTree(tree, "remote-agents")).toEqual([
      expect.objectContaining({
        path: "agents",
        children: [expect.objectContaining({ path: "agents/researcher.json" })],
      }),
      expect.objectContaining({
        path: "remote-agents",
        children: [
          expect.objectContaining({ path: "remote-agents/researcher.json" }),
        ],
      }),
    ]);
  });

  it("selects memory, skills, instructions, and learnings by their meaning", () => {
    expect(filterResourceTree(tree, "memory")[0]?.path).toBe("memory");
    expect(filterResourceTree(tree, "skills")[0]?.path).toBe("skills");
    expect(filterResourceTree(tree, "instructions")[0]?.path).toBe("AGENTS.md");
    expect(filterResourceTree(tree, "learnings")[0]?.path).toBe("LEARNINGS.md");
  });
});

describe("ResourcesPanel storage retries", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    storageMocks.status = { isError: true, isSuccess: false };
    storageMocks.refetch.mockReset();
    storageMocks.upload.mockReset();
    storageMocks.open = false;
    storageMocks.retry = null;
    storageMocks.dismiss = null;
    storageMocks.setup = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  function renderPanel() {
    act(() =>
      root.render(
        createElement(ResourcesPanel, {
          scope: "personal",
          showOnlyRequestedScope: true,
          resourceFilter: "instructions",
          showMcpServers: false,
        }),
      ),
    );
  }

  async function chooseFile(file: File) {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not rendered");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("retries queued uploads once and drops them on dismissal", async () => {
    storageMocks.refetch
      .mockResolvedValueOnce({ isError: true })
      .mockResolvedValueOnce({ isError: false, data: { configured: true } })
      .mockResolvedValueOnce({ isError: true });
    renderPanel();
    await chooseFile(new File(["image"], "image.png", { type: "image/png" }));

    expect(storageMocks.upload).not.toHaveBeenCalled();
    expect(storageMocks.retry).not.toBeNull();
    act(() => storageMocks.retry?.());
    storageMocks.status = {
      data: { configured: true },
      isError: false,
      isSuccess: true,
    };
    renderPanel();

    expect(storageMocks.refetch).toHaveBeenCalledTimes(2);
    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
    expect(
      (storageMocks.upload.mock.calls[0]?.[0].get("file") as File).name,
    ).toBe("image.png");

    storageMocks.status = { isError: true, isSuccess: false };
    renderPanel();
    await chooseFile(new File(["image"], "image.png", { type: "image/png" }));
    expect(storageMocks.dismiss).not.toBeNull();
    act(() => storageMocks.dismiss?.());
    storageMocks.status = {
      data: { configured: true },
      isError: false,
      isSuccess: true,
    };
    renderPanel();

    expect(storageMocks.refetch).toHaveBeenCalledTimes(3);
    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
  });

  it("does not queue a batch after a successful status probe", async () => {
    storageMocks.refetch
      .mockResolvedValueOnce({ isError: false, data: { configured: true } })
      .mockResolvedValueOnce({ isError: true })
      .mockResolvedValueOnce({ isError: false, data: { configured: true } });
    renderPanel();
    await chooseFile(
      new File(["success"], "success.png", { type: "image/png" }),
    );
    expect(storageMocks.upload).toHaveBeenCalledTimes(1);

    storageMocks.status = { isError: true, isSuccess: false };
    renderPanel();
    await chooseFile(new File(["retry"], "retry.png", { type: "image/png" }));
    act(() => storageMocks.retry?.());
    storageMocks.status = {
      data: { configured: true },
      isError: false,
      isSuccess: true,
    };
    renderPanel();

    expect(storageMocks.upload).toHaveBeenCalledTimes(2);
    expect(
      storageMocks.upload.mock.calls.map(
        ([formData]) => (formData.get("file") as File).name,
      ),
    ).toEqual(["success.png", "retry.png"]);
  });

  it("flushes an earlier failed batch when a later probe succeeds", async () => {
    storageMocks.refetch
      .mockResolvedValueOnce({ isError: true })
      .mockResolvedValueOnce({ isError: false, data: { configured: true } });
    renderPanel();
    await chooseFile(
      new File(["earlier"], "earlier.png", { type: "image/png" }),
    );
    await chooseFile(new File(["later"], "later.png", { type: "image/png" }));

    expect(storageMocks.upload).toHaveBeenCalledTimes(2);
    expect(
      storageMocks.upload.mock.calls.map(
        ([formData]) => (formData.get("file") as File).name,
      ),
    ).toEqual(["earlier.png", "later.png"]);
  });

  it("ignores an older probe after a later probe uploads both batches", async () => {
    let rejectEarlierProbe!: (error: Error) => void;
    let resolveLaterProbe!: (result: {
      isError: boolean;
      data?: { configured?: unknown };
    }) => void;
    storageMocks.refetch
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectEarlierProbe = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLaterProbe = resolve;
          }),
      );
    renderPanel();
    await chooseFile(
      new File(["earlier"], "earlier.png", { type: "image/png" }),
    );
    await chooseFile(new File(["later"], "later.png", { type: "image/png" }));

    await act(async () => {
      resolveLaterProbe({ isError: false, data: { configured: true } });
      storageMocks.status = {
        data: { configured: true },
        isError: false,
        isSuccess: true,
      };
      await Promise.resolve();
    });
    expect(storageMocks.upload).toHaveBeenCalledTimes(2);
    expect(storageMocks.open).toBe(false);

    await act(async () => {
      rejectEarlierProbe(new Error("probe failed"));
      await Promise.resolve();
    });
    renderPanel();

    expect(storageMocks.upload).toHaveBeenCalledTimes(2);
    expect(storageMocks.open).toBe(false);
  });

  it("resumes queued uploads after storage is configured in settings", async () => {
    storageMocks.refetch.mockResolvedValueOnce({ isError: true });
    renderPanel();
    await chooseFile(new File(["notes"], "notes.png", { type: "image/png" }));
    expect(storageMocks.upload).not.toHaveBeenCalled();

    storageMocks.status = {
      data: { configured: true },
      isError: false,
      isSuccess: true,
    };
    act(() => {
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    });
    renderPanel();

    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
    expect(
      (storageMocks.upload.mock.calls[0]?.[0].get("file") as File).name,
    ).toBe("notes.png");
  });

  it("invalidates in-flight probes when custom setup opens and keeps their files", async () => {
    let resolveProbe!: (result: {
      isError: boolean;
      data?: { configured?: unknown };
    }) => void;
    storageMocks.refetch
      .mockResolvedValueOnce({ isError: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveProbe = resolve;
          }),
      );
    renderPanel();
    await chooseFile(new File(["queued"], "queued.png", { type: "image/png" }));
    await chooseFile(
      new File(["inflight"], "inflight.png", { type: "image/png" }),
    );
    act(() => storageMocks.setup?.());

    await act(async () => {
      resolveProbe({ isError: true });
      await Promise.resolve();
    });
    renderPanel();
    expect(storageMocks.upload).not.toHaveBeenCalled();

    storageMocks.status = {
      data: { configured: true },
      isError: false,
      isSuccess: true,
    };
    act(() => {
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    });
    renderPanel();

    expect(storageMocks.upload).toHaveBeenCalledTimes(2);
    expect(
      storageMocks.upload.mock.calls.map(
        ([formData]) => (formData.get("file") as File).name,
      ),
    ).toEqual(["queued.png", "inflight.png"]);
  });

  it("ignores an upload probe after its attempt was dismissed", async () => {
    let resolveDismissedProbe!: (result: {
      isError: boolean;
      data?: { configured?: unknown };
    }) => void;
    let resolveCurrentProbe!: (result: {
      isError: boolean;
      data?: { configured?: unknown };
    }) => void;
    storageMocks.refetch
      .mockResolvedValueOnce({ isError: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDismissedProbe = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCurrentProbe = resolve;
          }),
      );
    renderPanel();
    await chooseFile(new File(["old"], "old.png", { type: "image/png" }));
    await chooseFile(
      new File(["dismissed"], "dismissed.png", { type: "image/png" }),
    );
    act(() => storageMocks.dismiss?.());
    await chooseFile(
      new File(["current"], "current.png", { type: "image/png" }),
    );

    await act(async () => {
      resolveDismissedProbe({ isError: false, data: { configured: true } });
      storageMocks.status = {
        data: { configured: true },
        isError: false,
        isSuccess: true,
      };
      await Promise.resolve();
    });
    renderPanel();
    expect(storageMocks.upload).not.toHaveBeenCalled();

    await act(async () => {
      resolveCurrentProbe({ isError: false, data: { configured: true } });
      await Promise.resolve();
    });

    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
    expect(
      (storageMocks.upload.mock.calls[0]?.[0].get("file") as File).name,
    ).toBe("current.png");
  });
});

describe("resourcePackPrefixForView", () => {
  it("scopes a pack export to the open collection", () => {
    expect(resourcePackPrefixForView("memory")).toBe("memory/");
    expect(resourcePackPrefixForView("skills")).toBe("skills/");
    expect(resourcePackPrefixForView("agents")).toBe("agents/");
    expect(resourcePackPrefixForView("files")).toBeUndefined();
    expect(resourcePackPrefixForView(undefined)).toBeUndefined();
  });
});

describe("resourcePackImportToast", () => {
  function translate(key: string, values?: Record<string, unknown>) {
    if (key === "agentResources.importPackSuccess") {
      return `Imported ${values?.imported} files, skipped ${values?.skipped}`;
    }
    if (key === "agentResources.importPackFailed")
      return "Could not import pack";
    return key;
  }

  it("reports a complete import as success", () => {
    expect(
      resourcePackImportToast(
        { imported: 2, skipped: 1, errors: [] },
        translate,
      ),
    ).toEqual({
      kind: "ok",
      message: "Imported 2 files, skipped 1",
    });
  });

  it("reports per-file failures instead of a success toast", () => {
    const toast = resourcePackImportToast(
      {
        imported: 1,
        skipped: 0,
        errors: [
          { path: "blocked.md", error: "not allowed" },
          { path: "other.md", error: "missing" },
        ],
      },
      translate,
    );

    expect(toast.kind).toBe("err");
    expect(toast.message).toContain("Imported 1 files, skipped 0");
    expect(toast.message).toContain("Could not import pack (2)");
    expect(toast.message).toContain("blocked.md: not allowed");
    expect(toast.message).toContain("other.md: missing");
  });
});
