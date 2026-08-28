import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  parse: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  hydrateBuilderDesignSystemReference: (...args: unknown[]) =>
    mocks.hydrate(...args),
  parseBuilderDesignSystemProxyReference: (...args: unknown[]) =>
    mocks.parse(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolve(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

import action from "./get-design-system-index-status.js";

describe("get-design-system-index-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({
      resource: { id: "local-ds-1", data: '{"source":"builder"}' },
    });
    mocks.parse.mockReturnValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderStatus: "in-progress",
    });
  });

  it("reports progress without mutating the local proxy", async () => {
    mocks.hydrate.mockResolvedValue({
      builderStatus: "in-progress",
      docCount: 12,
      tokenValues: { "--primary": "#123456" },
    });

    await expect(action.run({ id: "local-ds-1" })).resolves.toEqual({
      id: "local-ds-1",
      isBuilderBacked: true,
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      status: "in-progress",
      ready: false,
      docCount: 12,
      tokenCount: 1,
    });
    expect(mocks.hydrate).toHaveBeenCalledWith(
      expect.objectContaining({ builderJobId: "job-1" }),
    );
  });

  it("does not pretend an ordinary local system has Builder indexing", async () => {
    mocks.parse.mockReturnValue(null);

    await expect(action.run({ id: "local-ds-1" })).resolves.toEqual({
      id: "local-ds-1",
      isBuilderBacked: false,
      status: "not-builder-backed",
    });
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });

  it("keeps missing systems distinguishable from an empty status", async () => {
    mocks.resolve.mockResolvedValue(null);

    await expect(action.run({ id: "missing" })).rejects.toMatchObject({
      statusCode: 404,
      message: "Design system not found",
    });
  });
});
