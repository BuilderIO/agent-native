import { Worker } from "node:worker_threads";

import { afterEach, expect, it, vi } from "vitest";

import { executeSampleQuery } from "./sample-query.js";

afterEach(() => vi.restoreAllMocks());

it("terminates the running sample worker before acknowledging cancellation and frees its slot", async () => {
  const order: string[] = [];
  let releaseTermination: () => void = () => {};
  let terminationGate = new Promise<void>((resolve) => {
    releaseTermination = resolve;
  });
  const terminate = Worker.prototype.terminate;
  const terminated = vi
    .spyOn(Worker.prototype, "terminate")
    .mockImplementation(function (this: Worker) {
      return terminate.call(this).then(async (code) => {
        await terminationGate;
        order.push("terminated");
        return code;
      });
    });
  for (let attempt = 0; attempt < 3; attempt++) {
    terminationGate = new Promise<void>((resolve) => {
      releaseTermination = resolve;
    });
    const controller = new AbortController();
    const reason = new Error(`stop-${attempt}`);
    const running = executeSampleQuery(
      "select pg_sleep(30) from orders limit 1",
      [],
      true,
      controller.signal,
    );
    const observed = running.catch((error: unknown) => {
      order.push("rejected");
      throw error;
    });
    controller.abort(reason);
    await expect.poll(() => terminated.mock.calls.length).toBe(attempt + 1);
    expect(order).toEqual([]);
    releaseTermination();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          observed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Cancellation did not terminate the sample worker within two seconds",
                  ),
                ),
              2000,
            );
          }),
        ]),
      ).rejects.toBe(reason);
      expect(order.splice(0)).toEqual(["terminated", "rejected"]);
    } finally {
      clearTimeout(timer);
      await observed.catch(() => {});
    }
  }
  expect(terminated).toHaveBeenCalledTimes(3);
  const next = await executeSampleQuery(
    "select count(*) as total from orders",
    [],
    true,
  );
  expect(next?.output.rows).toEqual([[240]]);
});

it("rejects a pre-aborted sample request before starting a worker or answering a fast path", async () => {
  const controller = new AbortController();
  const reason = new Error("already stopped");
  controller.abort(reason);
  const terminated = vi.spyOn(Worker.prototype, "terminate");
  for (const sql of [
    "",
    "select * from orders limit 1",
    "select count(*) from orders",
  ])
    await expect(
      executeSampleQuery(sql, [], true, controller.signal),
    ).rejects.toBe(reason);
  expect(terminated).not.toHaveBeenCalled();
});
