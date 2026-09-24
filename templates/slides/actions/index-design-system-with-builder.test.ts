vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: vi.fn(async () => ({
    status: "ready",
    eligible: true,
  })),
  getBuilderDsiAccess: vi.fn(async () => ({ status: "ready", eligible: true })),
}));
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
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => undefined,
  getRequestUserEmail: () => "owner@example.test",
  getRequestOrgId: () => "test-org",
}));

import { ActionContractError } from "@agent-native/core/action";
import { FeatureNotConfiguredError } from "@agent-native/core/server";

import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";
import action from "./index-design-system-with-builder.js";

describe("index-design-system-with-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildBuilderDesignSystemIndexFiles.mockReturnValue([]);
  });

  it("forwards prompt-only creation without changing workspace defaults", async () => {
    mocks.startBuilderDesignSystemIndex.mockResolvedValue({
      designSystemId: "builder-system",
    });
    await action.run({
      githubSources: [{ repoUrl: "https://github.com/example/ui" }],
      makeDefaultIfFirst: false,
    });
    expect(upsertBuilderProxyDesignSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        makeDefaultIfFirst: false,
        ownerEmail: "owner@example.test",
        orgId: "test-org",
      }),
    );
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

  it("passes through Builder's route-unavailable failure so the agent can fall back locally", async () => {
    mocks.startBuilderDesignSystemIndex.mockRejectedValue(
      new ActionContractError(
        "Builder design-system indexing is not reachable with a Builder OAuth connection yet — Builder answered 403 route_not_enabled for /design-systems/v1. " +
          "Save a Builder private key as BUILDER_PRIVATE_KEY in Settings > Secrets to index with Builder, " +
          "or create the design system locally with create-design-system from the sources you already supplied.",
        {
          errorCode: "builder_design_system_oauth_unsupported",
          statusCode: 503,
        },
      ),
    );

    await expect(
      action.run({
        githubSources: [{ repoUrl: "https://github.com/acme/ui" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "builder_design_system_oauth_unsupported",
      statusCode: 503,
      message: expect.stringContaining("create-design-system"),
    });
  });
});
