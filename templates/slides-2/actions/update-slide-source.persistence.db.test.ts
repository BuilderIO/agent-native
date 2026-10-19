import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `slide-source-roundtrip-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = {
  userEmail: "slides-2-source-owner@example.test",
  orgId: "slides-2-source-roundtrip",
};
const DECK_ID = "slides-2-source-roundtrip-deck";
const SLIDE_ID = "source-slide";
const INITIAL_SOURCE = `export default function Slide() {
  return <main><h1>Before</h1></main>;
}`;
const UPDATED_SOURCE = `export default function Slide() {
  return <main><h1>Persisted after update</h1></main>;
}`;

const notifyClients = vi.hoisted(() => vi.fn());
vi.mock("../server/handlers/decks.js", () => ({ notifyClients }));

let dbModule: typeof import("../server/db/index.js");
let updateSlideSource: typeof import("./update-slide-source.js").default;
let getSlideSource: typeof import("./get-slide-source.js").default;
let hashSlideSource: typeof import("../server/lib/slide-source.js").hashSlideSource;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides-2.example.test";
  dbModule = await import("../server/db/index.js");
  updateSlideSource = (await import("./update-slide-source.js")).default;
  getSlideSource = (await import("./get-slide-source.js")).default;
  hashSlideSource = (await import("../server/lib/slide-source.js"))
    .hashSlideSource;

  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);

  const initialData = JSON.stringify({
    appId: "slides-2",
    title: "Source roundtrip",
    slides: [
      {
        id: SLIDE_ID,
        sourceTsx: INITIAL_SOURCE,
        revision: 1,
        sourceHash: hashSlideSource(INITIAL_SOURCE),
        content: "<main><h1>Before</h1></main>",
      },
    ],
  });
  await dbModule.getDb().insert(dbModule.schema.decks).values({
    id: DECK_ID,
    title: "Source roundtrip",
    data: initialData,
    ownerEmail: OWNER.userEmail,
    orgId: OWNER.orgId,
    visibility: "private",
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  });
}, 120000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("update-slide-source SQL persistence", () => {
  it("reads back the canonical source, revision, and hash after a saved update", async () => {
    const updated = await runWithRequestContext(OWNER, () =>
      updateSlideSource.run({
        deckId: DECK_ID,
        slideId: SLIDE_ID,
        expectedRevision: 1,
        expectedSourceHash: hashSlideSource(INITIAL_SOURCE),
        sourceTsx: UPDATED_SOURCE,
      }),
    );
    const readback = await runWithRequestContext(OWNER, () =>
      getSlideSource.run({ deckId: DECK_ID, slideId: SLIDE_ID }),
    );
    const [row] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    const storedData = JSON.parse(row.data) as {
      slides: Array<{
        id: string;
        sourceTsx: string;
        revision: number;
        sourceHash: string;
      }>;
    };
    const persistedSlide = storedData.slides.find(
      (slide) => slide.id === SLIDE_ID,
    );

    expect(persistedSlide).toBeDefined();
    expect(updated).toMatchObject({
      sourceTsx: UPDATED_SOURCE,
      revision: 2,
      sourceHash: hashSlideSource(UPDATED_SOURCE),
      nextRequiredAction: "get-slide-source",
    });
    expect(readback.slide).toMatchObject({
      sourceTsx: persistedSlide!.sourceTsx,
      revision: persistedSlide!.revision,
      sourceHash: persistedSlide!.sourceHash,
    });
    expect(persistedSlide).toMatchObject({
      sourceTsx: updated.sourceTsx,
      revision: updated.revision,
      sourceHash: updated.sourceHash,
    });
  });
});
