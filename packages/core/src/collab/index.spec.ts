import { describe, expect, it, vi } from "vitest";

import type { DbExec } from "../db/client.js";

const pool = vi.hoisted(() => ({
  getDbExec: vi.fn(() => {
    throw new Error("the pool was asked for a connection");
  }),
}));

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: pool.getDbExec,
}));

import { loadAwarenessRowsWith } from "./index";

describe("@agent-native/core/collab", () => {
  it("reads a document's presence through the client it is given, not the pool", async () => {
    const execute = vi.fn(async (_query: { sql: string; args: unknown[] }) => ({
      rows: [
        {
          client_id: "7",
          state: "{}",
          last_seen: "40000",
          client_sequence: 2,
          client_sequence_raw: 2,
          actor_email: " Reviewer@Example.com ",
          clear_token_hash: null,
          cleared: false,
        },
      ],
    }));

    const rows = await loadAwarenessRowsWith(
      { execute } as unknown as DbExec,
      "doc-1",
      50_000,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    // Live rows within 30 s, cleared rows within 60 s.
    expect(execute.mock.calls[0]![0].args).toEqual(["doc-1", 20_000, -10_000]);
    expect(rows).toEqual([
      {
        clientId: 7,
        state: "{}",
        lastSeen: 40_000,
        clientSequence: 2,
        clientSequenceRaw: 2,
        actorEmail: "reviewer@example.com",
        clearTokenHash: null,
        cleared: false,
      },
    ]);
    expect(pool.getDbExec).not.toHaveBeenCalled();
  });
});
