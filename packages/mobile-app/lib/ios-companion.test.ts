import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueCaptureJob: vi.fn(),
  files: new Map<
    string,
    { deleted?: boolean; exists: boolean; size?: number; text: string }
  >(),
  peekPendingQuickAction: vi.fn(),
  acknowledgeQuickAction: vi.fn(),
  getClipsSession: vi.fn(),
  addListener: vi.fn(),
  persistCaptureFile: vi.fn(),
}));

vi.mock("@bacons/apple-targets", () => ({
  ExtensionStorage: class {},
}));
vi.mock("expo-file-system", () => {
  class File {
    name: string;
    uri: string;

    constructor(_directory: unknown, name: string) {
      this.name = name;
      this.uri = `shared://${name}`;
    }

    get exists() {
      return mocks.files.get(this.name)?.exists ?? false;
    }

    get extension() {
      const extension = this.name.split(".").pop();
      return extension ? `.${extension}` : "";
    }

    get size() {
      return mocks.files.get(this.name)?.size ?? 1;
    }

    async text() {
      return mocks.files.get(this.name)?.text ?? "";
    }

    delete() {
      const file = mocks.files.get(this.name);
      if (file) file.deleted = true;
    }
  }

  class Directory {
    exists = true;

    constructor(..._paths: unknown[]) {}

    list() {
      return [...mocks.files.keys()]
        .filter((name) => name.endsWith(".json"))
        .map((name) => new File(this, name));
    }
  }

  return {
    Directory,
    File,
    Paths: {
      appleSharedContainers: {
        "group.com.agentnative.mobile": { exists: true },
      },
    },
  };
});
vi.mock("react-native", () => ({
  NativeEventEmitter: class {
    addListener(...args: unknown[]) {
      return mocks.addListener(...args);
    }
  },
  NativeModules: {
    AgentNativeIOSCompanion: {
      peekPendingQuickAction: mocks.peekPendingQuickAction,
      acknowledgeQuickAction: mocks.acknowledgeQuickAction,
    },
  },
  Platform: { OS: "ios" },
}));
vi.mock("./capture-queue", () => ({
  enqueueCaptureJob: mocks.enqueueCaptureJob,
}));
vi.mock("./clips-session", () => ({
  getClipsSession: mocks.getClipsSession,
}));
vi.mock("./persist-capture", () => ({
  persistCaptureFile: mocks.persistCaptureFile,
}));

import {
  acknowledgeIOSQuickAction,
  importIOSSharedCaptures,
  isSharedCaptureReadyForImport,
  peekPendingIOSQuickAction,
  subscribeToIOSQuickActionAvailable,
} from "./ios-companion";

describe("iOS shared capture recovery", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");

  beforeEach(() => {
    mocks.files.clear();
    mocks.enqueueCaptureJob.mockReset();
    mocks.peekPendingQuickAction.mockReset();
    mocks.acknowledgeQuickAction.mockReset();
    mocks.getClipsSession.mockReset().mockResolvedValue({ ownerKey: "owner" });
    mocks.addListener.mockReset();
    mocks.persistCaptureFile
      .mockReset()
      .mockResolvedValue("local://capture.mp4");
  });

  it("imports completed and legacy manifests immediately", () => {
    expect(
      isSharedCaptureReadyForImport(
        { status: "completed", updatedAt: "2026-07-18T12:00:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(isSharedCaptureReadyForImport({}, now)).toBe(true);
  });

  it("leaves an active broadcast alone", () => {
    expect(
      isSharedCaptureReadyForImport(
        { status: "recording", updatedAt: "2026-07-18T11:59:50.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("recovers a recording after its manifest heartbeat goes stale", () => {
    expect(
      isSharedCaptureReadyForImport(
        { status: "recording", updatedAt: "2026-07-18T11:59:29.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("exposes the pending route before acknowledging its delivery", async () => {
    const remove = vi.fn();
    const listener = vi.fn();
    mocks.peekPendingQuickAction.mockResolvedValue({
      id: "quick-action-1",
      path: "/capture/audio",
    });
    mocks.acknowledgeQuickAction.mockResolvedValue(undefined);
    mocks.addListener.mockReturnValue({ remove });

    const unsubscribe = subscribeToIOSQuickActionAvailable(listener);
    await expect(peekPendingIOSQuickAction()).resolves.toEqual({
      id: "quick-action-1",
      path: "/capture/audio",
    });

    expect(mocks.addListener).toHaveBeenCalledWith(
      "quickActionAvailable",
      listener,
    );
    await acknowledgeIOSQuickAction("quick-action-1");
    expect(mocks.acknowledgeQuickAction).toHaveBeenCalledWith("quick-action-1");
    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("imports completed ReplayKit metadata with its measured duration", async () => {
    mocks.files.set("capture-1.json", {
      exists: true,
      text: JSON.stringify({
        captureId: "capture-1",
        capturedAt: "2026-07-18T12:00:00.000Z",
        durationMs: 42_125,
        fileName: "capture-1.mp4",
        kind: "video",
        mimeType: "video/mp4",
        status: "completed",
        title: "Screen recording",
        updatedAt: "2026-07-18T12:00:42.125Z",
      }),
    });
    mocks.files.set("capture-1.mp4", { exists: true, text: "" });

    await expect(importIOSSharedCaptures()).resolves.toBe(1);
    expect(mocks.enqueueCaptureJob).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "capture-1",
        durationMs: 42_125,
        localUri: "local://capture.mp4",
        ownerKey: "owner",
      }),
    );
    expect(mocks.files.get("capture-1.json")?.deleted).toBe(true);
    expect(mocks.files.get("capture-1.mp4")?.deleted).toBe(true);
  });

  it("leaves malformed recovery metadata untouched for diagnosis", async () => {
    mocks.files.set("capture-2.json", {
      exists: true,
      text: JSON.stringify({
        captureId: "capture-2",
        capturedAt: "2026-07-18T12:00:00.000Z",
        durationMs: "unknown",
        fileName: "capture-2.mp4",
        kind: "video",
        mimeType: "video/mp4",
        status: "completed",
        title: "Screen recording",
      }),
    });
    mocks.files.set("capture-2.mp4", { exists: true, text: "" });

    await expect(importIOSSharedCaptures()).resolves.toBe(0);
    expect(mocks.enqueueCaptureJob).not.toHaveBeenCalled();
    expect(mocks.files.get("capture-2.json")?.deleted).not.toBe(true);
  });

  it("keeps zero-byte and failed imports available for a later retry", async () => {
    mocks.files.set("capture-3.json", {
      exists: true,
      text: JSON.stringify({
        captureId: "capture-3",
        capturedAt: "2026-07-18T12:00:00.000Z",
        durationMs: 20_000,
        fileName: "capture-3.mp4",
        kind: "video",
        mimeType: "video/mp4",
        status: "recording",
        title: "Screen recording",
        updatedAt: "2026-07-18T11:00:00.000Z",
      }),
    });
    mocks.files.set("capture-3.mp4", {
      exists: true,
      size: 0,
      text: "",
    });

    await expect(importIOSSharedCaptures()).resolves.toBe(0);
    expect(mocks.persistCaptureFile).not.toHaveBeenCalled();
    expect(mocks.files.get("capture-3.json")?.deleted).not.toBe(true);

    mocks.files.get("capture-3.mp4")!.size = 1_024;
    mocks.persistCaptureFile.mockRejectedValueOnce(new Error("copy failed"));
    await expect(importIOSSharedCaptures()).resolves.toBe(0);
    expect(mocks.files.get("capture-3.json")?.deleted).not.toBe(true);
    expect(mocks.files.get("capture-3.mp4")?.deleted).not.toBe(true);
  });
});
