import { beforeEach, describe, expect, it, vi } from "vitest";

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

import action from "./index-design-system-with-builder.js";

describe("index-design-system-with-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertBuilderDesignSystemCodeIndexingAllowed.mockResolvedValue(
      undefined,
    );
    mocks.buildBuilderDesignSystemIndexFiles.mockReturnValue([]);
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

  it("blocks inline code files before indexing when code indexing is not entitled", async () => {
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
        codeFiles: [{ filename: "tokens.css", content: ":root{--x:1}" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "design_system_code_indexing_forbidden",
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

    // No authenticated user in this test context, so the run rejects further
    // down the pipeline -- what matters here is that it gets past the
    // entitlement check without invoking it.
    await action
      .run({ designMd: "# Brand\nUse confident layouts." })
      .catch(() => {});

    expect(
      mocks.assertBuilderDesignSystemCodeIndexingAllowed,
    ).not.toHaveBeenCalled();
    expect(mocks.startBuilderDesignSystemIndex).toHaveBeenCalled();
  });
});
