import { expect, it, vi } from "vitest";

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const getSettingsRaw = vi.fn();
vi.mock("../../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/store.js")>()),
  getSettingsRaw: (...args: unknown[]) => getSettingsRaw(...args),
}));
vi.mock("../../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => ({ execute: vi.fn() }),
}));
vi.mock("../../server/capture-error.js", () => ({ captureError: vi.fn() }));

it("propagates a refused database connection without per-flag retries", async () => {
  const registry = await import("../registry.js");
  registry._resetFeatureFlagRegistryForTests();
  registry.registerFeatureFlags([{ key: "batch-error-flag" }]);
  const error = Object.assign(new Error("Database unavailable"), {
    code: "ECONNREFUSED",
  });
  getSettingsRaw.mockRejectedValue(error);
  const action = (await import("./get-feature-flags.js")).default;

  await expect(action.run({}, {})).rejects.toBe(error);
  expect(getSettingsRaw).toHaveBeenCalledTimes(1);
});
