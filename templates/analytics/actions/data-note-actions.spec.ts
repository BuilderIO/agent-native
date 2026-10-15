import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
  SKIPS_UNTRACKED,
} from "../shared/annotation-fixtures";

const scope = { email: "alice@example.test", orgId: "org-1" };
const mocks = vi.hoisted(() => ({
  requireDataNoteScope: vi.fn(),
  listDataNotes: vi.fn(async () => []),
  saveDataNote: vi.fn(async () => ({ id: "note-1" })),
  deleteDataNote: vi.fn(async () => ({ id: "note-1" })),
  dashboardAnnotationScope: vi.fn(),
}));
const reads = vi.hoisted(() => ({
  readDashboardForPlacement: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("../server/lib/data-notes-store.js", () => mocks);
vi.mock("../server/lib/dashboard-annotation-reads.js", () => reads);
vi.mock("../server/lib/dashboard-annotation-scope.js", () => ({
  dashboardAnnotationScope: mocks.dashboardAnnotationScope,
}));

const actions = {
  list: (await import("./list-data-notes")).default as any,
  save: (await import("./save-data-note")).default as any,
  remove: (await import("./delete-data-note")).default as any,
};

describe("data-note actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDataNoteScope.mockReturnValue(scope);
  });

  it("run every operation in the caller's scope", async () => {
    await expect(actions.list.run({})).resolves.toEqual({
      notes: [],
      editable: true,
    });
    expect(mocks.listDataNotes).toHaveBeenCalledWith(scope);

    const note = {
      kind: "incident",
      title: "Builder.io account setup failures",
      note: "Setup failures surged Oct 9–13.",
      startDate: "2026-10-09",
      matchEvents: ["builder_connect_failed"],
    };
    await actions.save.run(note);
    expect(mocks.saveDataNote).toHaveBeenCalledWith(scope, note);

    await actions.remove.run({ id: "note-1" });
    expect(mocks.deleteDataNote).toHaveBeenCalledWith(scope, "note-1");
  });

  it("checks a saved note against the dashboard on screen", async () => {
    reads.readDashboardForPlacement.mockResolvedValue({
      config: {
        panels: [
          {
            id: "failures",
            title: "Setup failures per day",
            chartType: "line",
            sql: "SELECT day, count(*) FROM events WHERE event_name = 'builder_connect_failed'",
          },
          {
            id: "signups",
            title: "Signups per day",
            chartType: "line",
            sql: "SELECT day, count(*) FROM signups",
          },
        ],
      },
    });
    mocks.saveDataNote.mockResolvedValueOnce(SETUP_INCIDENT as never);
    const { id: _, ...input } = SETUP_INCIDENT;

    const result = await actions.save.run({ ...input, dashboardId: "dash" });

    expect(reads.readDashboardForPlacement).toHaveBeenCalledWith("dash", scope);
    expect(mocks.saveDataNote).toHaveBeenCalledWith(scope, input);
    expect(result.dashboard).toEqual({
      dashboardId: "dash",
      shownOn: [{ panelId: "failures", title: "Setup failures per day" }],
    });
  });

  it("saves the note even when the dashboard on screen can't draw it", async () => {
    reads.readDashboardForPlacement.mockResolvedValue({
      unavailable: "Only SQL dashboards draw key dates and data notes.",
    });
    const { id: _, ...input } = SETUP_INCIDENT;

    const result = await actions.save.run({ ...input, dashboardId: "explore" });

    expect(mocks.saveDataNote).toHaveBeenCalledWith(scope, input);
    expect(result.dashboard).toEqual({
      dashboardId: "explore",
      hint: "Only SQL dashboards draw key dates and data notes.",
    });
  });

  it("saves nothing when the dashboard to check against can't be read", async () => {
    reads.readDashboardForPlacement.mockRejectedValue(
      new Error('Dashboard "gone" was not found.'),
    );
    await expect(
      actions.save.run({
        kind: "data",
        title: "Connect clicks undercounted",
        note: "Clicks are undercounted from Oct 2.",
        dashboardId: "gone",
      }),
    ).rejects.toThrow("not found");
    expect(mocks.saveDataNote).not.toHaveBeenCalled();
  });

  describe("for a dashboard from another organization", () => {
    const owner = { email: "owner@example.test", orgId: "org-2" };
    const counts = (event: string) =>
      `SELECT day, count(*) FROM events WHERE event_name = '${event}' GROUP BY 1`;
    const shared = (canEdit: boolean) => {
      mocks.dashboardAnnotationScope.mockResolvedValue({
        scope: owner,
        editable: false,
        dashboard: {
          id: "shared-dashboard",
          canEdit,
          config: {
            panels: [
              { id: "failures", sql: counts("builder_connect_failed") },
              { id: "clicks", sql: counts("builder connect clicked") },
            ],
            annotations: {
              hiddenDataNotes: [
                { noteId: CONNECT_UNDERCOUNT.id, panelId: "clicks" },
              ],
            },
          },
        },
      });
      mocks.listDataNotes.mockResolvedValue([
        SETUP_INCIDENT,
        CONNECT_UNDERCOUNT,
        SKIPS_UNTRACKED,
      ] as never);
    };

    it("lists only the notes its charts draw, without who added them", async () => {
      shared(false);

      const result = await actions.list.run({
        dashboardId: "shared-dashboard",
      });

      expect(mocks.dashboardAnnotationScope).toHaveBeenCalledWith(
        "shared-dashboard",
        scope,
      );
      expect(mocks.listDataNotes).toHaveBeenCalledWith(owner);
      const { addedBy: _, ...incident } = SETUP_INCIDENT;
      expect(result).toEqual({ notes: [incident], editable: false });
    });

    it("keeps the notes it hides for a reader who can show them again", async () => {
      shared(true);

      const result = await actions.list.run({
        dashboardId: "shared-dashboard",
      });

      expect(result.notes.map((note: { id: string }) => note.id)).toEqual([
        SETUP_INCIDENT.id,
        CONNECT_UNDERCOUNT.id,
      ]);
      expect(JSON.stringify(result)).not.toContain("@example.test");
    });
  });

  it("marks only the list as read-only", () => {
    expect(actions.list.readOnly).toBe(true);
    expect(actions.save.readOnly).toBeUndefined();
    expect(actions.remove.readOnly).toBeUndefined();
  });

  it("accepts a partial change by id and clearing a date with null", () => {
    expect(
      actions.save.schema.safeParse({ id: "note-1", endDate: null }).success,
    ).toBe(true);
    expect(
      actions.save.schema.safeParse({
        id: "note-1",
        status: "fixed",
        endDate: "2026-10-13",
        fix: "A deploy on Oct 13.",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown kinds and dates that are not YYYY-MM-DD", () => {
    expect(
      actions.save.schema.safeParse({ kind: "outage", title: "t", note: "n" })
        .success,
    ).toBe(false);
    expect(
      actions.save.schema.safeParse({ id: "note-1", startDate: "Oct 9" })
        .success,
    ).toBe(false);
  });
});
