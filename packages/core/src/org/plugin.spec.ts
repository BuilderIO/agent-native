import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("../server/framework-request-handler.js", () => ({
  FRAMEWORK_PREFIX: "/_agent-native",
  awaitBootstrap: vi.fn(async () => {
    calls.push("bootstrap");
  }),
  getH3App: vi.fn(() => ({ use: vi.fn() })),
  markDefaultPluginProvided: vi.fn(),
}));

vi.mock("./schema-store.js", () => ({
  orgStore: {
    ready: vi.fn(async () => {
      calls.push("store-ready");
    }),
  },
}));

vi.mock("./preview-dev-membership.js", () => ({
  schedulePreviewDevOrgMembership: vi.fn(() => {
    calls.push("preview-dev-join");
  }),
}));

import { createOrgPlugin } from "./plugin.js";

describe("createOrgPlugin", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("schedules the preview dev org join once the org store is ready", async () => {
    await createOrgPlugin()({});
    expect(calls).toEqual(["bootstrap", "store-ready", "preview-dev-join"]);
  });
});
