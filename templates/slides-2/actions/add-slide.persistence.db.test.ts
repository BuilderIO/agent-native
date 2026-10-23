import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `add-slide-source-readback-${process.pid}-${Date.now()}.pglite`,
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAppUrl = process.env.APP_URL;
const OWNER = {
  userEmail: "slides-2-add-slide-owner@example.test",
  orgId: "slides-2-add-slide-source-readback",
};
const DECK_ID = "slides-2-add-slide-source-readback-deck";
const SLIDE_ID = "generated-source-slide";
const GENERATED_SOURCE = `export default function Slide() {
  return <main><h1>Persisted generated source</h1></main>;
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
vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: mocks.notifyClients,
}));
vi.mock("./_agent-presence.js", () => ({
  slideLabelFor: (_slide: unknown, index: number) => `Slide ${index + 1}`,
  touchAgentSlidePresence: vi.fn(),
}));
vi.mock("../server/lib/slides-tracking.js", () => ({
  trackSlides: vi.fn(),
}));
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
  validateGenerationCreativeContext: vi.fn(
    async (input: {
      contextPackId?: string;
      contextModeOverride?: "off";
      reuseLabels?: Array<Record<string, unknown>>;
    }) => ({
      contextMode:
        input.contextModeOverride === "off"
          ? ("off" as const)
          : input.contextPackId
            ? ("auto" as const)
            : ("off" as const),
      contextPackId:
        input.contextModeOverride === "off"
          ? null
          : (input.contextPackId ?? null),
      reuseLabels: input.reuseLabels ?? [],
      results: [],
    }),
  ),
}));

let dbModule: typeof import("../server/db/index.js");
let addSlide: typeof import("./add-slide.js").default;
let getSlideSource: typeof import("./get-slide-source.js").default;
let hashSlideSource: typeof import("../server/lib/slide-source.js").hashSlideSource;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides-2.example.test";
  dbModule = await import("../server/db/index.js");
  addSlide = (await import("./add-slide.js")).default;
  getSlideSource = (await import("./get-slide-source.js")).default;
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

  await dbModule
    .getDb()
    .insert(dbModule.schema.decks)
    .values({
      id: DECK_ID,
      title: "Generated source readback",
      data: JSON.stringify({
        appId: "slides-2",
        title: "Generated source readback",
        slides: [],
      }),
      ownerEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
      visibility: "private",
      createdAt: "2026-10-18T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
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

describe("add-slide generated source SQL persistence", () => {
  it("reads back the exact generated source saved by add-slide", async () => {
    const added = await runWithRequestContext(OWNER, () =>
      addSlide.run({
        deckId: DECK_ID,
        slideId: SLIDE_ID,
        sourceTsx: GENERATED_SOURCE,
      }),
    );
    const [row] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    const storedDeck = JSON.parse(row.data) as {
      slides: Array<{
        id: string;
        sourceTsx: string;
        revision: number;
        sourceHash: string;
      }>;
    };
    const storedSlide = storedDeck.slides.find(
      (slide) => slide.id === SLIDE_ID,
    );
    const readback = await runWithRequestContext(OWNER, () =>
      getSlideSource.run({ deckId: DECK_ID, slideId: SLIDE_ID }),
    );

    expect(added._receipt).toMatchObject({ changed: true, verified: true });
    expect(storedSlide).toMatchObject({
      id: SLIDE_ID,
      sourceTsx: GENERATED_SOURCE,
      revision: 1,
      sourceHash: hashSlideSource(GENERATED_SOURCE),
    });
    expect(readback.slide).toMatchObject({
      id: SLIDE_ID,
      sourceTsx: GENERATED_SOURCE,
      revision: 1,
      sourceHash: hashSlideSource(GENERATED_SOURCE),
    });
  });
});
