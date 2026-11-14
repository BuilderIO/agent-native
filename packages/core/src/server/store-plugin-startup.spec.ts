import { afterEach, expect, it, vi } from "vitest";
const stores = vi.hoisted(() => ({
  context: vi.fn(async () => {}),
  memory: vi.fn(async () => {}),
}));
vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: async () => {},
  markDefaultPluginProvided: vi.fn(),
}));
vi.mock("../agent/context-xray/schema-store.js", () => ({
  contextXrayStore: { ready: stores.context },
}));
vi.mock("../agent/observational-memory/store.js", () => ({
  observationalMemoryStore: { ready: stores.memory },
}));
import { createContextXrayPlugin } from "../agent/context-xray/plugin.js";
import { createObservationalMemoryPlugin } from "../agent/observational-memory/plugin.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("does no optional memory schema work when a hosted request boots", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NETLIFY_FUNCTION_NAME", "qa-startup");
  await createContextXrayPlugin()({});
  await createObservationalMemoryPlugin()({});
  expect(stores.context).not.toHaveBeenCalled();
  expect(stores.memory).not.toHaveBeenCalled();
});

it("keeps eager memory setup for long-lived development servers", async () => {
  vi.stubEnv("NODE_ENV", "development");
  await createContextXrayPlugin()({});
  await createObservationalMemoryPlugin()({});
  expect(stores.context).toHaveBeenCalledOnce();
  expect(stores.memory).toHaveBeenCalledOnce();
});
