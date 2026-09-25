import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn<() => string | undefined>(),
  getRequestUserEmail: vi.fn<() => string | undefined>(),
  getWorkspaceFileMeta: vi.fn(),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("./store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store.js")>();
  return {
    ...actual,
    getWorkspaceFileMeta: mocks.getWorkspaceFileMeta,
  };
});

import { ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER } from "../action-ui.js";
import {
  createWorkspaceFileActionEntries,
  showWorkspaceFileAction,
} from "./actions.js";

describe("show-workspace-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org-example");
    mocks.getRequestUserEmail.mockReturnValue("steve@example.com");
    mocks.getWorkspaceFileMeta.mockResolvedValue({
      id: "resource-example",
      path: "exports/report.csv",
      contentType: "text/csv",
      sizeBytes: 2048,
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:01:00.000Z",
    });
  });

  it("resolves the file in the current organization scope", async () => {
    await expect(
      showWorkspaceFileAction.run({ path: "exports/report.csv" }),
    ).resolves.toEqual({
      file: {
        resourceId: "resource-example",
        path: "exports/report.csv",
        name: "report.csv",
        contentType: "text/csv",
        sizeBytes: 2048,
        updatedAt: "2026-07-29T10:01:00.000Z",
      },
    });
    expect(mocks.getWorkspaceFileMeta).toHaveBeenCalledWith(
      { scope: "org", scopeId: "org-example" },
      "exports/report.csv",
    );
  });

  it("uses the personal scope when no organization is active", async () => {
    mocks.getRequestOrgId.mockReturnValue(undefined);

    await showWorkspaceFileAction.run({ path: "exports/report.csv" });

    expect(mocks.getWorkspaceFileMeta).toHaveBeenCalledWith(
      { scope: "user", scopeId: "steve@example.com" },
      "exports/report.csv",
    );
  });

  it("fails instead of returning a successful-looking empty file", async () => {
    mocks.getWorkspaceFileMeta.mockResolvedValue(null);

    await expect(
      showWorkspaceFileAction.run({ path: "exports/missing.csv" }),
    ).rejects.toThrow('Workspace file not found: "exports/missing.csv"');
  });

  // Regression: the card only ever shows name/size/type + a download link —
  // it never inlines file content — so a binary export must render a card
  // exactly like a text one instead of throwing.
  it("renders a card for a binary (non-text) workspace file", async () => {
    mocks.getWorkspaceFileMeta.mockResolvedValue({
      id: "resource-example",
      path: "exports/report.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:01:00.000Z",
    });

    await expect(
      showWorkspaceFileAction.run({ path: "exports/report.pdf" }),
    ).resolves.toEqual({
      file: {
        resourceId: "resource-example",
        path: "exports/report.pdf",
        name: "report.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048,
        updatedAt: "2026-07-29T10:01:00.000Z",
      },
    });
  });

  it("fails without an authenticated scope", async () => {
    mocks.getRequestOrgId.mockReturnValue(undefined);
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(
      showWorkspaceFileAction.run({ path: "exports/report.csv" }),
    ).rejects.toThrow(
      "show-workspace-file requires an authenticated request context.",
    );
    expect(mocks.getWorkspaceFileMeta).not.toHaveBeenCalled();
  });

  it("registers a read-only native file-card action", () => {
    const action = createWorkspaceFileActionEntries()["show-workspace-file"];

    expect(action).toBe(showWorkspaceFileAction);
    expect(action.readOnly).toBe(true);
    expect(action.chatUI?.renderer).toBe(
      ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER,
    );
  });
});
