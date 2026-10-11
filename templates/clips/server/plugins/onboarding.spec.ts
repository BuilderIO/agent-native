import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOnboardingPlugin: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  registerFileUploadProvider: vi.fn(),
  registerPrivateBlobProvider: vi.fn(),
  registerOnboardingStep: vi.fn(),
  hasRequestVideoStorage: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  registerFileUploadProvider: mocks.registerFileUploadProvider,
}));
vi.mock("@agent-native/core/onboarding", () => ({
  createOnboardingPlugin: mocks.createOnboardingPlugin,
  registerOnboardingStep: mocks.registerOnboardingStep,
}));
vi.mock("@agent-native/core/private-blob", () => ({
  registerPrivateBlobProvider: mocks.registerPrivateBlobProvider,
}));
vi.mock("../lib/s3-upload-provider.js", () => ({
  clipsOrganizationLogoPrivateBlobProvider: {},
  s3FileUploadProvider: {},
}));
vi.mock("../lib/video-storage.js", () => ({
  hasRequestVideoStorage: mocks.hasRequestVideoStorage,
}));

import onboardingPlugin from "./onboarding.js";

describe("Clips onboarding plugin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps file storage optional while offering Builder and S3 setup", async () => {
    await onboardingPlugin({} as never);

    expect(mocks.registerOnboardingStep).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "file-storage",
        required: false,
        methods: expect.arrayContaining([
          expect.objectContaining({ id: "builder", label: "Use Builder.io" }),
          expect.objectContaining({
            id: "s3",
            label: "Use S3-compatible storage",
          }),
        ]),
        isComplete: mocks.hasRequestVideoStorage,
      }),
    );
  });
});
