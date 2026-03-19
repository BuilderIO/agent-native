import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { FileSync } from "./file-sync.js";
import type { FileSyncAdapter, FileRecord, FileChange } from "./types.js";

function createMockAdapter(): FileSyncAdapter & {
  _triggerChange: (changes: FileChange[]) => void;
} {
  let onChange: ((changes: FileChange[]) => void) | null = null;

  const adapter: FileSyncAdapter & {
    _triggerChange: (changes: FileChange[]) => void;
  } = {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((_appId, _ownerId, cb, _onError) => {
      onChange = cb;
      return () => {
        onChange = null;
      };
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    _triggerChange: (changes: FileChange[]) => {
      onChange?.(changes);
    },
  };
  return adapter;
}

function createTempProject() {
  // Use realpathSync to resolve macOS /tmp -> /private/tmp symlink,
  // which otherwise trips assertSafePath's symlink detection
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "file-sync-test-")));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  // Create content dir and sync-config.json
  fs.mkdirSync(path.join(root, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "content", "sync-config.json"),
    JSON.stringify({
      syncFilePatterns: ["data/**/*.json", "data/**/*.md"],
      privateSyncFilePatterns: [],
    }),
  );

  return { root, dataDir };
}

function cleanupTempProject(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("FileSync", () => {
  let tmpRoot: string;
  let adapter: ReturnType<typeof createMockAdapter>;
  let fileSync: FileSync;

  beforeEach(() => {
    const { root } = createTempProject();
    tmpRoot = root;
    adapter = createMockAdapter();
    fileSync = new FileSync({
      appId: "test-app",
      ownerId: "shared",
      contentRoot: path.join(tmpRoot, "data"),
      adapter,
      syncConfigPath: path.join(tmpRoot, "content", "sync-config.json"),
    });
  });

  afterEach(async () => {
    await fileSync.stop();
    cleanupTempProject(tmpRoot);
  });

  describe("constructor", () => {
    it("validates appId", () => {
      expect(
        () =>
          new FileSync({
            appId: "bad app&id",
            ownerId: "shared",
            contentRoot: "./data",
            adapter,
          }),
      ).toThrow("Invalid appId");
    });

    it("validates ownerId", () => {
      expect(
        () =>
          new FileSync({
            appId: "test",
            ownerId: "bad=owner",
            contentRoot: "./data",
            adapter,
          }),
      ).toThrow("Invalid ownerId");
    });

    it("accepts valid identifiers", () => {
      expect(
        () =>
          new FileSync({
            appId: "my-app_v2",
            ownerId: "shared",
            contentRoot: "./data",
            adapter,
          }),
      ).not.toThrow();
    });
  });

  describe("initFileSync", () => {
    it("queries adapter for existing docs on startup", async () => {
      await fileSync.initFileSync();
      expect(adapter.query).toHaveBeenCalledWith("test-app", "shared");
    });

    it("pulls remote files that don't exist locally", async () => {
      adapter.query.mockResolvedValue([
        {
          id: "test-app:data/new-file.json",
          data: {
            path: "data/new-file.json",
            content: '{"hello":"world"}',
            app: "test-app",
            ownerId: "shared",
            lastUpdated: Date.now(),
          },
        },
      ]);

      await fileSync.initFileSync();

      const filePath = path.join(tmpRoot, "data", "new-file.json");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe('{"hello":"world"}');
    });

    it("pushes local files that are newer than remote", async () => {
      // Create local file first
      const filePath = path.join(tmpRoot, "data", "local.json");
      fs.writeFileSync(filePath, '{"local":true}');

      adapter.query.mockResolvedValue([
        {
          id: "test-app:data/local.json",
          data: {
            path: "data/local.json",
            content: '{"local":false}',
            app: "test-app",
            ownerId: "shared",
            lastUpdated: 0, // Very old
          },
        },
      ]);

      await fileSync.initFileSync();

      expect(adapter.set).toHaveBeenCalledWith(
        "test-app:data/local.json",
        expect.objectContaining({ content: '{"local":true}' }),
      );
    });

    it("detects and warns about legacy doc IDs with __ separator", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      adapter.query.mockResolvedValue([
        {
          id: "test-app__data__old.json",
          data: {
            path: "data/old.json",
            content: "{}",
            app: "test-app",
            ownerId: "shared",
            lastUpdated: Date.now(),
          },
        },
      ]);

      await fileSync.initFileSync();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("legacy '__' separator"),
      );
      warnSpy.mockRestore();
    });

    it("sets init flag only after successful initialization", async () => {
      adapter.query.mockRejectedValue(new Error("DB down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await fileSync.initFileSync();

      // Should be able to retry since flag wasn't set
      adapter.query.mockResolvedValue([]);
      await fileSync.initFileSync();

      expect(adapter.query).toHaveBeenCalledTimes(2);
      errorSpy.mockRestore();
    });
  });

  describe("stop", () => {
    it("disposes the adapter", async () => {
      await fileSync.initFileSync();
      await fileSync.stop();
      expect(adapter.dispose).toHaveBeenCalled();
    });

    it("allows retry after stop and re-initialization", async () => {
      await fileSync.initFileSync();
      await fileSync.stop();

      // Flags should be reset
      const newAdapter = createMockAdapter();
      const newSync = new FileSync({
        appId: "test-app",
        ownerId: "shared",
        contentRoot: path.join(tmpRoot, "data"),
        adapter: newAdapter,
        syncConfigPath: path.join(tmpRoot, "content", "sync-config.json"),
      });
      await newSync.initFileSync();
      expect(newAdapter.query).toHaveBeenCalled();
      await newSync.stop();
    });
  });

  describe("remote listener", () => {
    it("writes incoming remote changes to disk", async () => {
      await fileSync.initFileSync();

      adapter._triggerChange([
        {
          type: "added",
          id: "test-app:data/remote.json",
          data: {
            path: "data/remote.json",
            content: '{"remote":true}',
            app: "test-app",
            ownerId: "shared",
            lastUpdated: Date.now(),
          },
        },
      ]);

      // Give it a tick
      await new Promise((r) => setTimeout(r, 50));

      const filePath = path.join(tmpRoot, "data", "remote.json");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe('{"remote":true}');
    });

    it("rejects path traversal attempts from remote", async () => {
      await fileSync.initFileSync();

      // Path traversal paths like ../../etc/passwd are silently dropped
      // by shouldSyncFile (don't match data/**/*.json patterns).
      // This is the correct behavior — denylist and patterns are the first line of defense.
      adapter._triggerChange([
        {
          type: "added",
          id: "test-app:../../etc/passwd",
          data: {
            path: "../../etc/passwd",
            content: "hacked",
            app: "test-app",
            ownerId: "shared",
            lastUpdated: Date.now(),
          },
        },
      ]);

      await new Promise((r) => setTimeout(r, 50));

      // File should NOT be written anywhere
      expect(fs.existsSync(path.join(tmpRoot, "..", "..", "etc", "passwd"))).toBe(false);
    });
  });

  describe("echo suppression", () => {
    it("wasSyncPulled returns true after remote write and consumes", async () => {
      await fileSync.initFileSync();

      // Trigger a remote write — should create the file and mark it as expected
      adapter._triggerChange([
        {
          type: "added",
          id: "test-app:data/echo-test.json",
          data: {
            path: "data/echo-test.json",
            content: '{"echo":"test"}',
            app: "test-app",
            ownerId: "shared",
            lastUpdated: Date.now(),
          },
        },
      ]);

      // Verify file was written
      const filePath = path.join(tmpRoot, "data", "echo-test.json");
      expect(fs.existsSync(filePath)).toBe(true);

      // First call should return true (file was written by sync engine)
      expect(fileSync.wasSyncPulled("data/echo-test.json")).toBe(true);
      // Second call should return false (consumed)
      expect(fileSync.wasSyncPulled("data/echo-test.json")).toBe(false);
    });
  });

  describe("sync status", () => {
    it("writes sync status file after initialization", async () => {
      await fileSync.initFileSync();

      const statusPath = path.join(tmpRoot, "data", ".sync-status.json");
      expect(fs.existsSync(statusPath)).toBe(true);

      const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      expect(status.enabled).toBe(true);
      expect(status.connected).toBe(true);
      expect(status.conflicts).toEqual([]);
    });

    it("conflictCount starts at 0", () => {
      expect(fileSync.conflictCount).toBe(0);
    });
  });
});
