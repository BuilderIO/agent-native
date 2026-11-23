import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ requireReadableProject: vi.fn() }));
vi.mock("../server/lib/project-action-access.js", () => access);
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "owner@example.test", orgId: "org-1" }),
}));
vi.mock("../server/model/projects-store.js", () => ({
  listWorkspaceVisibleProjects: vi.fn().mockResolvedValue([
    {
      id: "prj_orders",
      title: "Orders by month — demo data",
      archivedAt: null,
    },
    {
      id: "prj_old",
      title: "Orders by month — archived",
      archivedAt: "2026-01-01",
    },
    { id: "prj_rev", title: "Revenue", archivedAt: null },
    { id: "prj_rev2", title: "Revenue by region", archivedAt: null },
    { id: "prj_v3", title: "Agent-Native - BigQuery v3", archivedAt: null },
    { id: "prj_v3b", title: "Checkout funnel v3", archivedAt: null },
  ]),
}));

import resolveOpenProjectIntent from "./resolve-open-project-intent.js";

describe("resolve-open-project-intent", () => {
  beforeEach(() => {
    access.requireReadableProject.mockReset();
    access.requireReadableProject.mockResolvedValue({});
  });

  it("finds the project a hyphen-typed title names", async () => {
    expect(
      await resolveOpenProjectIntent.run({ title: "Orders by month - demo" }),
    ).toEqual({
      status: "found",
      projectId: "prj_orders",
      title: "Orders by month — demo data",
      href: "/project/prj_orders/latest",
    });
  });

  it("reports no match for an unknown title and an ambiguous one for a shared prefix", async () => {
    expect(await resolveOpenProjectIntent.run({ title: "Nothing" })).toEqual({
      status: "none",
    });
    expect(await resolveOpenProjectIntent.run({ title: "Rev" })).toEqual({
      status: "ambiguous",
    });
  });

  it("picks the dashboard the whole question describes when its short name matches two", async () => {
    expect(await resolveOpenProjectIntent.run({ title: "V3" })).toEqual({
      status: "ambiguous",
    });
    expect(
      await resolveOpenProjectIntent.run({
        title: "V3",
        question: "How's my Agent-Native metrics doing in my V3 dashboard?",
      }),
    ).toEqual({
      status: "found",
      projectId: "prj_v3",
      title: "Agent-Native - BigQuery v3",
      href: "/project/prj_v3/latest",
    });
    expect(
      await resolveOpenProjectIntent.run({
        title: "V3",
        question: "How is my V3 dashboard doing?",
      }),
    ).toEqual({ status: "ambiguous" });
  });

  it("does not reveal a project the caller cannot read", async () => {
    access.requireReadableProject.mockRejectedValue(new Error("forbidden"));
    expect(await resolveOpenProjectIntent.run({ title: "Revenue" })).toEqual({
      status: "none",
    });
  });
});
