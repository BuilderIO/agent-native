import { expect, it, vi } from "vitest";

import { loadFrameworkDefaultPlugin } from "./default-plugin-loader.js";

const { auth, resources } = vi.hoisted(() => ({
  auth: vi.fn(),
  resources: vi.fn(),
}));
vi.mock("./auth-plugin.js", () => ({ defaultAuthPlugin: auth }));
vi.mock("./resources-plugin.js", () => ({ defaultResourcesPlugin: resources }));
vi.mock("../terminal/terminal-plugin.js", () => {
  throw new Error("Unused plugin must not initialize");
});
vi.mock("./index.js", () => {
  throw new Error("The public server barrel must not initialize");
});

it("loads and runs requested plugins without initializing unrelated server exports", async () => {
  const app = {};
  const plugin = await loadFrameworkDefaultPlugin("auth");
  await plugin!(app);
  expect(auth).toHaveBeenCalledExactlyOnceWith(app);
  expect(resources).not.toHaveBeenCalled();
});

it("leaves unknown and inherited names for workspace resolution", () => {
  expect(loadFrameworkDefaultPlugin("custom-workspace-slot")).toBeUndefined();
  expect(loadFrameworkDefaultPlugin("toString")).toBeUndefined();
});
