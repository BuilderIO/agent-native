import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `deck-generation-persistence-${process.pid}-${Date.now()}.pglite`,
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAppUrl = process.env.APP_URL;
const OWNER = { userEmail: "slides-2-deck-roundtrip@example.test" };
const DECK_ID = "slides-2-generated-deck-roundtrip";
const SLIDE_ID = "generated-source-slide";
const INITIAL_DATA = JSON.stringify({
  appId: "slides-2",
  title: "Generation draft",
  slides: [],
});
const SOURCE = `export default function Slide() {
  return <main><h1>Persisted launch plan</h1><p>Three steps to market.</p></main>;
}`;

const mocks = vi.hoisted(() => ({
  middleware: [] as Array<{
    path: string;
    handler: (event: unknown) => Promise<unknown>;
  }>,
  notifyClients: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getH3App: () => ({
      use: (path: string, handler: (event: unknown) => Promise<unknown>) => {
        mocks.middleware.push({ path, handler });
      },
    }),
  };
});
vi.mock("@agent-native/core/application-state", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/application-state")
    >();
  return { ...actual, writeAppState: vi.fn(async () => undefined) };
});
vi.mock("@agent-native/core/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/shared")>();
  return {
    ...actual,
    loadAgentDesignSystemContext: vi.fn(async () => null),
  };
});
vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: vi.fn(async () => null),
  mergeCreativeContextReuseLabels: (
    previous: Array<Record<string, unknown>>,
    next: Array<Record<string, unknown>>,
  ) => [...previous, ...next],
  recordGenerationCreativeContext: vi.fn(async () => undefined),
  replaceCreativeContextElementProvenance: (
    previous: Array<{ elementId: string }>,
    next: Array<{ elementId: string }>,
  ) => [...previous, ...next],
  validateGenerationCreativeContext: vi.fn(async () => ({
    contextMode: "off" as const,
    contextPackId: null,
    reuseLabels: [],
    results: [],
  })),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: mocks.notifyClients,
}));
vi.mock("../server/lib/slides-tracking.js", () => ({
  trackSlides: vi.fn(),
}));
vi.mock("../server/lib/deck-versions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/deck-versions.js")>();
  return {
    ...actual,
    createDeckVersionSnapshot: vi.fn(async () => ({ created: true })),
  };
});
vi.mock("./_deck-tracking.js", () => ({
  trackDeckCreationStarted: vi.fn(),
  trackSlideContentEdited: vi.fn(),
}));
vi.mock("./_tab-state.js", () => ({
  writeAppStateForCurrentTab: vi.fn(async () => undefined),
}));

let dbModule: typeof import("../server/db/index.js");
let createDeck: typeof import("./create-deck.js").default;
let patchDeck: typeof import("./patch-deck.js").default;
let getDeck: typeof import("./get-deck.js").default;
let hashSlideContent: typeof import("../shared/slide-fit.js").hashSlideContent;
let hashSlideSource: typeof import("../server/lib/slide-source.js").hashSlideSource;
let renderSlideSource: typeof import("../server/lib/slide-source.js").renderSlideSource;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides-2.example.test";
  dbModule = await import("../server/db/index.js");
  createDeck = (await import("./create-deck.js")).default;
  patchDeck = (await import("./patch-deck.js")).default;
  getDeck = (await import("./get-deck.js")).default;
  hashSlideContent = (await import("../shared/slide-fit.js")).hashSlideContent;
  const slideSource = await import("../server/lib/slide-source.js");
  hashSlideSource = slideSource.hashSlideSource;
  renderSlideSource = slideSource.renderSlideSource;

  const plugin = (await import("../server/plugins/db.js")).default;
  plugin({ h3: {} } as never);
  const readiness = mocks.middleware.find(
    ({ path }) => path === "/_agent-native",
  )?.handler;
  if (!readiness) {
    throw new Error("Slides DB plugin did not register readiness middleware");
  }
  await readiness({});
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);

  await dbModule.getDb().insert(dbModule.schema.decks).values({
    id: DECK_ID,
    title: "Generation draft",
    data: INITIAL_DATA,
    ownerEmail: OWNER.userEmail,
    visibility: "private",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  });
}, 120000);

afterAll(async () => {
  await closeDbExec();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("generated deck SQL round-trip", () => {
  it("persists generated source and preview through create-deck and patch-deck", async () => {
    const created = await runWithRequestContext(OWNER, () =>
      createDeck.run({
        deckId: DECK_ID,
        title: "Launch plan",
        slides: [{ id: SLIDE_ID, sourceTsx: SOURCE, notes: "Three steps." }],
      }),
    );
    const [afterCreate] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    const storedAfterCreate = JSON.parse(afterCreate.data) as {
      slides: Array<{
        id: string;
        sourceTsx: string;
        sourceHash: string;
        revision: number;
        content: string;
      }>;
    };
    const createdSlide = storedAfterCreate.slides[0];
    const expectedPreview = renderSlideSource(SOURCE, new Map());

    expect(created.persistenceStatus).toBe("verified");
    expect(createdSlide).toMatchObject({
      id: SLIDE_ID,
      sourceTsx: SOURCE,
      sourceHash: hashSlideSource(SOURCE),
      revision: 1,
      content: expectedPreview,
    });

    const patched = await runWithRequestContext(OWNER, () =>
      patchDeck.run(
        {
          deckId: DECK_ID,
          operations: [
            {
              op: "patch-slide",
              slideId: SLIDE_ID,
              fields: { notes: "Reviewed: three steps." },
            },
          ],
        },
        { caller: "tool" } as never,
      ),
    );
    const persisted = await runWithRequestContext(OWNER, () =>
      getDeck.run({ id: DECK_ID, compact: "false", slideId: SLIDE_ID }),
    );
    const [afterPatch] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    const storedAfterPatch = JSON.parse(afterPatch.data) as {
      slides: Array<{
        id: string;
        sourceTsx: string;
        sourceHash: string;
        revision: number;
        content: string;
        notes: string;
      }>;
    };
    const persistedSlide = storedAfterPatch.slides[0];
    const readbackSlide = (
      persisted as { slides: Array<Record<string, unknown>> }
    ).slides[0];

    expect(patched).toMatchObject({
      ok: true,
      updatedSlideIds: [SLIDE_ID],
    });
    expect(persistedSlide).toMatchObject({
      id: SLIDE_ID,
      sourceTsx: SOURCE,
      sourceHash: hashSlideSource(SOURCE),
      revision: 1,
      content: expectedPreview,
      notes: "Reviewed: three steps.",
    });
    expect(readbackSlide).toMatchObject({
      id: SLIDE_ID,
      sourceTsx: SOURCE,
      sourceHash: hashSlideSource(SOURCE),
      revision: 1,
      content: expectedPreview,
      notes: "Reviewed: three steps.",
    });

    await expect(
      runWithRequestContext(OWNER, () =>
        patchDeck.run(
          {
            deckId: DECK_ID,
            operations: [
              {
                op: "patch-slide",
                slideId: SLIDE_ID,
                baseContentHash: hashSlideContent(expectedPreview),
                fields: { content: "<main><h1>Detached preview</h1></main>" },
              },
            ],
          },
          { caller: "tool" } as never,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "slide_source_action_required" });

    const [afterRejectedPatch] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    expect(JSON.parse(afterRejectedPatch.data).slides[0]).toMatchObject({
      sourceTsx: SOURCE,
      sourceHash: hashSlideSource(SOURCE),
      revision: 1,
      content: expectedPreview,
      notes: "Reviewed: three steps.",
    });
  });
});
