// @vitest-environment happy-dom

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { useT } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { InlineTextEditor } from "./inline-text-editor";
import type { ElementSnapshot, SourceEdit } from "./types";

const TEST_DB_PATH = join(
  tmpdir(),
  `slides-2-inline-text-source-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = {
  userEmail: "slides-2-inline-text-owner@example.test",
  orgId: "slides-2-inline-text-source",
};
const DECK_ID = "slides-2-inline-text-source-deck";
const SLIDE_ID = "inline-text-slide";
const INITIAL_SOURCE = [
  "export default function Slide() {",
  "  return (",
  "    <main>",
  "      <h1>Hello</h1>",
  "    </main>",
  "  );",
  "}",
].join("\n");

const notifyClients = vi.hoisted(() => vi.fn());
vi.mock("../../../server/handlers/decks.js", () => ({ notifyClients }));

const t = ((key: string) => key) as ReturnType<typeof useT>;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAppUrl = process.env.APP_URL;

let closeDbExec: typeof import("@agent-native/core/db").closeDbExec;
let getDbExec: typeof import("@agent-native/core/db").getDbExec;
let runWithRequestContext: typeof import("@agent-native/core/server").runWithRequestContext;
let dbModule: typeof import("../../../server/db/index.js");
let updateSlideSource: typeof import("../../../actions/update-slide-source.js").default;
let getSlideSource: typeof import("../../../actions/get-slide-source.js").default;
let hashSlideSource: typeof import("../../../server/lib/slide-source.js").hashSlideSource;
let sourceHash: string;

beforeAll(async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  Reflect.deleteProperty(globalThis, "window");
  try {
    const coreDb = await import("@agent-native/core/db");
    closeDbExec = coreDb.closeDbExec;
    getDbExec = coreDb.getDbExec;
    runWithRequestContext = (await import("@agent-native/core/server"))
      .runWithRequestContext;
    process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
    process.env.APP_URL = "https://slides-2.example.test";
    dbModule = await import("../../../server/db/index.js");
    updateSlideSource = (
      await import("../../../actions/update-slide-source.js")
    ).default;
    getSlideSource = (await import("../../../actions/get-slide-source.js"))
      .default;
    hashSlideSource = (await import("../../../server/lib/slide-source.js"))
      .hashSlideSource;

    const { runSlidesMigrations } =
      await import("../../../server/plugins/db.js");
    await runSlidesMigrations({});
    await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
    )`);
    await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL, joined_at BIGINT NOT NULL,
      federation_removal_pending_at INTEGER
    )`);

    sourceHash = hashSlideSource(INITIAL_SOURCE);
    await dbModule
      .getDb()
      .insert(dbModule.schema.decks)
      .values({
        id: DECK_ID,
        title: "Inline text source save",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Inline text source save",
          slides: [
            {
              id: SLIDE_ID,
              sourceTsx: INITIAL_SOURCE,
              revision: 1,
              sourceHash,
              content: "<main><h1>Hello</h1></main>",
            },
          ],
        }),
        ownerEmail: OWNER.userEmail,
        orgId: OWNER.orgId,
        visibility: "private",
        createdAt: "2026-10-18T00:00:00.000Z",
        updatedAt: "2026-10-18T00:00:00.000Z",
      });
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    }
  }
}, 120000);

afterEach(cleanup);

afterAll(async () => {
  await closeDbExec();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("InlineTextEditor source persistence", () => {
  it("saves edited text through the source action and reads it back", async () => {
    const node: ElementSnapshot = {
      nodeId: "headline",
      line: 4,
      column: 7,
      tagName: "h1",
      bounds: { x: 80, y: 64, width: 800, height: 72 },
      text: "Hello",
      styles: { fontSize: "48px" },
    };
    const savedResults: Array<{
      revision: number;
      sourceHash: string;
      sourceTsx: string;
    }> = [];
    const onCommit = vi.fn(async (edits: SourceEdit[]) => {
      const saved = await runWithRequestContext(OWNER, () =>
        updateSlideSource.run({
          deckId: DECK_ID,
          slideId: SLIDE_ID,
          expectedRevision: 1,
          expectedSourceHash: sourceHash,
          edits,
        }),
      );
      savedResults.push(saved);
      return true;
    });

    render(
      <InlineTextEditor
        node={node}
        disabled={false}
        t={t}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "styleInspector.text",
    });
    editor.textContent = "Persisted headline";
    fireEvent.input(editor);
    fireEvent.click(
      screen.getByRole("button", { name: "designSystemSetup.saveChanges" }),
    );

    await waitFor(() => expect(savedResults).toHaveLength(1));
    expect(onCommit).toHaveBeenCalledWith([
      {
        line: 4,
        column: 7,
        ops: [
          {
            kind: "set-text",
            value: "Persisted headline",
            prevText: "Hello",
          },
        ],
      },
    ]);
    expect(savedResults[0]).toMatchObject({
      sourceTsx: expect.stringContaining("<h1>Persisted headline</h1>"),
      revision: 2,
      sourceHash: expect.any(String),
    });

    const readback = await runWithRequestContext(OWNER, () =>
      getSlideSource.run({ deckId: DECK_ID, slideId: SLIDE_ID }),
    );
    expect(readback.slide).toMatchObject({
      sourceTsx: savedResults[0]?.sourceTsx,
      revision: savedResults[0]?.revision,
      sourceHash: savedResults[0]?.sourceHash,
    });
  });
});
