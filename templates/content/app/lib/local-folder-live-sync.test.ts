import { callAction } from "@agent-native/core/client/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDesktopContentFiles } from "./desktop-content-files";
import {
  consumeLiveLocalFolderActivation,
  pendingLiveLocalFolderActivation,
  rememberLiveLocalFolderSource,
  requestLiveLocalFolderActivation,
  subscribeLiveLocalFolderActivation,
  syncLiveLocalFolder,
} from "./local-folder-live-sync";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
}));
vi.mock("./desktop-content-files", () => ({
  getDesktopContentFiles: vi.fn(),
}));

function localStorageStub() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("live local-folder source recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { localStorage: localStorageStub() });
  });

  it("persists the Content source association with the Desktop grant", async () => {
    const associateSource = vi.fn().mockResolvedValue({
      ok: true,
      folder: { id: "folder-1", name: "Vault" },
    });
    vi.mocked(getDesktopContentFiles).mockReturnValue({
      associateSource,
    } as never);

    await rememberLiveLocalFolderSource(
      { id: "folder-1", name: "Vault", kind: "persistent" },
      "source-1",
      "database-1",
    );

    expect(associateSource).toHaveBeenCalledWith({
      folderId: "folder-1",
      sourceId: "source-1",
      databaseId: "database-1",
    });
  });

  it("recovers a source association from Desktop after renderer storage is lost", async () => {
    const folder = {
      id: "folder-1",
      name: "Vault",
      kind: "persistent" as const,
      contentSource: { sourceId: "source-1", databaseId: "database-1" },
    };
    const associateSource = vi.fn().mockResolvedValue({ ok: true, folder });
    const getFolder = vi.fn().mockResolvedValue({ ok: true, folder });
    const readFiles = vi.fn().mockResolvedValue({
      ok: true,
      folder,
      sources: { "note.md": "# Restored" },
      revisions: { "note.md": "sha256:restored" },
      identities: { "note.md": "file-1" },
    });
    vi.mocked(getDesktopContentFiles).mockReturnValue({
      associateSource,
      getFolder,
      readFiles,
    } as never);
    vi.mocked(callAction).mockResolvedValue({ updated: ["note.md"] } as never);

    const result = await syncLiveLocalFolder("folder-1");

    expect(result.synced).toBe(true);
    expect(getFolder).toHaveBeenCalledWith({ folderId: "folder-1" });
    expect(readFiles).toHaveBeenCalledWith({ folderId: "folder-1" });
    expect(callAction).toHaveBeenCalledWith("sync-local-folder-source", {
      sourceId: "source-1",
      files: { "note.md": "# Restored" },
      fileIdentities: { "note.md": "file-1" },
      observedRevisions: { "note.md": "sha256:restored" },
      dryRun: false,
    });
  });

  it("delivers and consumes an explicit working-copy activation", () => {
    const target = new EventTarget();
    vi.stubGlobal(
      "window",
      Object.assign(target, { localStorage: localStorageStub() }),
    );
    const activated = vi.fn();
    const unsubscribe = subscribeLiveLocalFolderActivation(activated);

    requestLiveLocalFolderActivation("working-copy-1");

    expect(activated).toHaveBeenCalledWith("working-copy-1");
    expect(pendingLiveLocalFolderActivation()).toBe("working-copy-1");
    consumeLiveLocalFolderActivation("working-copy-1");
    expect(pendingLiveLocalFolderActivation()).toBeNull();

    unsubscribe();
  });
});
