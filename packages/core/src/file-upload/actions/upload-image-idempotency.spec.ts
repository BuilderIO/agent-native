import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAppState: vi.fn(),
  deleteUploadedFile: vi.fn(),
  readAppState: vi.fn(),
  uploadFile: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("../../application-state/index.js", () => ({
  deleteAppState: mocks.deleteAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));
vi.mock("../registry.js", () => ({
  deleteUploadedFile: mocks.deleteUploadedFile,
  uploadFile: mocks.uploadFile,
}));

import action from "./upload-image.js";

const uploadArgs = {
  data: "data:image/png;base64,AQ==",
  filename: "figma-image.png",
  idempotencyKey: "fig-import:image-1",
};

describe("upload-image idempotency receipts", () => {
  beforeEach(() => {
    mocks.deleteAppState.mockReset();
    mocks.deleteUploadedFile.mockReset();
    mocks.readAppState.mockReset().mockResolvedValue(null);
    mocks.uploadFile.mockReset().mockResolvedValue({
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    mocks.writeAppState.mockReset().mockResolvedValue(undefined);
  });

  it("replays a stored provider result instead of uploading twice", async () => {
    const first = await action.run(uploadArgs);

    expect(first).toMatchObject({
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "file-upload-receipt:fig-import:image-1",
      expect.objectContaining({
        id: "asset-1",
        provider: "builder",
        url: "https://cdn.builder.io/asset-1.png",
      }),
    );

    mocks.readAppState.mockResolvedValue({
      filename: "figma-image.png",
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    await action.run(uploadArgs);

    expect(mocks.uploadFile).toHaveBeenCalledOnce();
  });

  it("deletes the provider object before releasing its receipt", async () => {
    mocks.readAppState.mockResolvedValue({
      filename: "figma-image.png",
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    mocks.deleteUploadedFile.mockResolvedValue(true);

    await expect(
      action.run({
        cleanup: "delete",
        idempotencyKey: "fig-import:image-1",
      }),
    ).resolves.toMatchObject({ deleted: true });

    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "asset-1",
      url: "https://cdn.builder.io/asset-1.png",
    });
    expect(mocks.deleteAppState).toHaveBeenCalledWith(
      "file-upload-receipt:fig-import:image-1",
    );
  });
});
