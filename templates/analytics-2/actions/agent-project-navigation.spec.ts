import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  createNotebook: vi.fn(),
  updateProject: vi.fn(),
  duplicateProject: vi.fn(),
  requireOwnedProject: vi.fn(),
  requireWritableProject: vi.fn(),
  refreshedProjectDocument: vi.fn(),
  requireCurrentWorkspace: vi.fn(),
  assertPermission: vi.fn(),
  writeAppStateForCurrentTab: vi.fn(),
  getCurrentRequestBrowserTabId: vi.fn(),
  resolveCurrentRequestStateTab: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: mocks.writeAppStateForCurrentTab,
  getCurrentRequestBrowserTabId: mocks.getCurrentRequestBrowserTabId,
  resolveCurrentRequestStateTab: mocks.resolveCurrentRequestStateTab,
  navigateAfterWrite: async (
    navigation: Record<string, unknown>,
    options: { intent?: string },
  ) => {
    if (options.intent !== "open")
      return { navigated: false, reason: "agent-keeps-view" };
    const tab = await mocks.resolveCurrentRequestStateTab();
    if (tab.unavailable || !tab.tabId)
      return { navigated: false, reason: "no-tab" };
    await mocks.writeAppStateForCurrentTab("navigate", navigation);
    return { navigated: true };
  },
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: mocks.requireCurrentWorkspace,
  workspaceAccess: { assertPermission: mocks.assertPermission },
}));
vi.mock("../server/model/projects-store.js", () => ({
  createProject: mocks.createProject,
  updateProject: mocks.updateProject,
  duplicateProject: mocks.duplicateProject,
}));
vi.mock("../server/model/notebook-creation/store.js", () => ({
  createNotebook: mocks.createNotebook,
}));
vi.mock("../server/model/notebook-operations/legacy.js", () => ({
  readLegacyNotebook: vi.fn(),
}));

vi.mock("../server/lib/project-action-access.js", async () => {
  const { z } = await import("zod");
  return {
    projectDocumentResultSchema: z.object({
      project: z.object({ id: z.string() }),
    }),
    requireOwnedProject: mocks.requireOwnedProject,
    requireWritableProject: mocks.requireWritableProject,
    refreshedProjectDocument: mocks.refreshedProjectDocument,
    notebookChangeResource: vi.fn(),
  };
});
vi.mock("../server/model/statuses-store.js", () => ({ listStatuses: vi.fn() }));

import createProject from "./create-project.js";
import duplicateProject from "./duplicate-project.js";
import importProject from "./import-project.js";
import updateProject from "./update-project.js";

const createdReceipt = {
  requestId: "1a1b5691-1be3-46a2-a6f5-94264fa6e299",
  id: "project-1",
  projectId: "project-1",
  workingVersionId: "version-1",
  href: "/project/project-1/latest",
  committedAt: "2026-11-18T12:00:00.000Z",
  snapshot: {
    status: "accepted",
    snapshot: {
      workspaceId: "org-1",
      projectId: "project-1",
      eventSeq: "0",
      head: { versionId: "version-1", revision: "0" },
    },
    metadata: { title: "Analysis", description: "", statusId: null },
    resources: {
      orderRevision: "0",
      metadataRevision: "0",
      inputRevision: "0",
      layoutRevision: "0",
    },
    cells: [],
  },
};

describe("agent project navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireCurrentWorkspace.mockResolvedValue({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
    });
    mocks.assertPermission.mockResolvedValue(undefined);
    mocks.createProject.mockResolvedValue({
      id: "project-1",
      workingVersionId: "version-1",
    });
    mocks.createNotebook.mockResolvedValue(createdReceipt);
    const ownedProject = {
      scope: { ownerEmail: "owner@example.test", orgId: "org-1" },
      project: {
        id: "project-1",
        title: "Project",
        description: "",
        statusId: null,
      },
    };
    mocks.requireOwnedProject.mockResolvedValue(ownedProject);
    mocks.requireWritableProject.mockResolvedValue(ownedProject);
    mocks.updateProject.mockResolvedValue(undefined);
    mocks.duplicateProject.mockResolvedValue({ id: "copy-1" });
    mocks.refreshedProjectDocument.mockResolvedValue({ id: "project-1" });
    mocks.getCurrentRequestBrowserTabId.mockReturnValue("tab-1");
    mocks.resolveCurrentRequestStateTab.mockResolvedValue({
      tabId: "tab-1",
      unavailable: false,
    });
    mocks.writeAppStateForCurrentTab.mockResolvedValue(undefined);
  });

  it("requests navigation only after the agent's project is saved", async () => {
    let completeCreate: (value: typeof createdReceipt) => void = () => {};
    mocks.createNotebook.mockReturnValue(
      new Promise((resolve) => {
        completeCreate = resolve;
      }),
    );
    const pending = createProject.run({ title: "Analysis", intent: "open" }, {
      caller: "tool",
    } as never);
    await vi.waitFor(() => expect(mocks.createNotebook).toHaveBeenCalled());
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
    completeCreate(createdReceipt);
    const result = await pending;
    expect(result).toMatchObject({
      id: "project-1",
      href: "/project/project-1/latest",
      navigation: { status: "requested" },
    });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: "/project/project-1/latest" }),
    );
  });

  // oracle-change: MCP action calls use caller "mcp" (core/mcp/execute-action-call.ts); the create-navigation contract is reported in adhoc-corpus-1117.md:126.
  it.each(["frontend", "cli"] as const)(
    "does not navigate for %s callers",
    async (caller) => {
      const result = await createProject.run({ title: "Analysis" }, {
        caller,
      } as never);
      expect(result).toMatchObject({ id: "project-1" });
      expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
    },
  );

  it("report ADHOC-1117-MCP-CREATE-NAVIGATION: opens a created project in the resolved tab", async () => {
    mocks.getCurrentRequestBrowserTabId.mockReturnValue(null);
    const result = await createProject.run(
      { title: "Analysis", intent: "open" },
      { caller: "mcp", userEmail: "owner@example.test" } as never,
    );
    expect(mocks.assertPermission).toHaveBeenCalledWith(["create-project"], {
      userEmail: "owner@example.test",
      orgId: "org-1",
    });
    expect(mocks.createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.test",
        orgId: "org-1",
      }),
      expect.any(Object),
      expect.any(Function),
      expect.any(Function),
    );
    expect(mocks.resolveCurrentRequestStateTab).toHaveBeenCalled();
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: "/project/project-1/latest" }),
    );
    expect(result).toMatchObject({
      id: "project-1",
      navigation: { status: "requested" },
    });
  });

  it("report ADHOC-1117-MCP-CREATE-NAVIGATION: no target does not write global navigation", async () => {
    mocks.getCurrentRequestBrowserTabId.mockReturnValue(null);
    mocks.resolveCurrentRequestStateTab.mockResolvedValue({
      tabId: null,
      unavailable: true,
    });
    const result = await createProject.run({ intent: "open" }, {
      caller: "mcp",
      userEmail: "owner@example.test",
    } as never);
    expect(result).toMatchObject({
      id: "project-1",
      navigation: { status: "unavailable", reason: "browser_tab_missing" },
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("report ADHOC-1117-MCP-CREATE-NAVIGATION: failed targeting preserves the created project", async () => {
    mocks.resolveCurrentRequestStateTab.mockRejectedValue(
      new Error("lookup unavailable"),
    );
    const result = await createProject.run({ intent: "open" }, {
      caller: "mcp",
      userEmail: "owner@example.test",
    } as never);
    expect(result).toMatchObject({
      id: "project-1",
      navigation: { status: "unavailable", reason: "command_write_failed" },
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("does not navigate after a failed write", async () => {
    mocks.createNotebook.mockRejectedValue(new Error("storage unavailable"));
    await expect(
      createProject.run({}, { caller: "tool" } as never),
    ).rejects.toMatchObject({
      errorCode: "project_create_unreadable",
      statusCode: 503,
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("reports a failed navigation without failing a committed create", async () => {
    mocks.writeAppStateForCurrentTab.mockRejectedValue(
      new Error("state unavailable"),
    );
    const result = await createProject.run({ intent: "open" }, {
      caller: "tool",
    } as never);
    expect(result).toMatchObject({
      id: "project-1",
      navigation: { status: "unavailable", reason: "command_write_failed" },
    });
  });

  it("does not send a global navigation command when the browser tab is absent", async () => {
    mocks.getCurrentRequestBrowserTabId.mockReturnValue(null);
    mocks.resolveCurrentRequestStateTab.mockResolvedValue({
      tabId: null,
      unavailable: false,
    });
    const result = await createProject.run({ intent: "open" }, {
      caller: "tool",
    } as never);
    expect(result).toMatchObject({
      id: "project-1",
      navigation: { status: "unavailable", reason: "browser_tab_missing" },
    });
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });
  it("opens an agent-edited project after the saved document is read back", async () => {
    const result = await updateProject.run(
      { projectId: "project-1", title: "Updated", intent: "open" },
      { caller: "tool" } as never,
    );
    expect(result).toMatchObject({
      project: { id: "project-1" },
      navigation: { status: "requested" },
    });
    expect(
      mocks.refreshedProjectDocument.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.writeAppStateForCurrentTab.mock.invocationCallOrder[0],
    );
  });
  it("never navigates when an edit is rejected", async () => {
    mocks.updateProject.mockRejectedValue(new Error("write rejected"));
    await expect(
      updateProject.run({ projectId: "project-1", title: "Updated" }, {
        caller: "tool",
      } as never),
    ).rejects.toThrow("write rejected");
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });
  it("opens the saved duplicate, not the source project, for an agent", async () => {
    mocks.refreshedProjectDocument.mockResolvedValue({ id: "copy-1" });
    const result = await duplicateProject.run(
      { projectId: "project-1", intent: "open" },
      { caller: "tool" } as never,
    );
    expect(result).toMatchObject({
      project: { id: "copy-1" },
      navigation: { status: "requested" },
    });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: "/project/copy-1/latest" }),
    );
    expect(
      mocks.refreshedProjectDocument.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.writeAppStateForCurrentTab.mock.invocationCallOrder[0],
    );
  });
  it("leaves frontend duplicate navigation to the UI and reports an unavailable agent command", async () => {
    mocks.refreshedProjectDocument.mockResolvedValue({ id: "copy-1" });
    await duplicateProject.run({ projectId: "project-1" }, {
      caller: "frontend",
    } as never);
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
    mocks.writeAppStateForCurrentTab.mockRejectedValue(
      new Error("state unavailable"),
    );
    const result = await duplicateProject.run(
      { projectId: "project-1", intent: "open" },
      { caller: "tool" } as never,
    );
    expect(result).toMatchObject({
      project: { id: "copy-1" },
      navigation: { status: "unavailable", reason: "command_write_failed" },
    });
  });
  it("opens an imported project only after the project and its cells are saved", async () => {
    const result = await importProject.run(
      {
        title: "Import",
        cells: [{ kind: "markdown", markdown: "Hello" }],
        intent: "open",
      },
      { caller: "tool" } as never,
    );
    expect(result).toMatchObject({
      project: { id: "project-1" },
      navigation: { status: "requested" },
    });
    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [
          expect.objectContaining({ kind: "markdown", markdown: "Hello" }),
        ],
      }),
    );
    expect(mocks.createProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeAppStateForCurrentTab.mock.invocationCallOrder[0],
    );
  });
  it("does not navigate when import fails or when the frontend imports", async () => {
    mocks.createProject.mockRejectedValueOnce(new Error("cell rejected"));
    await expect(
      importProject.run(
        { title: "Import", cells: [{ kind: "markdown", markdown: "Hello" }] },
        { caller: "tool" } as never,
      ),
    ).rejects.toThrow("cell rejected");
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
    await importProject.run({ title: "Import", cells: [] }, {
      caller: "frontend",
    } as never);
    expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it.each(["tool", "mcp"] as const)(
    "keeps the user's view after %s writes unless intent is open",
    async (caller) => {
      const context = { caller } as never;
      const created = await createProject.run({ title: "Analysis" }, context);
      const edited = await updateProject.run(
        { projectId: "project-1", title: "Updated" },
        context,
      );
      const copied = await duplicateProject.run(
        { projectId: "project-1" },
        context,
      );
      const imported = await importProject.run(
        { title: "Import", cells: [] },
        context,
      );
      for (const result of [created, edited, copied, imported]) {
        expect(result).toMatchObject({ navigation: { status: "kept" } });
      }
      expect(mocks.writeAppStateForCurrentTab).not.toHaveBeenCalled();
    },
  );
});
