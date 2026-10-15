import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDashboard: vi.fn(),
  loadDashboardSeed: vi.fn(),
}));

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return { getDb: mocks.getDb, schema };
});
vi.mock("./dashboards-store.js", () => ({ getDashboard: mocks.getDashboard }));
vi.mock("./dashboard-seeds.js", () => ({
  loadDashboardSeed: mocks.loadDashboardSeed,
}));

import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
} from "../../shared/annotation-fixtures.js";
import * as dbModule from "../db/index.js";
import {
  loadDashboardAnnotationSummary,
  readDashboardForPlacement,
} from "./dashboard-annotation-reads.js";
import type { DashboardRecord } from "./dashboards-store.js";
import { DATA_NOTES_MIGRATION_SQL } from "./data-notes-migration.js";
import { saveDataNote } from "./data-notes-store.js";
import { KEY_DATES_MIGRATION_SQL } from "./key-dates-migration.js";
import { saveKeyDate } from "./key-dates-store.js";

const alice = { email: "alice@example.test", orgId: "org-1" };
const carol = { email: "carol@example.test", orgId: "org-2" };

const config = {
  panels: [
    {
      id: "failures",
      title: "Setup failures per day",
      chartType: "line",
      sql: "SELECT day, count(*) FROM events WHERE event_name = 'builder_connect_failed' GROUP BY 1",
    },
  ],
};

const noteInput = ({
  id: _,
  addedBy: __,
  updatedAt: ___,
  ...note
}: typeof SETUP_INCIDENT) => note;

describe("dashboard annotation reads", () => {
  type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    mocks.getDb.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    mocks.getDashboard.mockReset();
    mocks.loadDashboardSeed.mockReset();
    for (const statement of [
      ...KEY_DATES_MIGRATION_SQL,
      ...DATA_NOTES_MIGRATION_SQL,
    ]) {
      await client.exec(statement);
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it("summarizes one organization's key dates and notes for a dashboard", async () => {
    await saveKeyDate(alice, {
      setName: "Launches",
      date: "2026-10-14",
      time: "00:01",
      timeZone: "America/Los_Angeles",
      label: "Product Hunt live",
    });
    const incident = await saveDataNote(alice, noteInput(SETUP_INCIDENT));
    await saveDataNote(carol, noteInput({ ...CONNECT_UNDERCOUNT }));
    await saveDataNote(carol, {
      ...noteInput(SETUP_INCIDENT),
      title: "Another organization's note",
    });

    const summary = await loadDashboardAnnotationSummary(
      { scope: alice, editable: true },
      "dash",
      config,
    );

    expect(summary).toEqual({
      keyDateSets: [
        {
          id: expect.any(String),
          name: "Launches",
          shown: true,
          dateCount: 1,
          recentDates: [
            {
              date: "2026-10-14",
              time: "00:01",
              timeZone: "America/Los_Angeles",
              label: "Product Hunt live",
            },
          ],
        },
      ],
      dataNotes: [
        {
          id: incident.id,
          kind: "incident",
          title: "Builder.io account setup failures",
          status: "fixed",
          startDate: "2026-10-09",
          endDate: "2026-10-13",
          panelIds: ["failures"],
        },
      ],
    });
  });

  it("says the annotations could not be read when a store fails", async () => {
    await client.exec("DROP TABLE analytics_data_notes");

    const summary = await loadDashboardAnnotationSummary(
      { scope: alice, editable: true },
      "dash",
      config,
    );

    expect(summary).toEqual({
      annotationsError: expect.stringContaining(
        "Key dates and data notes could not be read",
      ),
    });
  });

  describe("for another organization's dashboard", () => {
    const readFor = async (canEdit: boolean) => {
      await saveKeyDate(carol, {
        setName: "Launches",
        date: "2026-10-14",
        label: "Product Hunt live",
      });
      const changes = await saveKeyDate(carol, {
        setName: "Product changes",
        date: "2026-09-22",
        label: "New onboarding flow",
      });
      const incident = await saveDataNote(carol, noteInput(SETUP_INCIDENT));
      const hiding = {
        ...config,
        annotations: {
          hiddenKeyDateSets: [changes.setId],
          hiddenDataNotes: [{ noteId: incident.id, panelId: "failures" }],
        },
      };
      return loadDashboardAnnotationSummary(
        {
          scope: carol,
          editable: false,
          dashboard: { canEdit } as DashboardRecord,
        },
        "dash",
        hiding,
      );
    };

    it("shows a reader only what it draws, and that it isn't theirs to change", async () => {
      expect(await readFor(false)).toEqual({
        keyDateSets: [
          expect.objectContaining({ name: "Launches", shown: true }),
        ],
        dataNotes: [],
        editable: false,
      });
    });

    it("keeps what it hides for a reader who can show it again", async () => {
      const summary = await readFor(true);
      expect(summary).toMatchObject({ editable: false });
      expect(
        "keyDateSets" in summary && summary.keyDateSets.map(({ name }) => name),
      ).toEqual(["Launches", "Product changes"]);
      expect("dataNotes" in summary && summary.dataNotes).toEqual([
        expect.objectContaining({
          title: "Builder.io account setup failures",
          panelIds: [],
          hiddenOnPanelIds: ["failures"],
        }),
      ]);
    });
  });

  it("reads a saved dashboard's config, falls back to its seed, and fails when neither exists", async () => {
    const stored = { kind: "sql", ownerEmail: alice.email, orgId: alice.orgId };
    mocks.getDashboard.mockResolvedValueOnce({ ...stored, config });
    await expect(readDashboardForPlacement("dash", alice)).resolves.toEqual({
      config,
    });
    expect(mocks.getDashboard).toHaveBeenCalledWith("dash", alice);

    mocks.getDashboard.mockResolvedValueOnce(null);
    mocks.loadDashboardSeed.mockReturnValueOnce(config);
    await expect(readDashboardForPlacement("seeded", alice)).resolves.toEqual({
      config,
    });

    mocks.getDashboard.mockResolvedValueOnce(null);
    mocks.loadDashboardSeed.mockReturnValueOnce(null);
    await expect(readDashboardForPlacement("gone", alice)).rejects.toThrow(
      'Dashboard "gone" was not found.',
    );
  });

  it("says why a dashboard can't draw the caller's markers instead of failing", async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      kind: "explorer",
      ownerEmail: alice.email,
      orgId: alice.orgId,
      config: {},
    });
    await expect(readDashboardForPlacement("explore", alice)).resolves.toEqual({
      unavailable: expect.stringContaining("Explorer dashboard"),
    });

    mocks.getDashboard.mockResolvedValueOnce({
      kind: "sql",
      ownerEmail: carol.email,
      orgId: carol.orgId,
      config,
    });
    await expect(readDashboardForPlacement("shared", alice)).resolves.toEqual({
      unavailable: expect.stringContaining("another organization's"),
    });
    expect(mocks.loadDashboardSeed).not.toHaveBeenCalled();
  });
});
