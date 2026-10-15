import { beforeEach, describe, expect, it, vi } from "vitest";

import { SETUP_INCIDENT } from "../shared/annotation-fixtures";

const scope = { email: "alice@example.test", orgId: "org-1" };
const mocks = vi.hoisted(() => ({
  requireDataNoteScope: vi.fn(),
  listDataNotes: vi.fn(async () => []),
  saveDataNote: vi.fn(async () => ({ id: "note-1" })),
  deleteDataNote: vi.fn(async () => ({ id: "note-1" })),
}));
const reads = vi.hoisted(() => ({
  readDashboardConfigForAnnotations: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("../server/lib/data-notes-store.js", () => mocks);
vi.mock("../server/lib/dashboard-annotation-reads.js", () => reads);

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
    await expect(actions.list.run({})).resolves.toEqual({ notes: [] });
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
    reads.readDashboardConfigForAnnotations.mockResolvedValue({
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
    });
    mocks.saveDataNote.mockResolvedValueOnce(SETUP_INCIDENT as never);
    const { id: _, ...input } = SETUP_INCIDENT;

    const result = await actions.save.run({ ...input, dashboardId: "dash" });

    expect(reads.readDashboardConfigForAnnotations).toHaveBeenCalledWith(
      "dash",
      scope,
    );
    expect(mocks.saveDataNote).toHaveBeenCalledWith(scope, input);
    expect(result.dashboard).toEqual({
      dashboardId: "dash",
      shownOn: [{ panelId: "failures", title: "Setup failures per day" }],
    });
  });

  it("saves nothing when the dashboard to check against can't be read", async () => {
    reads.readDashboardConfigForAnnotations.mockRejectedValue(
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
