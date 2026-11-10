import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const governed = vi.hoisted(() => ({ content: "" }));

vi.mock("@agent-native/core/private-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/private-blob")>()),
  readPrivateBlob: vi.fn(async () => ({
    data: Buffer.from(governed.content),
    metadata: {
      appId: "content",
      resourceType: "document",
      resourceId: "governed-doc",
      contentHash: createHash("sha256").update(governed.content).digest("hex"),
    },
  })),
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
  resolveNativeContextCloneReference: vi.fn(async () => ({
    publishedItemVersionId: "version-1",
    cloneHandle: { key: "private" },
  })),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-clone-creative-context-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let cloneDocument: typeof import("./clone-creative-context-document.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  cloneDocument = (await import("./clone-creative-context-document.js"))
    .default;
  await (await import("../server/plugins/db.js")).default(undefined as never);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("clone-creative-context-document", () => {
  it("clones a governed document whose videos share an id", async () => {
    const video = (caption: string) =>
      `<video src="https://example.com/a.mp4" id="video-original">${caption}</video>`;
    governed.content = `Intro\n${video("Demo")}\n${video("Copy")}`;

    const cloned = await runWithRequestContext({ userEmail: OWNER }, () =>
      cloneDocument.run({
        contextId: "context-1",
        artifactKey: "content:document:governed-doc",
        resourceId: "governed-doc",
      }),
    );

    const [stored] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, cloned.id));
    expect(stored.content).toBe(governed.content);
  });
});
