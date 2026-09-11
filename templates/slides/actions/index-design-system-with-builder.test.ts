import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildBuilderDesignSystemIndexFiles: vi.fn(),
  startBuilderDesignSystemIndex: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    buildBuilderDesignSystemIndexFiles: (...args: unknown[]) =>
      mocks.buildBuilderDesignSystemIndexFiles(...args),
    startBuilderDesignSystemIndex: (...args: unknown[]) =>
      mocks.startBuilderDesignSystemIndex(...args),
  };
});

vi.mock("../server/lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: vi.fn(),
}));

import { FeatureNotConfiguredError } from "@agent-native/core/server";

import action from "./index-design-system-with-builder.js";

describe("index-design-system-with-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildBuilderDesignSystemIndexFiles.mockReturnValue([]);
  });

  it("returns an actionable precondition when Builder is not connected", async () => {
    mocks.startBuilderDesignSystemIndex.mockRejectedValue(
      new FeatureNotConfiguredError({
        requiredCredential: "BUILDER_PRIVATE_KEY",
        message:
          "Connect Builder.io (free tier available) before indexing a design system from Figma or code.",
        builderConnectUrl: "/_agent-native/builder/connect",
      }),
    );

    await expect(
      action.run({
        githubSources: [{ repoUrl: "https://github.com/acme/ui" }],
      }),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "builder_not_configured",
      statusCode: 412,
      message:
        "Connect Builder.io (free tier available) before indexing a design system from Figma or code.",
      details: { builderConnectUrl: "/_agent-native/builder/connect" },
    });
  });
});
