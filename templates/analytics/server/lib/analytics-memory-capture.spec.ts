import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  execute,
  getThread,
  registerRecurringSweepHandler,
  runWithRequestContext,
  saveMemory,
  track,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  getThread: vi.fn(),
  registerRecurringSweepHandler: vi.fn(),
  runWithRequestContext: vi.fn(async (_context: unknown, run: () => unknown) =>
    run(),
  ),
  saveMemory: vi.fn(async (_args: string[]) => {}),
  track: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));
vi.mock("@agent-native/core/scripts", () => ({
  coreScripts: { "save-memory": saveMemory },
}));
vi.mock("@agent-native/core/server", () => ({
  getThread,
  registerRecurringSweepHandler,
  runWithRequestContext,
}));
vi.mock("@agent-native/core/tracking", () => ({ track }));

import {
  ANALYTICS_MEMORY_CAPTURE_IDLE_MS,
  enqueueAnalyticsMemoryCapture,
  runAnalyticsMemoryCaptureSweep,
} from "./analytics-memory-capture.js";

const owner = "owner@example.test";
const threadId = "analytics-thread-1";

function thread(
  messages: unknown[],
  updatedAt = Date.now() - ANALYTICS_MEMORY_CAPTURE_IDLE_MS - 1_000,
) {
  const last = messages[messages.length - 1] as
    | { message?: { id?: string }; id?: string }
    | undefined;
  const headId = last?.message?.id ?? last?.id ?? null;
  return {
    ownerEmail: owner,
    source: { appId: "analytics" },
    updatedAt,
    threadData: JSON.stringify({ headId, messages }),
  };
}

function setupSweep(
  job = {
    owner_email: owner,
    org_id: "org-1",
    thread_id: threadId,
    attempt_count: 1,
    lease_token: "job-lease",
    ready_at: 0,
  },
) {
  execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (
      sql.includes("UPDATE analytics_memory_capture_worker_lease") &&
      sql.includes("RETURNING")
    ) {
      return {
        rows: [{ lease_id: "analytics-memory-capture" }],
        rowsAffected: 1,
      };
    }
    if (sql.includes("WITH due AS")) {
      return { rows: [job], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 1 };
  });
}

describe("Analytics async memory capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues only the owner, thread, and org, then waits for the thread to go idle", async () => {
    execute.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      enqueueAnalyticsMemoryCapture({ owner, orgId: "org-1", threadId }),
    ).resolves.toBe(true);

    const [query] = execute.mock.calls[0] as [{ sql: string; args: unknown[] }];
    expect(query.sql).toContain("ON CONFLICT (owner_email, thread_id)");
    expect(query.args.slice(0, 3)).toEqual([owner, threadId, "org-1"]);
    expect(query.args[3]).toBeGreaterThan(query.args[4] as number);
    expect(JSON.stringify(query.args)).not.toContain("Remember that");
  });

  it("saves only explicit user guidance from the active Analytics thread", async () => {
    setupSweep();
    getThread.mockResolvedValue(
      thread([
        {
          message: {
            id: "user-1",
            role: "user",
            content: [
              {
                type: "text",
                text: "Correction: BigQuery uses STRING instead of TEXT for casts.",
              },
            ],
          },
          parentId: null,
        },
        {
          message: {
            id: "tool-1",
            role: "tool",
            content: [{ type: "text", text: "Remember that this is secret." }],
          },
          parentId: "user-1",
        },
        {
          message: {
            id: "abandoned-user-1",
            role: "user",
            content: [
              {
                type: "text",
                text: "Remember that customer Acme uses report 4812.",
              },
            ],
          },
          parentId: "tool-1",
        },
        {
          message: {
            id: "current-user-2",
            role: "user",
            content: [{ type: "text", text: "Thanks." }],
          },
          parentId: "user-1",
        },
      ]),
    );
    // The head is the last entry above; the abandoned branch is outside its ancestry.
    await runAnalyticsMemoryCaptureSweep();

    expect(runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: owner, run: { owner }, orgId: "org-1" },
      expect.any(Function),
    );
    expect(saveMemory).toHaveBeenCalledTimes(1);
    expect(saveMemory.mock.calls[0]?.[0]).toEqual([
      "--name",
      expect.stringMatching(/^analytics-guidance-[a-f0-9]{12}$/),
      "--type",
      "reference",
      "--description",
      expect.stringContaining("BigQuery"),
      "--content",
      "For future Analytics work: BigQuery uses STRING instead of TEXT for casts.",
      "--quiet",
      "true",
    ]);
    expect(track).toHaveBeenCalledWith("analytics_memory_capture", {
      status: "saved",
      candidate_count: 1,
      saved_count: 1,
    });
  });

  it("defers recently updated threads and skips wrong owners or apps", async () => {
    const now = Date.now();
    setupSweep();
    getThread.mockResolvedValue(thread([], now - 1_000));

    await runAnalyticsMemoryCaptureSweep();

    expect(saveMemory).not.toHaveBeenCalled();
    expect(
      execute.mock.calls.some(
        ([query]) =>
          typeof query === "object" &&
          "sql" in query &&
          String(query.sql).includes("SET ready_at = $4"),
      ),
    ).toBe(true);

    vi.clearAllMocks();
    setupSweep();
    getThread.mockResolvedValue({
      ...thread([
        {
          message: {
            id: "user-1",
            role: "user",
            content: [
              {
                type: "text",
                text: "Remember that BigQuery uses STRING instead of TEXT for casts.",
              },
            ],
          },
        },
      ]),
      source: { appId: "dispatch" },
    });

    await runAnalyticsMemoryCaptureSweep();

    expect(saveMemory).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("analytics_memory_capture", {
      status: "skipped",
      candidate_count: 0,
      saved_count: 0,
    });

    vi.clearAllMocks();
    setupSweep();
    getThread.mockResolvedValue({
      ...thread([
        {
          message: {
            id: "user-1",
            role: "user",
            content: [
              {
                type: "text",
                text: "Remember that BigQuery uses STRING instead of TEXT for casts.",
              },
            ],
          },
        },
      ]),
      ownerEmail: "different-owner@example.test",
    });

    await runAnalyticsMemoryCaptureSweep();

    expect(saveMemory).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("analytics_memory_capture", {
      status: "skipped",
      candidate_count: 0,
      saved_count: 0,
    });
  });
});
