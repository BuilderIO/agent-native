import { beforeEach, describe, expect, it, vi } from "vitest";

const registerPrivateBlobProvider = vi.hoisted(() => vi.fn());
const setPrivateBlobPublicUploadFallbackEnabled = vi.hoisted(() => vi.fn());
const vercelPrivateBlobProvider = vi.hoisted(() => ({ name: "vercel" }));

vi.mock("@agent-native/core/private-blob", () => ({
  registerPrivateBlobProvider,
  setPrivateBlobPublicUploadFallbackEnabled,
  vercelPrivateBlobProvider,
}));

import contentPrivateBlobPlugin from "./private-blob";

describe("Content private blob plugin", () => {
  beforeEach(() => vi.resetAllMocks());

  it("registers Vercel private storage and disables public-upload fallback", () => {
    contentPrivateBlobPlugin();

    expect(registerPrivateBlobProvider).toHaveBeenCalledWith(
      vercelPrivateBlobProvider,
    );
    expect(setPrivateBlobPublicUploadFallbackEnabled).toHaveBeenCalledWith(
      false,
    );
  });
});
