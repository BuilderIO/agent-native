import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

async function executePglite(
  input: string | { sql: string; args?: unknown[] },
) {
  if (typeof input === "string") {
    await pglite.exec(input);
    return { rows: [], rowsAffected: 0 };
  }
  const args = input.args ?? [];
  const result = await pglite.query(input.sql, args);
  return {
    rows: Array.from(result.rows ?? []),
    rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
  };
}

const db = { execute: vi.fn(executePglite) };

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  isProductionServerlessFunctionRuntime: () => false,
}));

const awaitingInputs = await import("./awaiting-input-store.js");

beforeAll(async () => {
  pglite = await createTestPglite();
});

beforeEach(async () => {
  awaitingInputs._resetIntegrationAwaitingInputStoreForTests();
  db.execute.mockReset();
  db.execute.mockImplementation(executePglite);
  await pglite.exec("DROP TABLE IF EXISTS integration_awaiting_inputs");
});

afterAll(async () => {
  await pglite.close();
});

describe("integration awaiting-input store", () => {
  it("atomically consumes one unmentioned reply for the exact user and thread", async () => {
    await awaitingInputs.setIntegrationAwaitingInput({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      requesterId: "U123",
    });

    await expect(
      awaitingInputs.consumeIntegrationAwaitingInput({
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        requesterId: "U999",
      }),
    ).resolves.toBe(false);
    await expect(
      awaitingInputs.consumeIntegrationAwaitingInput({
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        requesterId: "U123",
      }),
    ).resolves.toBe(true);
    await expect(
      awaitingInputs.consumeIntegrationAwaitingInput({
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        requesterId: "U123",
      }),
    ).resolves.toBe(false);
  });

  it("does not accept an expired clarification window", async () => {
    await awaitingInputs.setIntegrationAwaitingInput({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      requesterId: "U123",
      expiresAt: Date.now() - 1,
    });

    await expect(
      awaitingInputs.consumeIntegrationAwaitingInput({
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        requesterId: "U123",
      }),
    ).resolves.toBe(false);
  });

  it("clears a window when its thread reaches a terminal resolution", async () => {
    await awaitingInputs.setIntegrationAwaitingInput({
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      requesterId: "U123",
    });
    await awaitingInputs.clearIntegrationAwaitingInput(
      "slack",
      "A123:T123:C123:111.222",
    );

    await expect(
      awaitingInputs.consumeIntegrationAwaitingInput({
        platform: "slack",
        externalThreadId: "A123:T123:C123:111.222",
        requesterId: "U123",
      }),
    ).resolves.toBe(false);
  });
});
