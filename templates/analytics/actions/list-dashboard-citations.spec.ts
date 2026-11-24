import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
  openDashboard: vi.fn(),
  requestContentCitations: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: mocks.getRequestOrgId,
}));

vi.mock("../server/lib/open-dashboard.js", () => ({
  openDashboard: mocks.openDashboard,
}));

vi.mock("../server/lib/content-peer.js", () => ({
  requestContentCitations: mocks.requestContentCitations,
}));

import action from "./list-dashboard-citations.js";

const PAGE = {
  id: "doc_1",
  title: "Q4 review",
  url: "https://content.agent-native.com/page/doc_1",
  updatedAt: "2026-11-18T10:00:00.000Z",
};

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue("reader@example.test");
  mocks.getRequestOrgId.mockReturnValue("org_1");
  mocks.openDashboard.mockResolvedValue({ saved: { id: "growth" } });
  mocks.requestContentCitations.mockResolvedValue({
    ok: true,
    pages: [PAGE],
    more: false,
  });
});

describe("list-dashboard-citations", () => {
  it("lists the citing pages of a dashboard the person can open", async () => {
    await expect(action.run({ dashboardId: "growth" })).resolves.toEqual({
      status: "ok",
      pages: [PAGE],
      more: false,
    });
    expect(mocks.openDashboard).toHaveBeenCalledWith("growth", {
      email: "reader@example.test",
      orgId: "org_1",
    });
    expect(mocks.requestContentCitations).toHaveBeenCalledWith("growth");
    expect(action.readOnly).toBe(true);
    expect(action.mcpTool).toBe(false);
  });

  it("asks Content about the built-in a legacy id opens", async () => {
    mocks.openDashboard.mockResolvedValue({
      builtin: { id: "first-party-traffic" },
    });
    await action.run({ dashboardId: "traffic" });
    expect(mocks.requestContentCitations).toHaveBeenCalledWith(
      "first-party-traffic",
    );
  });

  it("asks Content nothing about a dashboard the person can't open", async () => {
    mocks.openDashboard.mockResolvedValue(null);
    await expect(
      failureOf(action.run({ dashboardId: "secret" })),
    ).resolves.toEqual({ errorCode: "dashboard_not_found", statusCode: 404 });

    mocks.getRequestUserEmail.mockReturnValue(undefined);
    await expect(
      failureOf(action.run({ dashboardId: "growth" })),
    ).resolves.toEqual({ errorCode: "unauthenticated", statusCode: 401 });
    expect(mocks.requestContentCitations).not.toHaveBeenCalled();
  });

  it("says unavailable when Content can't answer", async () => {
    mocks.requestContentCitations.mockResolvedValue({
      ok: false,
      code: "content_unreachable",
    });
    await expect(action.run({ dashboardId: "growth" })).resolves.toEqual({
      status: "unavailable",
      reason: "content_unreachable",
    });
  });
});
