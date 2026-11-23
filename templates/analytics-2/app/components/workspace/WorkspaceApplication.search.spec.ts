import { expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal()),
  callAction,
}));

import { searchWorkspace } from "../../lib/workspace-search";

it("report A2-QUICK-SEARCH-THREAD-SCAN-1121 scopes the partial request to projects", async () => {
  const partial = vi.fn();
  const project = {
    kind: "project",
    id: "p1",
    title: "Revenue",
    href: "/p1",
    updatedAt: "2026-01-01",
  };
  const thread = {
    kind: "thread",
    id: "t1",
    title: "Revenue",
    href: "/t1",
    updatedAt: "2026-01-01",
  };
  callAction
    .mockResolvedValueOnce({ results: [project] })
    .mockResolvedValueOnce({ results: [project, thread] });

  const result = await searchWorkspace(
    {
      text: "revenue",
      fields: ["title", "description", "cellContents"],
      includeArchived: false,
      creatorIds: [],
      categoryIds: [],
      statusIds: [],
      customRange: { from: "2026-01-01", to: "2026-01-31" },
      customDateField: "created",
    },
    partial,
  );

  expect(callAction).toHaveBeenCalledTimes(2);
  const [quickCall, fullCall] = callAction.mock.calls;
  if (!quickCall || !fullCall) throw new Error("Expected both search requests");
  expect(quickCall[1]).toMatchObject({
    fields: ["title", "description"],
    projectsOnly: true,
    dateField: "created",
    dateFrom: "2026-01-01T00:00:00.000Z",
    dateTo: "2026-01-31T23:59:59.999Z",
  });
  expect(fullCall[1]).toMatchObject({
    fields: ["title", "description", "cellContents"],
    dateField: "created",
    dateFrom: "2026-01-01T00:00:00.000Z",
    dateTo: "2026-01-31T23:59:59.999Z",
  });
  expect(fullCall[1]).not.toHaveProperty("projectsOnly");
  expect(partial).toHaveBeenCalledWith([project]);
  expect(result).toEqual([project, thread]);
});
