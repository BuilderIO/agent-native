import { describe, expect, it, vi } from "vitest";

import { refreshAndSelectRun } from "./automation-runs";

describe("refreshAndSelectRun", () => {
  it("refreshes persisted runs before selecting the new run", async () => {
    const events: string[] = [];
    const refetch = vi.fn(async () => {
      events.push("refetch");
    });
    const selectRun = vi.fn((id: string) => {
      events.push(`select:${id}`);
    });

    await refreshAndSelectRun(refetch, "run-2", selectRun);

    expect(events).toEqual(["refetch", "select:run-2"]);
  });
});
