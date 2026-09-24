import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getRequestUserEmail: vi.fn(),
  parseBuilderDesignSystemProxyReference: vi.fn(),
  resolveAccess: vi.fn(),
  startBuilderDesignSystemIndex: vi.fn(),
  upsertBuilderProxyDesignSystem: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  parseBuilderDesignSystemProxyReference: (...args: unknown[]) =>
    mocks.parseBuilderDesignSystemProxyReference(...args),
  startBuilderDesignSystemIndex: (...args: unknown[]) =>
    mocks.startBuilderDesignSystemIndex(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) =>
    mocks.getRequestUserEmail(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

vi.mock("../server/lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: (...args: unknown[]) =>
    mocks.upsertBuilderProxyDesignSystem(...args),
}));

import action from "./sync-design-system-with-builder.js";

describe("sync-design-system-with-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("editor@example.com");
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: {},
    });
    mocks.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: {
        id: "shared-design-system",
        ownerEmail: "owner@example.com",
        orgId: "org-owner",
        visibility: "org",
        title: "Shared system",
        description: "Shared description",
        data: "{}",
      },
    });
    mocks.parseBuilderDesignSystemProxyReference.mockReturnValue({
      sourceKind: "github",
      githubSources: [{ repoUrl: "https://github.com/acme/design-system" }],
    });
    mocks.startBuilderDesignSystemIndex.mockResolvedValue({
      designSystemId: "builder-design-system",
      jobId: "builder-job",
      builderUrl:
        "https://builder.io/app/design-system-intelligence/builder-design-system",
      status: "in-progress",
    });
    mocks.upsertBuilderProxyDesignSystem.mockResolvedValue({
      localDesignSystemId: "shared-design-system",
      instructions: "Builder indexing started.",
    });
  });

  it("updates a shared design system using the authorized resource scope", async () => {
    await action.run({ id: "shared-design-system" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design-system",
      "shared-design-system",
      "editor",
    );
    expect(mocks.upsertBuilderProxyDesignSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        orgId: "org-owner",
        localDesignSystemId: "shared-design-system",
      }),
    );
  });

  it("keeps the persisted owner scope when the caller owns the resource", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.resolveAccess.mockResolvedValue({
      role: "owner",
      resource: {
        id: "owned-design-system",
        ownerEmail: "owner@example.com",
        orgId: "org-owner",
        visibility: "org",
        title: "Owned system",
        description: "Owned description",
        data: "{}",
      },
    });

    await action.run({ id: "owned-design-system" });

    expect(mocks.upsertBuilderProxyDesignSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        orgId: "org-owner",
        localDesignSystemId: "owned-design-system",
      }),
    );
  });
});
