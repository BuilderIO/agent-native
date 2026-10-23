import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { useT } from "@agent-native/core/client/i18n";
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideTransition } from "../../../shared/slides-2-transition";
import { readSourceTransition, transitionForPreset } from "./motion-source";
import { Slides2Inspector } from "./Slides2Inspector";
import { Slides2MotionPanel } from "./Slides2MotionPanel";
import type { ElementSnapshot, SourceEditOp } from "./types";

const TEST_DB_PATH = join(
  tmpdir(),
  `slides-2-inspector-source-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = {
  userEmail: "slides-2-inspector-owner@example.test",
  orgId: "slides-2-inspector-source",
};
const DECK_ID = "slides-2-inspector-source-deck";
const SLIDE_ID = "inspector-slide";
const MOTION_DECK_ID = "slides-2-motion-source-deck";
const MOTION_SLIDE_ID = "motion-slide";
const INITIAL_SOURCE = [
  "export default function Slide() {",
  "  return (",
  "    <main>",
  '      <div data-slide-object-id="headline" style={{ position: "absolute", left: "80px", top: "64px", width: "160px", height: "48px" }}>Before</div>',
  "    </main>",
  "  );",
  "}",
].join("\n");
const MOTION_SOURCE = [
  "export default function Slide() {",
  "  return <main><h1>Motion</h1></main>;",
  "}",
].join("\n");

const notifyClients = vi.hoisted(() => vi.fn());
vi.mock("../../../server/handlers/decks.js", () => ({ notifyClients }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const t = ((key: string) => key.split(".").at(-1) ?? key) as ReturnType<
  typeof useT
>;

let dbModule: typeof import("../../../server/db/index.js");
let updateSlideSource: typeof import("../../../actions/update-slide-source.js").default;
let getSlideSource: typeof import("../../../actions/get-slide-source.js").default;
let getDbExec: typeof import("@agent-native/core/db").getDbExec;
let runWithRequestContext: typeof import("@agent-native/core/server").runWithRequestContext;
let initialSourceHash: string;
let initialMotionSourceHash: string;

beforeAll(async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  Reflect.deleteProperty(globalThis, "window");
  try {
    getDbExec = (await import("@agent-native/core/db")).getDbExec;
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

    initialSourceHash = (
      await import("../../../server/lib/slide-source.js")
    ).hashSlideSource(INITIAL_SOURCE);
    initialMotionSourceHash = (
      await import("../../../server/lib/slide-source.js")
    ).hashSlideSource(MOTION_SOURCE);
    await dbModule
      .getDb()
      .insert(dbModule.schema.decks)
      .values({
        id: DECK_ID,
        title: "Inspector source edit",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Inspector source edit",
          slides: [
            {
              id: SLIDE_ID,
              sourceTsx: INITIAL_SOURCE,
              revision: 1,
              sourceHash: initialSourceHash,
              content:
                '<main><div style="position:absolute;left:80px;top:64px;width:160px;height:48px">Before</div></main>',
            },
          ],
        }),
        ownerEmail: OWNER.userEmail,
        orgId: OWNER.orgId,
        visibility: "private",
        createdAt: "2026-10-18T00:00:00.000Z",
        updatedAt: "2026-10-18T00:00:00.000Z",
      });
    await dbModule
      .getDb()
      .insert(dbModule.schema.decks)
      .values({
        id: MOTION_DECK_ID,
        title: "Motion source save",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Motion source save",
          slides: [
            {
              id: MOTION_SLIDE_ID,
              sourceTsx: MOTION_SOURCE,
              revision: 1,
              sourceHash: initialMotionSourceHash,
              content: "<main><h1>Motion</h1></main>",
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

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("Slides2Inspector source save", () => {
  it("persists a width edit and reloads the saved slide source", async () => {
    const selected: ElementSnapshot = {
      nodeId: "headline",
      line: 4,
      column: 6,
      tagName: "div",
      bounds: { x: 80, y: 64, width: 160, height: 48 },
      text: "Before",
      styles: { width: "160px" },
    };
    let savePromise: Promise<unknown> | null = null;
    const onEdit = vi.fn((ops: SourceEditOp[]) => {
      savePromise = Promise.resolve(
        runWithRequestContext(OWNER, () =>
          updateSlideSource.run({
            deckId: DECK_ID,
            slideId: SLIDE_ID,
            expectedRevision: 1,
            expectedSourceHash: initialSourceHash,
            edits: [{ line: selected.line, column: selected.column, ops }],
          }),
        ),
      );
    });

    render(
      <TooltipProvider>
        <Slides2Inspector
          selected={selected}
          selectionCount={1}
          disabled={false}
          t={t}
          onEdit={onEdit}
          onAlign={vi.fn()}
          alignToSlide={false}
          onAlignToSlideChange={vi.fn()}
          smartGuidesEnabled
          onSmartGuidesChange={vi.fn()}
          onDistribute={vi.fn()}
          onArrange={vi.fn()}
          onGroup={vi.fn()}
          onUngroup={vi.fn()}
          canUngroup={false}
          onDuplicateObject={vi.fn()}
          onDeleteObject={vi.fn()}
          canSelectParent={false}
          onSelectParent={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByLabelText("arrange"));
    const positionSummary = screen.getByText("position").closest("summary");
    if (!positionSummary) throw new Error("Missing Position disclosure");
    fireEvent.click(positionSummary);
    const width = screen.getByRole("spinbutton", { name: "width px" });
    fireEvent.focus(width);
    fireEvent.change(width, { target: { value: "280" } });
    fireEvent.blur(width);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "width",
        value: "280px",
        prevText: "Before",
      },
    ]);
    expect(savePromise).not.toBeNull();
    const saved = await savePromise;
    const reloaded = await runWithRequestContext(OWNER, () =>
      getSlideSource.run({ deckId: DECK_ID, slideId: SLIDE_ID }),
    );
    const [row] = await dbModule
      .getDb()
      .select({ data: dbModule.schema.decks.data })
      .from(dbModule.schema.decks)
      .where(eq(dbModule.schema.decks.id, DECK_ID))
      .limit(1);
    const storedData = JSON.parse(row.data) as {
      slides: Array<{ id: string; sourceTsx: string; revision: number }>;
    };
    const persistedSlide = storedData.slides.find(
      (slide) => slide.id === SLIDE_ID,
    );

    expect(saved).toMatchObject({ revision: 2 });
    expect(persistedSlide).toMatchObject({ revision: 2 });
    expect(persistedSlide?.sourceTsx).toMatch(/width:\s*['"]280px['"]/);
    expect(reloaded.slide).toMatchObject({
      sourceTsx: persistedSlide?.sourceTsx,
      revision: 2,
    });
  });

  it("persists a panel transition through update-slide-source and reads it back", async () => {
    const savedIdentities: Array<{ revision: number; sourceHash: string }> = [];
    const onCommit = vi.fn(async (sourceTsx: string) => {
      const saved = await runWithRequestContext(OWNER, () =>
        updateSlideSource.run({
          deckId: MOTION_DECK_ID,
          slideId: MOTION_SLIDE_ID,
          expectedRevision: 1,
          expectedSourceHash: initialMotionSourceHash,
          sourceTsx,
        }),
      );
      savedIdentities.push(saved);
      return true;
    });
    const t = ((key: string) => key) as ReturnType<typeof useT>;

    render(
      <Slides2MotionPanel
        sourceTsx={MOTION_SOURCE}
        selection={null}
        disabled={false}
        t={t}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.transition_fade" }),
    );
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());

    const reloaded = await runWithRequestContext(OWNER, () =>
      getSlideSource.run({
        deckId: MOTION_DECK_ID,
        slideId: MOTION_SLIDE_ID,
      }),
    );
    const transition = transitionForPreset("fade", 500);
    const savedIdentity = savedIdentities[0];

    expect(savedIdentity).toMatchObject({
      revision: 2,
      sourceHash: expect.any(String),
    });
    expect(reloaded.slide).toMatchObject({
      sourceTsx: onCommit.mock.calls[0]?.[0],
      revision: 2,
      sourceHash: savedIdentity?.sourceHash,
    });
    expect(reloaded.slide.sourceHash).not.toBe(initialMotionSourceHash);
    expect(readSourceTransition(reloaded.slide.sourceTsx, "module")).toEqual(
      transition,
    );
  });
});
