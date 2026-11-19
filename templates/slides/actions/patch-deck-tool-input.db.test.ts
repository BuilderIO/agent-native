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

it("applies empty and omitted regex flags identically alongside padded optional fields", async () => {
  const content = "<p>Old old Old</p>";
  const deck = {
    id: "regex-flags-fixture",
    title: "Regex fixture",
    slides: [
      { id: "empty-flags", content },
      { id: "omitted-flags", content },
      { id: "explicit-flags", content },
    ],
    designSystemId: "default",
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
    if (!row) throw new Error("Expected regex fixture deck");
    return row;
  };
  const invoke = (callId: string, operations: unknown[]) =>
    asOwner(() =>
      executeAgentToolCall({
        actions: { "patch-deck": patchDeck as unknown as ActionEntry },
        name: "patch-deck",
        callId,
        input: { deckId: deck.id, operations },
      }),
    );
  const edit = { op: "regex-replace", pattern: "Old", replace: "New" };
  const result = await invoke("regex-flags", [
    {
      op: "patch-slide",
      slideId: "empty-flags",
      baseContentHash: null,
      edits: [{ ...edit, flags: "" }],
    },
    {
      op: "patch-slide",
      slideId: "omitted-flags",
      baseContentHash: null,
      edits: [edit],
    },
    {
      op: "patch-slide",
      slideId: "explicit-flags",
      edits: [{ ...edit, flags: "i", all: true }],
    },
  ]);
  expect(result.status).toBe("completed");
  const operations =
    patchDeck.tool.parameters?.properties.operations.items?.anyOf;
  const slidePatch = operations?.find(
    (branch) => branch.properties?.op.const === "patch-slide",
  );
  const regexEdit = slidePatch?.properties?.edits.items?.anyOf?.find(
    (branch) => branch.properties?.op.const === "regex-replace",
  );
  expect(regexEdit?.properties?.flags).toMatchObject({
    type: "string",
    default: "",
  });
  const saved = await read();
  const { updatedAt: _updatedAt, ...savedDeck } = JSON.parse(saved.data);
  expect(savedDeck).toEqual({
    ...deck,
    slides: [
      {
        id: "empty-flags",
        content: "<p>New old Old</p>",
        layoutFitRevision: expect.any(String),
      },
      {
        id: "omitted-flags",
        content: "<p>New old Old</p>",
        layoutFitRevision: expect.any(String),
      },
      {
        id: "explicit-flags",
        content: "<p>New New New</p>",
        layoutFitRevision: expect.any(String),
      },
    ],
  });

  const failed = await invoke("atomic-regex", [
    {
      op: "patch-slide",
      slideId: "empty-flags",
      edits: [{ op: "regex-replace", pattern: "New", replace: "Changed" }],
    },
    {
      op: "patch-slide",
      slideId: "omitted-flags",
      edits: [{ op: "regex-replace", pattern: "Missing", replace: "Never" }],
    },
  ]);
  expect(failed.status).toBe("failed");
  expect(failed.output).toContain("regex-replace found no matches");
  expect(await read()).toEqual(saved);
});

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
  // The agent schema shows only title and starred, and a chosen false is not a
  // clear, so the empty title is the value that could erase something.
  const refused = await invoke(
    "mixed",
    { title: "", starred: false },
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
