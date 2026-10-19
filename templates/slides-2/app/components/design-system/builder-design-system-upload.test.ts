import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mocks.callAction(...args),
}));

import { uploadAndIndexFigmaFiles } from "./builder-design-system-upload.js";
import type { BuilderIndexResult } from "./builder-index-response.js";

describe("Builder design-system uploads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callAction.mockResolvedValue({
      uploads: [
        {
          idx: 1,
          uploadUrl: "https://storage.example/start-1",
          uploadToken: "token-1",
        },
        {
          idx: 0,
          uploadUrl: "https://storage.example/start-0",
          uploadToken: "token-0",
        },
      ],
    });
    fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { Location: "https://storage.example/session-0" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { Location: "https://storage.example/session-1" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets slots through the action and preserves ordered binary uploads", async () => {
    const files = [
      {
        name: "first.fig",
        type: "application/fig",
        size: 4,
        slice: () => new Blob(["one"]),
      },
      {
        name: "second.fig",
        type: "application/fig",
        size: 4,
        slice: () => new Blob(["two"]),
      },
    ] as unknown as File[];
    const indexed = { ok: true } as unknown as BuilderIndexResult;
    const indexUploadedFiles = vi.fn(async () => indexed);
    const onProgress = vi.fn();

    const result = await uploadAndIndexFigmaFiles(files, {
      projectName: "Brand",
      onProgress,
      indexUploadedFiles,
    });

    expect(mocks.callAction).toHaveBeenCalledWith(
      "start-design-system-upload",
      {
        attachments: files.map((file) => ({
          name: file.name,
          mimetype: file.type,
          declaredSize: file.size,
        })),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://storage.example/start-0",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://storage.example/session-0",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://storage.example/start-1",
      expect.objectContaining({ method: "POST" }),
    );
    expect(indexUploadedFiles).toHaveBeenCalledWith({
      projectName: "Brand",
      uploadTokens: ["token-0", "token-1"],
    });
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(result).toBe(indexed);
  });

  it("does not begin binary transfer when the action request fails", async () => {
    mocks.callAction.mockRejectedValue(new Error("upload slots unavailable"));

    await expect(
      uploadAndIndexFigmaFiles(
        [{ name: "first.fig", type: "application/fig", size: 4 }] as File[],
        { indexUploadedFiles: vi.fn() },
      ),
    ).rejects.toThrow("upload slots unavailable");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
