import Database from "better-sqlite3";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let sqlite: Database.Database;

async function executeSqlite(
  input: string | { sql: string; args?: unknown[] },
) {
  if (typeof input === "string") {
    sqlite.exec(input);
    return { rows: [], rowsAffected: 0 };
  }
  const statement = sqlite.prepare(input.sql);
  const args = input.args ?? [];
  if (statement.reader) {
    return { rows: statement.all(...args), rowsAffected: 0 };
  }
  const result = statement.run(...args);
  return { rows: [], rowsAffected: result.changes };
}

const db = { execute: vi.fn(executeSqlite) };

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const awaitingInputs = await import("./awaiting-input-store.js");

beforeAll(() => {
  sqlite = new Database(":memory:");
});

beforeEach(() => {
  awaitingInputs._resetIntegrationAwaitingInputStoreForTests();
  db.execute.mockReset();
  db.execute.mockImplementation(executeSqlite);
  sqlite.exec("DROP TABLE IF EXISTS integration_awaiting_inputs");
});

afterAll(() => {
  sqlite.close();
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
