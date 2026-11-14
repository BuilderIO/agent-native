import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbExec: {},
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => mocks.dbExec,
  getScopedTransactionDbExec: () => undefined,
}));

import {
  MissingExecutionFenceError,
  withExecutionFence,
  withExecutionLeaseRequested,
  withFencedExecutionWrite,
} from "./execution-fence.js";

describe("withFencedExecutionWrite missing lease context", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails closed when a lease was requested without a matching fence", async () => {
    const write = vi.fn(async () => "written");
    const run = withExecutionLeaseRequested(() =>
      withFencedExecutionWrite(write),
    );

    await expect(run).rejects.toBeInstanceOf(MissingExecutionFenceError);
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps writes available when no lease is requested", async () => {
    const write = vi.fn(async () => "written");

    await expect(withFencedExecutionWrite(write)).resolves.toBe("written");
    expect(write).toHaveBeenCalledOnce();
  });

  it("still rejects a scope that does not match its active lease", async () => {
    const write = vi.fn(async () => "written");

    await expect(
      withExecutionFence(
        {
          threadId: "thread-1",
          turnId: "turn-1",
          runId: "run-1",
          generation: "1",
        },
        () => withFencedExecutionWrite(write, { runId: "run-2" }),
      ),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });
    expect(write).not.toHaveBeenCalled();
  });
});
