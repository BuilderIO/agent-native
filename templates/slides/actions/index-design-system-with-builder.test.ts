import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWorkflowsEnabled = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mockWorkflowsEnabled,
}));
beforeEach(() => {
  mockWorkflowsEnabled.mockResolvedValue(true);
});

const mocks = vi.hoisted(() => ({
  assertBuilderDesignSystemCodeIndexingAllowed: vi.fn(),
  buildBuilderDesignSystemIndexFiles: vi.fn(),
  startBuilderDesignSystemIndex: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    assertBuilderDesignSystemCodeIndexingAllowed: (...args: unknown[]) =>
      mocks.assertBuilderDesignSystemCodeIndexingAllowed(...args),
    buildBuilderDesignSystemIndexFiles: (...args: unknown[]) =>
      mocks.buildBuilderDesignSystemIndexFiles(...args),
    startBuilderDesignSystemIndex: (...args: unknown[]) =>
      mocks.startBuilderDesignSystemIndex(...args),
  };
});

vi.mock("../server/lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: vi.fn(),
}));

import { ActionContractError } from "@agent-native/core/action";
import { FeatureNotConfiguredError } from "@agent-native/core/server";

import action from "./index-design-system-with-builder.js";

describe("index-design-system-with-builder", () => {
  it("blocks indexing before entitlement, upload or provider work when workflows are off", async () => {
    mockWorkflowsEnabled.mockResolvedValue(false);
    await expect(action.run({ designMd: "# Brand" })).rejects.toMatchObject({
      errorCode: "design_system_workflows_disabled",
      statusCode: 403,
    });
    expect(
      mocks.assertBuilderDesignSystemCodeIndexingAllowed,
    ).not.toHaveBeenCalled();
    expect(mocks.buildBuilderDesignSystemIndexFiles).not.toHaveBeenCalled();
    expect(mocks.startBuilderDesignSystemIndex).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertBuilderDesignSystemCodeIndexingAllowed.mockResolvedValue(
      undefined,
    );
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

  it("blocks a GitHub source before indexing when code indexing is not entitled", async () => {
    mocks.assertBuilderDesignSystemCodeIndexingAllowed.mockRejectedValue(
      new ActionContractError(
        "Code and repository indexing requires the Builder Enterprise plan.",
        {
          errorCode: "design_system_code_indexing_forbidden",
          statusCode: 403,
        },
      ),
    );

    await expect(
      action.run({
        githubSources: [{ repoUrl: "https://github.com/acme/ui" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "design_system_code_indexing_forbidden",
      statusCode: 403,
    });
    expect(mocks.startBuilderDesignSystemIndex).not.toHaveBeenCalled();
  });

  it("does not check code-indexing entitlement for design.md-only sources", async () => {
    mocks.startBuilderDesignSystemIndex.mockResolvedValue({
      ok: true,
      source: "builder",
      projectId: "project-1",
      jobId: "job-1",
      designSystemId: "ds-1",
      suggestedTitle: null,
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      status: "in-progress",
    });

    await action
      .run({ designMd: "# Brand\nUse confident layouts." })
      .catch(() => {});

    expect(
      mocks.assertBuilderDesignSystemCodeIndexingAllowed,
    ).not.toHaveBeenCalled();
    expect(mocks.startBuilderDesignSystemIndex).toHaveBeenCalled();
  });
});
