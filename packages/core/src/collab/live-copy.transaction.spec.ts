import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDbExec,
  getDbExec,
  insideDbTransactionCallback,
} from "../db/client.js";
import type { BoundedTaskRunner } from "./bounded-tasks.js";
import { defineLiveCopy, releaseLiveCopy } from "./live-copy.js";
import { applyUpdate, mutateLiveCopy, seedLiveCopy } from "./ydoc-manager.js";

let tasks = 0;
const runner: BoundedTaskRunner = {
  name: "counting",
  run: async () => {
    tasks += 1;
    throw new Error("No task runs in this spec");
  },
  stats: () => ({ workers: 0, running: 0, queued: 0 }),
  close: async () => {},
};
const binding = defineLiveCopy({
  name: "transaction-spec",
  appliesTo: (docId) => docId.startsWith("live:"),
  runner,
});

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
});

afterAll(async () => {
  releaseLiveCopy(binding);
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

function refusals() {
  return Promise.all([
    applyUpdate("live:doc", new Uint8Array([0, 0])).catch((error) => error),
    mutateLiveCopy(binding, "live:doc", { edit: "spec" }).catch(
      (error) => error,
    ),
    seedLiveCopy(binding, "live:doc", { source: "base" }).catch(
      (error) => error,
    ),
  ]);
}

describe("live copies inside a caller's getDbExec().transaction()", () => {
  it("refuse every write before it runs a task", async () => {
    expect(insideDbTransactionCallback()).toBe(false);
    // The first transaction runs through the uninitialized proxy, the second
    // through the initialized one; each installs its own callback wrapper.
    for (let round = 0; round < 2; round++) {
      const errors = await getDbExec().transaction!(async () => {
        expect(insideDbTransactionCallback()).toBe(true);
        return refusals();
      });
      expect(errors).toEqual([
        expect.objectContaining({
          code: "write_refused",
          reason: "caller_transaction",
        }),
        expect.objectContaining({
          code: "write_refused",
          reason: "caller_transaction",
        }),
        expect.objectContaining({
          code: "write_refused",
          reason: "caller_transaction",
        }),
      ]);
    }
    expect(tasks).toBe(0);
    expect(insideDbTransactionCallback()).toBe(false);
  });

  it("lets work a transaction left running write once it commits", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let detached!: Promise<[boolean, unknown]>;
    await getDbExec().transaction!(async () => {
      detached = gate.then(async () => [
        insideDbTransactionCallback(),
        await seedLiveCopy(binding, "live:doc", { source: "base" }).catch(
          (error) => error,
        ),
      ]);
    });
    open();
    const [inside, error] = await detached;
    expect(inside).toBe(false);
    expect(error).not.toMatchObject({ reason: "caller_transaction" });
  });
});
