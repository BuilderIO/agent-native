import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `prompt-slide-readback-${process.pid}-${Date.now()}.pglite`,
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAppUrl = process.env.APP_URL;
const OWNER = { userEmail: "slides-2-generation-owner@example.test" };
const DECK_ID = "prompt-generation-readback";
const SLIDE_ID = "generated-slide-1";
const GENERATION_CONTEXT = {
  originalPrompt: "Create a short product launch deck",
  files: [],
  designSystemId: null,
  referenceDeckId: null,
  mode: "new" as const,
  generationAttemptId: "prompt-attempt-1",
  generationStartedAt: 123,
  targetSlideCount: 1,
};
const SOURCE = `export default function Slide() {
  return <main><h1>Launch plan</h1><p>Three steps to market.</p></main>;
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
vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: mocks.notifyClients,
}));
vi.mock("../server/lib/slides-tracking.js", () => ({
  trackSlides: vi.fn(),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("./_deck-tracking.js", () => ({
  trackDeckCreationStarted: vi.fn(),
}));
vi.mock("./_agent-presence.js", () => ({
  slideLabelFor: (_slide: unknown, index: number) => `Slide ${index + 1}`,
  touchAgentSlidePresence: vi.fn(),
}));

let dbModule: typeof import("../server/db/index.js");
let createDeck: typeof import("./create-deck.js").default;
let addSlide: typeof import("./add-slide.js").default;
let getDeck: typeof import("./get-deck.js").default;
let hashSlideSource: typeof import("../server/lib/slide-source.js").hashSlideSource;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides-2.example.test";
  dbModule = await import("../server/db/index.js");
  createDeck = (await import("./create-deck.js")).default;
  addSlide = (await import("./add-slide.js")).default;
  getDeck = (await import("./get-deck.js")).default;
  hashSlideSource = (await import("../server/lib/slide-source.js"))
    .hashSlideSource;

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
}, 120000);

afterAll(async () => {
  await closeDbExec();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("prompt generation SQL readback", () => {
  it("persists the prompt draft and generated slide for later deck reads", async () => {
    const draft = await runWithRequestContext(OWNER, () =>
      createDeck.run({
        title: "Product launch",
        slides: [],
        promptDraft: {
          id: DECK_ID,
          designSystemId: null,
          generationContext: GENERATION_CONTEXT,
        },
      }),
    );

    expect(draft).toMatchObject({
      id: DECK_ID,
      slideCount: 0,
      persistenceStatus: "verified",
    });

    const added = await runWithRequestContext(OWNER, () =>
      addSlide.run({ deckId: DECK_ID, slideId: SLIDE_ID, sourceTsx: SOURCE }),
    );
    const [row] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    const stored = JSON.parse(row.data) as {
      generationContext: typeof GENERATION_CONTEXT;
      slides: Array<{
        id: string;
        sourceTsx: string;
        revision: number;
        sourceHash: string;
      }>;
    };
    const readback = await runWithRequestContext(OWNER, () =>
      getDeck.run({ id: DECK_ID, compact: "false" }),
    );

    expect(added).toMatchObject({
      slideId: SLIDE_ID,
      revision: 1,
      sourceHash: hashSlideSource(SOURCE),
      _receipt: { changed: true, verified: true },
    });
    expect(stored.generationContext).toEqual(GENERATION_CONTEXT);
    expect(stored.slides).toHaveLength(1);
    expect(stored.slides[0]).toMatchObject({
      id: SLIDE_ID,
      sourceTsx: SOURCE,
      revision: 1,
      sourceHash: hashSlideSource(SOURCE),
    });
    expect(readback).toMatchObject({
      id: DECK_ID,
      generationContext: GENERATION_CONTEXT,
      slideCount: 1,
      slides: [
        {
          id: SLIDE_ID,
          sourceTsx: SOURCE,
          revision: 1,
          sourceHash: hashSlideSource(SOURCE),
        },
      ],
    });
  });
});
