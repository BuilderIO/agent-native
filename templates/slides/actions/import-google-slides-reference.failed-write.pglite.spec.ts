import {
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "@agent-native/core/action";
import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import {
  getOAuthTokens,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
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
  ssrfSafeFetch: vi.fn(),
  presentation: undefined as unknown,
}));

vi.mock("@agent-native/core/file-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/file-upload")>()),
  uploadFile: fake.upload,
}));

// Slides' native image lookup goes through the SSRF-safe fetch, which resolves
// DNS before connecting.
vi.mock("@agent-native/core/extensions/url-safety", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/extensions/url-safety")
  >()),
  ssrfSafeFetch: fake.ssrfSafeFetch,
}));

// Only the reader of the exported file is faked: the token refresh, the upload,
// the deck write and the action around them run for real.
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

import importGoogleSlides from "./import-google-slides-reference.js";

// A failed import is classified by the writes the framework saw it make. The
// images a rejected import uploaded are orphan blobs no deck points to, and the
// access token it refreshed on the way is not deck data either, so that
// rejection must still leave the agent free to retry, while a failure after a
// deck write must still stop it.
const OWNER = "owner@example.com";
const ACCOUNT = "owner@example.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOOL: ActionRunContext = {
  caller: "tool",
  actionName: "import-google-slides-reference",
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
  fake.presentation = {
    title: "Imported",
    slides: [imageSlide(imageCount)],
  };
}

/** The access token on file has expired, so the call refreshes and saves a new one. */
async function seedExpiredToken(): Promise<void> {
  await saveOAuthTokens(
    "google",
    ACCOUNT,
    {
      access_token: "expired-access-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() - 60_000,
      scope: DRIVE_SCOPE,
    },
    OWNER,
  );
}

/**
 * Google answers the refresh, the export and the image lookup; every upload is
 * an HTTP write the framework sees, and each then ends as `outcomes` says.
 */
function sendUploads(...outcomes: Array<"stored" | "rejected">) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({
        access_token: "refreshed-access-token",
        expires_in: 3600,
        scope: DRIVE_SCOPE,
      });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      return new Response(new Uint8Array([1, 2, 3]));
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  fake.ssrfSafeFetch.mockImplementation(async () =>
    Response.json({ slides: [] }),
  );
  for (const [index, outcome] of outcomes.entries()) {
    fake.upload.mockImplementationOnce(async () => {
      await fetch("https://files.example.test/upload", { method: "PUT" });
      if (outcome === "rejected") throw new Error("The file store said no.");
      return { url: `https://files.example.test/image-${index}.png` };
    });
  }
}

async function deckCount(): Promise<number> {
  return (await getDb().select().from(schema.decks)).length;
}

async function runCall(args: Record<string, unknown>) {
  const outcome: ActionExecutionOutcome = { refused: false };
  const settled = await runWithRequestContext({ userEmail: OWNER }, () =>
    runActionWithExecutionOutcome(
      importGoogleSlides.run as Parameters<
        typeof runActionWithExecutionOutcome
      >[0],
      args,
      TOOL,
      outcome,
      importGoogleSlides,
    ),
  ).then(
    (result: unknown) => ({ result }),
    (error: unknown) => ({ error }),
  );
  const failed = "error" in settled ? { error: settled.error } : undefined;
  return {
    outcome,
    ...settled,
    effect: invocationEffect(
      importGoogleSlides,
      outcome,
      failed ? { failed } : {},
    ),
  };
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
  ({ getDb, schema } = await import("../server/db/index.js"));
  const { runSlidesMigrations } = await import("../server/plugins/db.js");
  await withMigrationRuntime(async () => {
    await runSlidesMigrations(undefined as never);
  });
}, 120_000);

afterEach(() => {
  fake.upload.mockReset();
  fake.notifyClients.mockReset();
  fake.ssrfSafeFetch.mockReset();
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

describe("import-google-slides-reference", () => {
  it("is none when the token was refreshed, an image uploaded and another could not be preserved, and no deck is saved", async () => {
    await seedExpiredToken();
    usePresentation(2);
    sendUploads("stored", "rejected");
    const decksBefore = await deckCount();

    const { error, effect, outcome } = await runCall({
      fileId: "presentation_123",
    });

    expect(error).toMatchObject({
      errorCode: "source_import_no_write",
      statusCode: 400,
      message: expect.stringContaining("No deck was written"),
    });
    expect(fake.upload).toHaveBeenCalledTimes(2);
    expect(await getOAuthTokens("google", ACCOUNT, OWNER)).toMatchObject({
      access_token: "refreshed-access-token",
    });
    expect(outcome.evidence).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "http",
    });
    expect(effect.effect).toBe("none");
    expect(await deckCount()).toBe(decksBefore);
  });

  it("is unknown when the deck was saved and the refresh signal then failed", async () => {
    usePresentation(1);
    sendUploads("stored");
    fake.notifyClients.mockRejectedValue(new Error("The change feed is down."));
    const decksBefore = await deckCount();

    const { error, effect } = await runCall({ fileId: "presentation_123" });

    expect((error as Error).message).toContain("The change feed is down.");
    expect(effect.effect).toBe("unknown");
    expect(await deckCount()).toBe(decksBefore + 1);
  });
});
