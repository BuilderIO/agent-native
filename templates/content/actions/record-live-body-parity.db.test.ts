import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const counted = vi.hoisted(() => [] as Record<string, unknown>[]);
const shadowFlag = vi.hoisted(() => ({ enabled: true }));

vi.mock("@agent-native/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/feature-flags")
  >()),
  isFeatureFlagEnabled: async () => shadowFlag.enabled,
}));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  countOutcome: (event: string, dimensions: Record<string, unknown>) => {
    if (event === "content_live_body_parity_counts") counted.push(dimensions);
  },
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `record-live-body-parity-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let recordLiveBodyParityAction: typeof import("./record-live-body-parity.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  recordLiveBodyParityAction = (await import("./record-live-body-parity.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(() => {
  counted.length = 0;
  shadowFlag.enabled = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;

async function privatePage() {
  counter += 1;
  const id = `doc_${counter}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    parentId: null,
    title: "Untitled",
    content: "Alpha paragraph",
    position: 0,
    visibility: "private",
    orgId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

type Report = Omit<Parameters<typeof recordLiveBodyParityAction.run>[0], "id">;

function record(
  id: string,
  report: Report = { outcome: "match", ms: 12, bytes: 2048 },
  {
    userEmail = OWNER,
    caller = "frontend",
  }: { userEmail?: string; caller?: "frontend" | "tool" } = {},
) {
  return runWithRequestContext({ userEmail }, () =>
    recordLiveBodyParityAction.run({ id, ...report }, { caller, userEmail }),
  );
}

describe("record-live-body-parity", () => {
  it("counts an editor's outcome with its cost", async () => {
    const id = await privatePage();

    await expect(record(id)).resolves.toEqual({ recorded: true });
    expect(counted).toEqual([{ outcome: "match", ms: "<50", kb: "<10" }]);
  });

  it("logs where a mismatch starts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await privatePage();
    const mismatch = {
      block: 2,
      liveBlockType: "paragraph",
      savedBlockType: "heading",
      at: 40,
    };

    await record(id, { outcome: "mismatch", ms: 12, bytes: 2048, mismatch });
    expect(counted).toEqual([expect.objectContaining({ outcome: "mismatch" })]);
    expect(warn).toHaveBeenCalledWith(
      "[content] live body differs from the editor save",
      { documentId: id, ...mismatch },
    );
  });

  it("counts nothing while the flag is off on the server", async () => {
    shadowFlag.enabled = false;
    const id = await privatePage();

    await expect(record(id)).resolves.toEqual({ recorded: false });
    expect(counted).toEqual([]);
  });

  it("is closed to tools and sandboxed extensions", () => {
    // Extensions reach actions through the host page's tool bridge, which
    // core refuses only for actions that are not tool-callable.
    expect(recordLiveBodyParityAction).toMatchObject({
      uiOnly: true,
      toolCallable: false,
    });
  });

  it("refuses callers other than the signed-in app UI", async () => {
    const id = await privatePage();

    await expect(record(id, undefined, { caller: "tool" })).rejects.toThrow(
      /signed-in app UI/,
    );
    expect(counted).toEqual([]);
  });

  it("refuses a user who cannot edit the page", async () => {
    const id = await privatePage();

    await expect(
      record(id, undefined, { userEmail: "stranger@example.com" }),
    ).rejects.toThrow();
    expect(counted).toEqual([]);
  });
});
