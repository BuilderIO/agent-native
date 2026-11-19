import { afterEach, expect, it, vi } from "vitest";
const prune = vi.hoisted(() => vi.fn());
const pruneAgentBudget = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/bigquery-usage-retention", () => ({
  pruneBigQueryUsage: prune,
}));
vi.mock("../../../lib/bigquery-agent-budget", () => ({
  pruneBigQueryAgentBudget: pruneAgentBudget,
}));
vi.mock("h3", () => ({
  defineEventHandler: (fn: unknown) => fn,
  createError: (options: object) =>
    Object.assign(new Error("Not found"), options),
}));
import handler from "./prune.post";
afterEach(() => {
  globalThis.__AGENT_NATIVE_BIGQUERY_USAGE_RETENTION_SCHEDULED_RUNTIME__ =
    undefined;
  prune.mockReset();
  pruneAgentBudget.mockReset();
});
it("refuses ordinary requests before global maintenance starts", async () => {
  await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 404 });
  expect(prune).not.toHaveBeenCalled();
  expect(pruneAgentBudget).not.toHaveBeenCalled();
});
it("returns maintenance counts only in the authenticated worker runtime and surfaces failures", async () => {
  globalThis.__AGENT_NATIVE_BIGQUERY_USAGE_RETENTION_SCHEDULED_RUNTIME__ = true;
  prune.mockResolvedValueOnce({ deleted: 12, expiredRemaining: "3" });
  pruneAgentBudget.mockResolvedValueOnce({ admissionsDeleted: 2 });
  expect(await handler({} as never)).toEqual({
    ok: true,
    deleted: 12,
    expiredRemaining: "3",
    agentBudget: { admissionsDeleted: 2 },
  });
  prune.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(handler({} as never)).rejects.toThrow("database unavailable");
});
