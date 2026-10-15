import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = { email: "alice@example.test", orgId: "org-1" };
const mocks = vi.hoisted(() => ({
  requireKeyDateScope: vi.fn(),
  listKeyDateSets: vi.fn(async () => []),
  saveKeyDateSet: vi.fn(async () => ({ id: "set-1" })),
  deleteKeyDateSet: vi.fn(async () => ({ id: "set-1", deletedDates: 0 })),
  saveKeyDate: vi.fn(async () => ({ id: "date-1" })),
  deleteKeyDate: vi.fn(async () => ({ id: "date-1" })),
  dashboardAnnotationScope: vi.fn(),
}));
const reads = vi.hoisted(() => ({
  readDashboardConfigForAnnotations: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("../server/lib/key-dates-store.js", () => mocks);
vi.mock("../server/lib/dashboard-annotation-reads.js", () => reads);
vi.mock("../server/lib/dashboard-annotation-scope.js", () => ({
  dashboardAnnotationScope: mocks.dashboardAnnotationScope,
}));

const actions = {
  list: (await import("./list-key-dates")).default as any,
  saveSet: (await import("./save-key-date-set")).default as any,
  deleteSet: (await import("./delete-key-date-set")).default as any,
  save: (await import("./save-key-date")).default as any,
  remove: (await import("./delete-key-date")).default as any,
};

describe("key-date actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireKeyDateScope.mockReturnValue(scope);
  });

  it("run every operation in the caller's scope", async () => {
    await expect(actions.list.run({})).resolves.toEqual({
      sets: [],
      editable: true,
    });
    expect(mocks.listKeyDateSets).toHaveBeenCalledWith(scope);

    await actions.saveSet.run({ name: "Launches" });
    expect(mocks.saveKeyDateSet).toHaveBeenCalledWith(scope, {
      name: "Launches",
    });

    await actions.deleteSet.run({ id: "set-1" });
    expect(mocks.deleteKeyDateSet).toHaveBeenCalledWith(scope, "set-1");

    const keyDate = {
      setName: "Launches",
      date: "2026-10-14",
      time: "00:01",
      timeZone: "America/Los_Angeles",
      label: "Product Hunt live",
    };
    await actions.save.run(keyDate);
    expect(mocks.saveKeyDate).toHaveBeenCalledWith(scope, keyDate);

    await actions.remove.run({ id: "date-1" });
    expect(mocks.deleteKeyDate).toHaveBeenCalledWith(scope, "date-1");
  });

  it("says when the dashboard on screen hides the new date's set", async () => {
    reads.readDashboardConfigForAnnotations.mockResolvedValue({
      panels: [{ id: "signups", title: "Signups", chartType: "line" }],
      annotations: { hiddenKeyDateSets: ["launches"] },
    });
    mocks.saveKeyDate.mockResolvedValueOnce({
      id: "date-1",
      setId: "launches",
    } as never);

    const result = await actions.save.run({
      setName: "Launches",
      date: "2026-10-14",
      label: "Product Hunt live",
      dashboardId: "dash",
    });

    expect(mocks.saveKeyDate).toHaveBeenCalledWith(scope, {
      setName: "Launches",
      date: "2026-10-14",
      label: "Product Hunt live",
    });
    expect(result.dashboard).toMatchObject({
      dashboardId: "dash",
      setShown: false,
      hint: expect.stringContaining("hides the date's set"),
    });
  });

  it("lists the sets a dashboard draws, and says when they aren't the caller's", async () => {
    const owner = { email: "owner@example.test", orgId: "org-2" };
    mocks.dashboardAnnotationScope.mockResolvedValue({
      scope: owner,
      editable: false,
    });

    await expect(
      actions.list.run({ dashboardId: "shared-dashboard" }),
    ).resolves.toEqual({ sets: [], editable: false });
    expect(mocks.dashboardAnnotationScope).toHaveBeenCalledWith(
      "shared-dashboard",
      scope,
    );
    expect(mocks.listKeyDateSets).toHaveBeenCalledWith(owner);
  });

  it("marks only the list as read-only", () => {
    expect(actions.list.readOnly).toBe(true);
    for (const action of [
      actions.saveSet,
      actions.deleteSet,
      actions.save,
      actions.remove,
    ]) {
      expect(action.readOnly).toBeUndefined();
    }
  });

  it("accepts a key date without a time and rejects an empty label", () => {
    expect(
      actions.save.schema.safeParse({
        setName: "Product changes",
        date: "2026-09-22",
        label: "Role step first",
      }).success,
    ).toBe(true);
    expect(
      actions.save.schema.safeParse({ date: "2026-09-22", label: "" }).success,
    ).toBe(false);
  });

  it("takes null to clear a time and leaves an empty one for the store to refuse", () => {
    const edit = { id: "date-1", date: "2026-10-14", label: "Product Hunt" };
    expect(
      actions.save.schema.safeParse({ ...edit, time: null, timeZone: null })
        .success,
    ).toBe(true);
    expect(
      actions.save.schema.parse({ ...edit, time: "10:00", timeZone: "" }),
    ).toMatchObject({ timeZone: "" });
  });
});
