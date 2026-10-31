import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  executeAgentToolCall,
  type ActionEntry,
} from "../../../packages/core/src/agent/production-agent.js";

const path = join(
  tmpdir(),
  `slides-tool-input-${process.pid}-${Date.now()}.pglite`,
);
const owner = "tool-input-owner@example.com";
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let patchDeck: typeof import("./patch-deck.js").default;
const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${path}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  await (await import("../server/plugins/db.js")).runSlidesMigrations();
  patchDeck = (await import("./patch-deck.js")).default;
}, 120_000);

afterAll(() => rmSync(path, { recursive: true, force: true }));

it("refuses mixed placeholders without touching persisted metadata, then accepts sparse edits and explicit clears", async () => {
  const deck = {
    id: "input-fixture",
    title: "Fixture deck",
    slides: [],
    designSystemId: "default",
    shareToken: "fixture-share-reference",
    starred: true,
    visibility: "private",
    aspectRatio: "16:9",
  };
  await getDb()
    .insert(schema.decks)
    .values({
      id: deck.id,
      title: deck.title,
      data: JSON.stringify(deck),
      designSystemId: deck.designSystemId,
      ownerEmail: owner,
    });
  const read = async () => {
    const rows = await getDb()
      .select()
      .from(schema.decks)
      .where(eq(schema.decks.id, deck.id));
    const row = rows.at(0);
    if (!row) throw new Error("Expected fixture deck");
    return row;
  };
  const invoke = (
    callId: string,
    fields: Record<string, unknown>,
    extra = {},
  ) =>
    asOwner(() =>
      executeAgentToolCall({
        actions: { "patch-deck": patchDeck as unknown as ActionEntry },
        name: "patch-deck",
        callId,
        input: {
          deckId: deck.id,
          ...extra,
          operations: [{ op: "patch-deck-fields", fields }],
        },
      }),
    );
  const before = await read();
  const refused = await invoke(
    "mixed",
    {
      title: "Renamed fixture",
      designSystemId: "",
      shareToken: "",
      starred: false,
      visibility: "",
      aspectRatio: "",
    },
    { rewriteSource: null },
  );
  expect(refused.status).toBe("failed");
  expect(refused.output).toContain("No action was run");
  expect(await read()).toEqual(before);

  const renamed = await invoke("sparse", { title: "Renamed fixture" });
  expect(renamed.status, renamed.output).toBe("completed");
  const afterRename = await read();
  const { updatedAt: _updatedAt, ...saved } = JSON.parse(afterRename.data);
  expect(saved).toEqual({ ...deck, title: "Renamed fixture" });
  expect(afterRename.designSystemId).toBe("default");

  const cleared = await invoke("clear", {
    designSystemId: "",
    shareToken: "",
    starred: false,
  });
  expect(cleared.status, cleared.output).toBe("completed");
  const afterClear = await read();
  expect(JSON.parse(afterClear.data)).toMatchObject({
    title: "Renamed fixture",
    designSystemId: "",
    shareToken: "",
    starred: false,
  });
  expect(afterClear.designSystemId).toBe("");
});
