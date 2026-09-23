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

function Probe() {
  uploadFiles = useDropVideoUpload({}).uploadFiles;
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
});
