import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { waitForAgentRun, waitForCellRerun } from "../../e2e/saya-project.js";

describe("TEST-A2-CLAIM-RERUN-READINESS agent run diagnostics", () => {
  it("captures a bounded safe snapshot before rethrowing the timeout", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const get = vi.fn(async (url: string) => ({
      status: () => 200,
      ok: () => true,
      json: async () =>
        url.includes("/runs/latest")
          ? {
              runId: "run-123",
              status: "running",
              lastProgressAt: 1795082400000,
            }
          : {
              threadData: JSON.stringify({
                messages: [
                  {
                    content: [
                      {
                        type: "tool-call",
                        toolName: "add-project-cell",
                        args: { secret: "never-log" },
                      },
                    ],
                  },
                ],
              }),
            },
    }));
    try {
      await expect(
        waitForAgentRun(
          { request: { get } } as unknown as Page,
          "https://example.test",
          "thread-123",
          { timeout: 50, intervals: [10] },
        ),
      ).rejects.toThrow("Agent run must complete");
      const output = JSON.stringify(log.mock.calls);
      expect(output).toContain("run-123");
      expect(output).toContain("running");
      expect(output).toContain("1795082400000");
      expect(output).toContain("add-project-cell");
      expect(output).not.toContain("never-log");
    } finally {
      log.mockRestore();
    }
  });
  it("keeps the run summary if the thread snapshot is unavailable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const get = vi.fn(async (url: string) => ({
      status: () => (url.includes("/runs/latest") ? 200 : 503),
      ok: () => url.includes("/runs/latest"),
      json: async () => ({
        runId: "run-123",
        status: "running",
        lastProgressAt: 1795082400000,
      }),
    }));
    try {
      await expect(
        waitForAgentRun(
          { request: { get } } as unknown as Page,
          "https://example.test",
          "thread-123",
          { timeout: 50, intervals: [10] },
        ),
      ).rejects.toThrow("Agent run must complete");
      const output = JSON.stringify(log.mock.calls);
      expect(output).toContain("run-123");
      expect(output).toContain("1795082400000");
      expect(output).toContain("unavailable");
    } finally {
      log.mockRestore();
    }
  });
  it("keeps the thread ID when the run diagnostic is unavailable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const get = vi.fn(async (_url: string, options?: unknown) => ({
      status: () => (options ? 503 : 200),
      ok: () => !options,
      json: async () => ({ status: "running" }),
    }));
    try {
      await expect(
        waitForAgentRun(
          { request: { get } } as unknown as Page,
          "https://example.test",
          "thread-123",
          { timeout: 50, intervals: [100] },
        ),
      ).rejects.toThrow("Agent run must complete");
      expect(JSON.stringify(log.mock.calls)).toContain("thread-123");
      expect(JSON.stringify(log.mock.calls)).toContain("unavailable");
    } finally {
      log.mockRestore();
    }
  });
});

it("TEST-A2-CLAIM-RERUN-READINESS waits for the submitted rerun generation before accepting saved results", async () => {
  const states = [
    { requestId: "old", status: "complete" },
    { requestId: "new", status: "running" },
    { requestId: "new", status: "complete" },
  ];
  const read = vi.fn(async () => ({ queryStates: { cell: states.shift() } }));
  await waitForCellRerun(read, "cell", "new", "running", {
    timeout: 500,
    intervals: [10],
  });
  expect(read).toHaveBeenCalledTimes(3);
});

it("TEST-A2-CLAIM-RERUN-READINESS accepts an immediately completed submitted run without reading an older state", async () => {
  const read = vi.fn();
  await waitForCellRerun(read, "cell", "new", "complete");
  expect(read).not.toHaveBeenCalled();
});

it("TEST-A2-CLAIM-RERUN-READINESS does not accept an older completed run", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const read = vi.fn(async () => ({
    queryStates: { cell: { requestId: "old", status: "complete" } },
  }));
  try {
    await expect(
      waitForCellRerun(read, "cell", "new", "running", {
        timeout: 50,
        intervals: [10],
      }),
    ).rejects.toThrow("Submitted SQL rerun must complete");
    expect(JSON.stringify(log.mock.calls)).toContain("old");
    expect(JSON.stringify(log.mock.calls)).toContain("new");
  } finally {
    log.mockRestore();
  }
});

it.each(["error", "cancelled"])(
  "TEST-A2-CLAIM-RERUN-READINESS rejects a %s rerun",
  async (status) => {
    const read = vi.fn(async () => ({
      queryStates: { cell: { requestId: "new", status } },
    }));
    await expect(
      waitForCellRerun(read, "cell", "new", "running", {
        timeout: 50,
        intervals: [10],
      }),
    ).rejects.toThrow(`SQL rerun ended ${status}`);
  },
);
