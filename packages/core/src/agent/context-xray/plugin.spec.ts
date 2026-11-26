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
vi.mock("./schema-store.js", () => ({
  contextXrayStore: {
    ready: async () => {
      state.calls.push("ready");
    },
  },
}));

import { createContextXrayPlugin } from "./plugin.js";

describe("createContextXrayPlugin", () => {
  beforeEach(() => {
    state.serverless = false;
    state.calls = [];
  });

  it("readies the store after bootstrap outside serverless functions", async () => {
    await createContextXrayPlugin()({});
    expect(state.calls).toEqual([
      "provided:context-xray",
      "bootstrap",
      "ready",
    ]);
  });

  it("leaves store setup to first use in a production serverless function", async () => {
    state.serverless = true;
    await createContextXrayPlugin()({});
    expect(state.calls).toEqual(["provided:context-xray", "bootstrap"]);
  });
});
