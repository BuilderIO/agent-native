import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  serverless: false,
  calls: [] as string[],
}));

vi.mock("../../db/migration-runtime.js", () => ({
  isProductionServerlessFunctionRuntime: () => state.serverless,
}));
vi.mock("../../server/framework-request-handler.js", () => ({
  markDefaultPluginProvided: (_app: unknown, name: string) => {
    state.calls.push(`provided:${name}`);
  },
  awaitBootstrap: async () => {
    state.calls.push("bootstrap");
  },
}));
vi.mock("./store.js", () => ({
  observationalMemoryStore: {
    ready: async () => {
      state.calls.push("ready");
    },
  },
}));

import { createObservationalMemoryPlugin } from "./plugin.js";

describe("createObservationalMemoryPlugin", () => {
  beforeEach(() => {
    state.serverless = false;
    state.calls = [];
  });

  it("readies the store after bootstrap outside serverless functions", async () => {
    await createObservationalMemoryPlugin()({});
    expect(state.calls).toEqual([
      "provided:observational-memory",
      "bootstrap",
      "ready",
    ]);
  });

  it("leaves store setup to first use in a production serverless function", async () => {
    state.serverless = true;
    await createObservationalMemoryPlugin()({});
    expect(state.calls).toEqual(["provided:observational-memory", "bootstrap"]);
  });
});
