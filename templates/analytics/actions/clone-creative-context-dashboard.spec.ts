import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPrivateBlob: vi.fn(),
  resolveReference: vi.fn(),
  upsertDashboard: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: mocks.readPrivateBlob,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "viewer@example.test",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/creative-context/server", () => ({
  resolveNativeContextCloneReference: mocks.resolveReference,
}));
vi.mock("../server/lib/dashboards-store.js", () => ({
  upsertDashboard: mocks.upsertDashboard,
  getDashboard: mocks.getDashboard,
}));

import action from "./clone-creative-context-dashboard.js";

describe("clone-creative-context-dashboard", () => {
  const payload = JSON.stringify({
    id: "dashboard-1",
    kind: "sql",
    title: "Approved dashboard",
    config: { panels: [{ id: "panel-1", query: "SELECT secret" }] },
    updatedAt: "2026-07-17T00:00:00.000Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReference.mockResolvedValue({
      publishedItemVersionId: "version-1",
      cloneHandle: { key: "private" },
    });
    mocks.readPrivateBlob.mockResolvedValue({
      data: Buffer.from(payload),
      metadata: {
        appId: "analytics",
        resourceType: "dashboard",
        resourceId: "dashboard-1",
        contentHash: createHash("sha256").update(payload).digest("hex"),
      },
    });
    mocks.upsertDashboard.mockResolvedValue({
      id: "dashboard-copy",
      updatedAt: "2026-07-17T01:00:00.000Z",
    });
    mocks.getDashboard.mockResolvedValue({
      id: "dashboard-copy",
      title: "Copy of Approved dashboard",
      kind: "sql",
      updatedAt: "2026-07-17T01:00:00.000Z",
    });
  });

  it("persists dashboard structure without executing any panel query", async () => {
    const result = await action.run({
      contextId: "context-1",
      artifactKey: "analytics:dashboard:dashboard-1",
      resourceId: "dashboard-1",
    });
    expect(mocks.upsertDashboard).toHaveBeenCalledWith(
      expect.stringMatching(/^sql-dashboard-/),
      "sql",
      expect.objectContaining({
        title: "Copy of Approved dashboard",
        panels: [{ id: "panel-1", query: "SELECT secret" }],
      }),
      { email: "viewer@example.test", orgId: "org-1" },
    );
    expect(result).toMatchObject({
      title: "Copy of Approved dashboard",
      clonedExactVersion: "version-1",
    });
    expect(result).not.toHaveProperty("cloneHandle");
  });
});
