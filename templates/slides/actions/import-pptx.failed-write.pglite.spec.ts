import {
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "@agent-native/core/action";
import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const fake = vi.hoisted(() => ({
  upload: vi.fn(),
  notifyClients: vi.fn(),
  file: { filename: "deck.pptx", data: Buffer.from("source") },
  presentation: undefined as unknown,
}));

vi.mock("@agent-native/core/file-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/file-upload")>()),
  uploadFile: fake.upload,
}));

// Only the reader of the source file is faked: the upload, the deck write and
// the action around them run for real.
vi.mock("../server/handlers/import/pptx-parser.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/handlers/import/pptx-parser.js")
  >()),
  parsePptx: async () => fake.presentation,
}));

vi.mock("../server/handlers/decks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/handlers/decks.js")>()),
  notifyClients: fake.notifyClients,
}));

// The local-disk fallback would write under the working directory.
vi.mock("../server/lib/import-asset-storage.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/import-asset-storage.js")
  >()),
  storeLocalImportedAsset: async () => null,
}));

vi.mock("./_uploaded-files.js", () => ({
  readUserUploadedFile: async () => fake.file,
}));

import importPptx from "./import-pptx.js";

// A failed import is classified by the writes the framework saw it make. The
// images a rejected PPTX import uploaded are orphan blobs no deck points to, so
// that rejection must still leave the agent free to retry, while a failure
// after a deck write must still stop it.
const OWNER = "owner@example.com";
const TOOL: ActionRunContext = {
  caller: "tool",
  actionName: "import-pptx",
  threadId: "thread-1",
  runId: "run-1",
  turnId: "turn-1",
};
const originalFetch = globalThis.fetch;
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/index.js").schema;

function imageSlide(imageCount: number) {
  return {
    texts: [],
    images: [],
    widthEmu: 9144000,
    heightEmu: 5143500,
    elements: Array.from({ length: imageCount }, (_, index) => ({
      id: `image-${index}`,
      kind: "image",
      name: `image ${index}`,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      image: {
        name: `image-${index}.png`,
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3]),
      },
    })),
  };
}

function usePresentation(imageCount: number) {
  fake.file = { filename: "deck.pptx", data: Buffer.from("source") };
  fake.presentation = {
    title: "Imported",
    slides: [imageSlide(imageCount)],
  };
}

/** Every upload is an HTTP write the framework sees; each then ends as `outcomes` says. */
function sendUploads(...outcomes: Array<"stored" | "rejected">) {
  globalThis.fetch = vi.fn(
    async () => new Response("{}", { status: 200 }),
  ) as unknown as typeof fetch;
  for (const [index, outcome] of outcomes.entries()) {
    fake.upload.mockImplementationOnce(async () => {
      await fetch("https://files.example.test/upload", { method: "PUT" });
      if (outcome === "rejected") throw new Error("The file store said no.");
      return { url: `https://files.example.test/image-${index}.png` };
    });
  }
}

async function seedDeck(id: string): Promise<void> {
  await getDb()
    .insert(schema.decks)
    .values({
      id,
      title: "Target",
      data: JSON.stringify({ id, title: "Target", slides: [] }),
      ownerEmail: OWNER,
    });
}

async function savedSlideCount(id: string): Promise<number> {
  const [row] = await getDb()
    .select()
    .from(schema.decks)
    .where(eq(schema.decks.id, id));
  return JSON.parse(row.data).slides.length;
}

async function deckCount(): Promise<number> {
  return (await getDb().select().from(schema.decks)).length;
}

async function runCall(args: Record<string, unknown>) {
  const outcome: ActionExecutionOutcome = { refused: false };
  const settled = await runWithRequestContext({ userEmail: OWNER }, () =>
    runActionWithExecutionOutcome(
      importPptx.run as Parameters<typeof runActionWithExecutionOutcome>[0],
      args,
      TOOL,
      outcome,
      importPptx,
    ),
  ).then(
    (result: unknown) => ({ result }),
    (error: unknown) => ({ error }),
  );
  const failed = "error" in settled ? { error: settled.error } : undefined;
  return {
    outcome,
    ...settled,
    effect: invocationEffect(importPptx, outcome, failed ? { failed } : {}),
  };
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  ({ getDb, schema } = await import("../server/db/index.js"));
  const { runSlidesMigrations } = await import("../server/plugins/db.js");
  await withMigrationRuntime(async () => {
    await runSlidesMigrations(undefined as never);
  });
}, 120_000);

afterEach(() => {
  fake.upload.mockReset();
  fake.notifyClients.mockReset();
  Object.defineProperty(globalThis, "fetch", {
    value: originalFetch,
    writable: true,
    configurable: true,
    enumerable: true,
  });
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("import-pptx", () => {
  it("is none when an image uploaded and another could not be preserved, and no deck is saved", async () => {
    await seedDeck("deck-rejected");
    usePresentation(2);
    sendUploads("stored", "rejected");
    const decksBefore = await deckCount();

    const { error, effect, outcome } = await runCall({
      filePath: "deck.pptx",
      deckId: "deck-rejected",
    });

    expect(error).toMatchObject({
      errorCode: "source_import_no_write",
      statusCode: 400,
      message: expect.stringContaining("No deck was written"),
    });
    expect(fake.upload).toHaveBeenCalledTimes(2);
    expect(outcome.evidence).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "http",
    });
    expect(effect.effect).toBe("none");
    expect(await savedSlideCount("deck-rejected")).toBe(0);
    expect(await deckCount()).toBe(decksBefore);
  });

  it("is none when no deck exists yet and the import creates none", async () => {
    usePresentation(2);
    sendUploads("stored", "rejected");
    const decksBefore = await deckCount();

    const { error, effect } = await runCall({ filePath: "deck.pptx" });

    expect((error as Error).message).toContain("No deck was written");
    expect(effect.effect).toBe("none");
    expect(await deckCount()).toBe(decksBefore);
  });

  it("is unknown when the slides were saved and the refresh signal then failed", async () => {
    await seedDeck("deck-saved");
    usePresentation(1);
    sendUploads("stored");
    fake.notifyClients.mockRejectedValue(new Error("The change feed is down."));

    const { error, effect } = await runCall({
      filePath: "deck.pptx",
      deckId: "deck-saved",
    });

    expect((error as Error).message).toContain("The change feed is down.");
    expect(effect.effect).toBe("unknown");
    expect(await savedSlideCount("deck-saved")).toBe(1);
  });
});
