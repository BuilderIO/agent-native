import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAction } = vi.hoisted(() => ({ callAction: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import {
  createNativeTextureUploader,
  uploadNativeTexture,
} from "./native-texture-upload-client";

describe("native texture upload client", () => {
  beforeEach(() => callAction.mockReset());

  it("uses the Design-scoped action and keeps the caller's retry key", async () => {
    callAction.mockResolvedValue({
      url: "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png",
    });
    expect(
      await uploadNativeTexture(
        "design-a",
        "file-a",
        "data:image/png;base64,AAAA",
        "photo.png",
        "retry-a",
      ),
    ).toEqual({
      url: "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png",
    });
    expect(callAction).toHaveBeenCalledExactlyOnceWith(
      "upload-design-native-texture",
      {
        designId: "design-a",
        fileId: "file-a",
        data: "data:image/png;base64,AAAA",
        filename: "photo.png",
        idempotencyKey: "retry-a",
      },
    );
  });

  it("reuses one key when the first response is lost and a selected image is retried", async () => {
    callAction
      .mockRejectedValueOnce(new Error("transport timeout"))
      .mockResolvedValueOnce({
        url: "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png",
      });
    const upload = createNativeTextureUploader("design-a", "file-a");
    await expect(upload("same-data", "photo.png")).rejects.toThrow(
      "transport timeout",
    );
    const remounted = createNativeTextureUploader("design-a", "file-a");
    await expect(remounted("same-data", "photo.png")).resolves.toMatchObject({
      url: expect.stringContaining("/api/design-native-texture/"),
    });
    expect(callAction).toHaveBeenCalledTimes(2);
    const first = callAction.mock.calls[0]![1] as { idempotencyKey: string };
    const second = callAction.mock.calls[1]![1] as { idempotencyKey: string };
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects an unreadable action result instead of clearing the image", async () => {
    callAction.mockResolvedValue({ error: "storage down" });
    await expect(
      uploadNativeTexture(
        "design-a",
        "file-a",
        "data:image/png;base64,AAAA",
        "photo.png",
        "retry-b",
      ),
    ).rejects.toThrow("did not return a readable image reference");
  });
});
