import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  isTransientCatalogAvailability,
  waitForCatalogReady,
} from "./catalog-readiness.js";

class Failure extends Error {
  constructor(
    readonly action: string,
    readonly status: number,
    readonly errorCode: string,
  ) {
    super(`${action} ${status} ${errorCode}`);
  }
}

const clock = () => {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
};

const unavailable = () =>
  new Failure("get-data-browser-catalog", 403, "data_connection_unavailable");

test("a just-created connection that is briefly unavailable is retried until ready", async () => {
  const time = clock();
  const reads = [
    () => Promise.reject(unavailable()),
    () => Promise.reject(unavailable()),
    () => Promise.resolve("refreshing"),
    () => Promise.resolve("ready"),
  ];
  let call = 0;
  const outcome = await waitForCatalogReady({
    read: () => reads[call++]!(),
    isTransient: isTransientCatalogAvailability,
    timeoutMs: 90000,
    intervalsMs: [1000, 3000, 5000],
    ...time,
  });
  assert.equal(call, 4);
  assert.equal(outcome.attempts, 4);
  assert.equal(outcome.transientFailures, 2);
});

test("a connection that never becomes available fails at the deadline with its last failure", async () => {
  const time = clock();
  let call = 0;
  await assert.rejects(
    waitForCatalogReady({
      read: () => {
        call++;
        return Promise.reject(unavailable());
      },
      isTransient: isTransientCatalogAvailability,
      timeoutMs: 20000,
      intervalsMs: [1000, 3000, 5000],
      ...time,
    }),
    (error: Error) => {
      assert.match(error.message, /not ready within 20000ms/);
      assert.match(error.message, new RegExp(`${call} attempts`));
      assert.match(error.message, /data_connection_unavailable/);
      assert.ok(error.cause instanceof Failure);
      return true;
    },
  );
  assert.ok(call > 3 && time.now() <= 25000);
});

test("any other failure is not retried", async () => {
  for (const failure of [
    new Failure("get-data-browser-catalog", 403, "data_connection_ai_disabled"),
    new Failure("get-data-browser-catalog", 500, "data_connection_unavailable"),
    new Failure("list-connection-datasets", 403, "data_connection_unavailable"),
    new Error("network down"),
  ]) {
    let call = 0;
    await assert.rejects(
      waitForCatalogReady({
        read: () => {
          call++;
          return Promise.reject(failure);
        },
        isTransient: isTransientCatalogAvailability,
        timeoutMs: 90000,
        intervalsMs: [1000],
        ...clock(),
      }),
      (error) => error === failure,
    );
    assert.equal(call, 1);
  }
});

test("a catalog that stays unready times out without hiding its state", async () => {
  await assert.rejects(
    waitForCatalogReady({
      read: () => Promise.resolve("refreshing"),
      isTransient: isTransientCatalogAvailability,
      timeoutMs: 10000,
      intervalsMs: [2000],
      ...clock(),
    }),
    /not ready within 10000ms.*last state refreshing/,
  );
});
