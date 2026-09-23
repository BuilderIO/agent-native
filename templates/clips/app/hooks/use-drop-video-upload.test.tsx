// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  invalidateQueries: vi.fn(),
  probeVideoMetadata: vi.fn(),
  resolveVideoMimeType: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
  uploadChunkRequest: vi.fn(),
  uploadVideoBlobThumbnail: vi.fn(),
  waitForAcceptedRecordingAfterFinalizeError: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mocks.callAction(...args),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@shared/recording-core", () => ({
  chunkUploadParallelism: () => 1,
  chunkUploadUrl: (base: string) => base,
  UPLOAD_SLICE_BYTES: 1024,
}));
vi.mock("@shared/finalize-recovery", () => ({
  waitForAcceptedRecordingAfterFinalizeError: (...args: unknown[]) =>
    mocks.waitForAcceptedRecordingAfterFinalizeError(...args),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/compress", () => ({ MAX_UPLOAD_BYTES: 1024 }));
vi.mock("@/lib/recording-title", () => ({
  defaultRecordingTitle: () => "Untitled",
}));
vi.mock("@/lib/thumbnail-capture", () => ({
  uploadVideoBlobThumbnail: (...args: unknown[]) =>
    mocks.uploadVideoBlobThumbnail(...args),
}));
vi.mock("@/lib/upload-request", () => ({
  uploadChunkRequest: (...args: unknown[]) => mocks.uploadChunkRequest(...args),
}));
vi.mock("@/lib/video-metadata", () => ({
  probeVideoMetadata: (...args: unknown[]) => mocks.probeVideoMetadata(...args),
  resolveVideoMimeType: (...args: unknown[]) =>
    mocks.resolveVideoMimeType(...args),
}));

import { useDropVideoUpload } from "./use-drop-video-upload";

let container: HTMLDivElement;
let root: Root;
let uploadFiles: (files: Iterable<File>) => void;

function Probe({
  scope = {},
}: {
  scope?: { spaceId?: string | null; folderId?: string | null };
}) {
  uploadFiles = useDropVideoUpload(scope).uploadFiles;
  return null;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe("useDropVideoUpload", () => {
  it("uploads dropped files one at a time", async () => {
    let finishFirstUpload!: (response: Response) => void;
    const firstUpload = new Promise<Response>((resolve) => {
      finishFirstUpload = resolve;
    });
    mocks.callAction.mockImplementation(async () => ({
      id: `recording-${mocks.callAction.mock.calls.length}`,
      uploadChunkUrl: "/api/uploads/chunk",
    }));
    mocks.probeVideoMetadata.mockResolvedValue({
      durationMs: 1000,
      width: 640,
      height: 480,
    });
    mocks.resolveVideoMimeType.mockReturnValue("video/mp4");
    mocks.uploadVideoBlobThumbnail.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.uploadChunkRequest
      .mockReturnValueOnce(firstUpload)
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<Probe />));
    act(() =>
      uploadFiles([
        new File(["first"], "first.mp4", { type: "video/mp4" }),
        new File(["second"], "second.mp4", { type: "video/mp4" }),
      ]),
    );

    await vi.waitFor(() =>
      expect(mocks.uploadChunkRequest).toHaveBeenCalledOnce(),
    );
    expect(mocks.callAction).toHaveBeenCalledOnce();

    await act(async () => {
      finishFirstUpload(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    });

    await vi.waitFor(() =>
      expect(mocks.uploadChunkRequest).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledTimes(2),
    );
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
  });

  it("keeps the drop scope when navigation happens during metadata probing", async () => {
    let finishMetadata!: (metadata: {
      durationMs: number;
      width: number;
      height: number;
    }) => void;
    const metadata = new Promise<{
      durationMs: number;
      width: number;
      height: number;
    }>((resolve) => {
      finishMetadata = resolve;
    });
    mocks.callAction.mockImplementation(async () => ({
      id: `recording-${mocks.callAction.mock.calls.length}`,
      uploadChunkUrl: "/api/uploads/chunk",
    }));
    mocks.probeVideoMetadata.mockReturnValue(metadata);
    mocks.resolveVideoMimeType.mockReturnValue("video/mp4");
    mocks.uploadVideoBlobThumbnail.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.uploadChunkRequest.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    container = document.createElement("div");
    root = createRoot(container);
    act(() =>
      root.render(
        <Probe scope={{ spaceId: "space-a", folderId: "folder-a" }} />,
      ),
    );
    act(() =>
      uploadFiles([
        new File(["first"], "first.mp4", { type: "video/mp4" }),
        new File(["second"], "second.mp4", { type: "video/mp4" }),
      ]),
    );

    await vi.waitFor(() => expect(mocks.probeVideoMetadata).toHaveBeenCalled());
    act(() =>
      root.render(
        <Probe scope={{ spaceId: "space-b", folderId: "folder-b" }} />,
      ),
    );
    await act(async () => {
      finishMetadata({ durationMs: 1000, width: 640, height: 480 });
    });

    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(2));
    expect(
      mocks.callAction.mock.calls.map(([, input]) => {
        const scope = input as { spaceIds?: string[]; folderId?: string };
        return { spaceIds: scope.spaceIds, folderId: scope.folderId };
      }),
    ).toEqual([
      { spaceIds: ["space-a"], folderId: "folder-a" },
      { spaceIds: ["space-a"], folderId: "folder-a" },
    ]);
    await vi.waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledTimes(2),
    );
  });

  it("recovers when the server accepts a final chunk but its response is lost", async () => {
    mocks.callAction.mockResolvedValue({
      id: "recording-1",
      uploadChunkUrl: "/api/uploads/recording-1/chunk",
    });
    mocks.probeVideoMetadata.mockResolvedValue({
      durationMs: 1000,
      width: 640,
      height: 480,
    });
    mocks.resolveVideoMimeType.mockReturnValue("video/mp4");
    mocks.uploadVideoBlobThumbnail.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.uploadChunkRequest.mockRejectedValue(new TypeError("Network error"));
    mocks.waitForAcceptedRecordingAfterFinalizeError.mockResolvedValue({
      ok: true,
      finalized: true,
      recoveredAfterFinalizeError: true,
      id: "recording-1",
      recordingId: "recording-1",
      status: "ready",
    });

    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<Probe />));
    act(() => uploadFiles([new File(["video"], "video.mp4")]));

    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalledOnce());
    expect(
      mocks.waitForAcceptedRecordingAfterFinalizeError,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadUrl: "/api/uploads/recording-1/chunk",
        recordingId: "recording-1",
        preferAuthenticated: true,
      }),
    );
  });
});
