import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  agentToolContext,
  bootDesignDatabase,
  runCall,
  seedDesign,
} from "../server/lib/failed-write-test-harness.js";
import editDesign from "./edit-design.js";

// An agent that copies an element with a search/replace edit copies its ids
// too. The save path must hand the copy fresh ids whether or not an editor
// tab is open to do it.
const CARD =
  '<section id="card" data-agent-native-node-id="n1"><p>A</p></section>';
const page = (body: string) =>
  `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
let exec: DbExec;
let counter = 0;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

async function seedAndEdit(
  initial: string,
  edit: { search: string; replace: string },
): Promise<{ error: unknown; stored: string }> {
  const designId = `intro-ids-${++counter}`;
  await seedDesign(exec, designId, [
    { filename: "index.html", content: initial },
  ]);
  const { error } = await runCall(
    editDesign,
    { designId, filename: "index.html", edits: [edit] },
    agentToolContext("edit-design"),
  );
  const { rows } = await exec.execute({
    sql: "SELECT content FROM design_files WHERE id = ?",
    args: [`${designId}:index.html`],
  });
  return { error, stored: String(rows[0]?.content) };
}

describe("edit-design introduced ids", () => {
  it("saves a copied element with fresh ids and leaves the original alone", async () => {
    const { error, stored } = await seedAndEdit(page(CARD), {
      search: CARD,
      replace: CARD + CARD,
    });

    expect(error).toBeUndefined();
    expect(stored.match(/ id="card"/g)).toHaveLength(1);
    expect(stored.match(/ id="card-2"/g)).toHaveLength(1);
    const nodeIds = Array.from(
      stored.matchAll(/data-agent-native-node-id="([^"]*)"/g),
      ([, id]) => id,
    );
    expect(nodeIds).toHaveLength(2);
    expect(new Set(nodeIds).size).toBe(2);
    expect(nodeIds[0]).toBe("n1");
    expect(stored.indexOf('id="card"')).toBeLessThan(
      stored.indexOf('id="card-2"'),
    );
  });

  it("saves an edit that adds no copy exactly as sent", async () => {
    const { error, stored } = await seedAndEdit(page(CARD), {
      search: "<p>A</p>",
      replace: "<p>B</p>",
    });

    expect(error).toBeUndefined();
    expect(stored).toBe(page(CARD.replace("<p>A</p>", "<p>B</p>")));
  });
});
