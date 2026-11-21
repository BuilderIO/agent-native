import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecurringSweepHandler,
  RecurringSweepHandlerOptions,
} from "../jobs/sweep-hooks.js";
import type { DataProgramRow } from "./store.js";

const storeMocks = vi.hoisted(() => ({
  listScheduledDataPrograms: vi.fn(),
}));
const executeMocks = vi.hoisted(() => ({
  runScheduledDataProgram: vi.fn(),
  scheduledDataProgramDueAt: vi.fn(),
}));
const sweepMocks = vi.hoisted(() => ({
  registerRecurringSweepHandler: vi.fn(),
}));

vi.mock("./store.js", () => storeMocks);
vi.mock("./execute.js", () => executeMocks);
vi.mock("../jobs/sweep-hooks.js", () => sweepMocks);

const program = (id: string, title = id) => ({ id, title }) as DataProgramRow;

function scheduled(listed: DataProgramRow[], now = listed) {
  storeMocks.listScheduledDataPrograms.mockImplementation(
    async (_appId: string, id?: string) =>
      id === undefined ? listed : now.filter((p) => p.id === id),
  );
}

const ranIds = () =>
  executeMocks.runScheduledDataProgram.mock.calls.map(
    ([p]) => (p as DataProgramRow).id,
  );

beforeEach(() => {
  vi.resetModules();
  storeMocks.listScheduledDataPrograms.mockReset();
  executeMocks.runScheduledDataProgram.mockReset();
  executeMocks.scheduledDataProgramDueAt.mockReset();
  sweepMocks.registerRecurringSweepHandler.mockReset();
  scheduled([program("dp_a"), program("dp_b"), program("dp_c")]);
  executeMocks.runScheduledDataProgram.mockResolvedValue("refreshed");
});

describe("scheduled data program refreshes", () => {
  it("refreshes the app's scheduled programs in turn, leaving the sweep time to finish", async () => {
    const { runScheduledDataProgramRefreshes } =
      await import("./scheduled-refresh.js");
    const deadlineAt = Date.now() + 90_000;
    const controller = new AbortController();

    const outcomes = await runScheduledDataProgramRefreshes("analytics", {
      deadlineAt,
      signal: controller.signal,
    });

    expect(storeMocks.listScheduledDataPrograms).toHaveBeenCalledWith(
      "analytics",
    );
    expect(ranIds()).toEqual(["dp_a", "dp_b", "dp_c"]);
    for (const [, options] of executeMocks.runScheduledDataProgram.mock.calls) {
      expect(options).toMatchObject({ signal: controller.signal });
      expect(options.deadline).toBeLessThan(deadlineAt);
    }
    expect(outcomes).toEqual({
      dp_a: "refreshed",
      dp_b: "refreshed",
      dp_c: "refreshed",
    });
  });

  it("reads each program again just before its turn", async () => {
    scheduled(
      [program("dp_a"), program("dp_b", "old"), program("dp_c")],
      [program("dp_a"), program("dp_b", "saved since")],
    );
    const { runScheduledDataProgramRefreshes } =
      await import("./scheduled-refresh.js");

    const outcomes = await runScheduledDataProgramRefreshes("analytics", {
      deadlineAt: Date.now() + 90_000,
    });

    expect(
      executeMocks.runScheduledDataProgram.mock.calls.map(
        ([p]) => (p as DataProgramRow).title,
      ),
    ).toEqual(["dp_a", "saved since"]);
    expect(outcomes).toEqual({
      dp_a: "refreshed",
      dp_b: "refreshed",
      dp_c: "skipped",
    });
  });

  it("goes on past a program whose refresh threw, then throws so the sweep reports it", async () => {
    const thrown = new Error("database went away");
    executeMocks.runScheduledDataProgram
      .mockRejectedValueOnce(thrown)
      .mockResolvedValue("fresh");
    const { runScheduledDataProgramRefreshes } =
      await import("./scheduled-refresh.js");

    const pass = runScheduledDataProgramRefreshes("analytics", {
      deadlineAt: Date.now() + 90_000,
    });

    await expect(pass).rejects.toMatchObject({
      message: "Scheduled refresh of dp_a in analytics threw.",
      errors: [thrown],
    });
    expect(ranIds()).toEqual(["dp_a", "dp_b", "dp_c"]);
  });

  it("stops once the sweep is out of time or aborted", async () => {
    const { runScheduledDataProgramRefreshes } =
      await import("./scheduled-refresh.js");

    await expect(
      runScheduledDataProgramRefreshes("analytics", {
        deadlineAt: Date.now() + 1_000,
      }),
    ).resolves.toEqual({});

    const controller = new AbortController();
    executeMocks.runScheduledDataProgram.mockImplementation(async () => {
      controller.abort();
      return "refreshed";
    });
    await expect(
      runScheduledDataProgramRefreshes("analytics", {
        deadlineAt: Date.now() + 90_000,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ dp_a: "refreshed" });
  });

  it("stops at the first program there wasn't time to start", async () => {
    executeMocks.runScheduledDataProgram
      .mockResolvedValueOnce("refreshed")
      .mockResolvedValueOnce("no_time");
    const { runScheduledDataProgramRefreshes } =
      await import("./scheduled-refresh.js");

    const outcomes = await runScheduledDataProgramRefreshes("analytics", {
      deadlineAt: Date.now() + 90_000,
    });

    expect(outcomes).toEqual({ dp_a: "refreshed", dp_b: "no_time" });
    expect(ranIds()).toEqual(["dp_a", "dp_b"]);
  });

  it("registers one sweep handler per app that refreshes its programs", async () => {
    const { registerScheduledDataProgramRefresh, SCHEDULED_REFRESH_SWEEP_ID } =
      await import("./scheduled-refresh.js");

    registerScheduledDataProgramRefresh("analytics");

    expect(sweepMocks.registerRecurringSweepHandler).toHaveBeenCalledWith(
      `${SCHEDULED_REFRESH_SWEEP_ID}:analytics`,
      expect.any(Function),
      { nextDueAt: expect.any(Function) },
    );
    const [, handler, options] = sweepMocks.registerRecurringSweepHandler.mock
      .calls[0] as [
      string,
      RecurringSweepHandler,
      RecurringSweepHandlerOptions,
    ];
    await handler({ deadlineAt: Date.now() + 90_000 });
    expect(executeMocks.runScheduledDataProgram).toHaveBeenCalledTimes(3);

    executeMocks.scheduledDataProgramDueAt.mockResolvedValue(12_345);
    await expect(options.nextDueAt?.()).resolves.toBe(12_345);
  });

  it("answers when the app's next refresh is due, so an idle sweep wakes for it", async () => {
    const { nextScheduledDataProgramDueAt } =
      await import("./scheduled-refresh.js");
    const dueAt: Record<string, number | null> = {
      dp_a: 5_000,
      dp_b: null,
      dp_c: 3_000,
    };
    executeMocks.scheduledDataProgramDueAt.mockImplementation(
      async (p: DataProgramRow) => dueAt[p.id],
    );

    await expect(
      nextScheduledDataProgramDueAt("analytics", 1_000),
    ).resolves.toBe(3_000);

    dueAt.dp_a = 1_000;
    executeMocks.scheduledDataProgramDueAt.mockClear();
    await expect(
      nextScheduledDataProgramDueAt("analytics", 1_000),
    ).resolves.toBe(1_000);
    expect(executeMocks.scheduledDataProgramDueAt).toHaveBeenCalledTimes(1);

    scheduled([]);
    await expect(
      nextScheduledDataProgramDueAt("analytics", 1_000),
    ).resolves.toBeNull();
  });
});
