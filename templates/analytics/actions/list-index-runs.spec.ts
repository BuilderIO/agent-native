import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSourceIndexRuns: vi.fn(),
  requireSourceIndexReadOrg: vi.fn(() => "org_1"),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("../server/lib/source-index-runs.js", () => ({
  listSourceIndexRuns: mocks.listSourceIndexRuns,
  requireSourceIndexReadOrg: mocks.requireSourceIndexReadOrg,
}));

const { default: action } = await import("./list-index-runs");

describe("list-index-runs", () => {
  it("lists the organization's runs with the requested limit", async () => {
    const run = {
      id: "run_1",
      status: "succeeded",
      trigger: "manual",
      startedAt: "2026-10-08T12:00:00.000Z",
      finishedAt: "2026-10-08T12:01:00.000Z",
      entryCount: 2,
      sourceRevisions: { "analytics-dbt": "a".repeat(40) },
      error: null,
      createdByEmail: "admin@example.test",
    };
    mocks.listSourceIndexRuns.mockResolvedValueOnce([run]);

    await expect(action.run({ limit: 5 })).resolves.toEqual([run]);
    expect(mocks.listSourceIndexRuns).toHaveBeenCalledWith("org_1", 5);
  });

  it("defaults the limit to 10 and coerces an HTTP string", () => {
    expect(action.schema.parse({})).toEqual({ limit: 10 });
    expect(action.schema.parse({ limit: "25" })).toEqual({ limit: 25 });
  });
});
