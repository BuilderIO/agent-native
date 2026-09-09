import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentNotionOwner: vi.fn(),
  getNotionConnectionForOwner: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: mocks.resolveSecret,
}));

vi.mock("../server/lib/notion.js", () => ({
  getNotionConnectionForOwner: mocks.getNotionConnectionForOwner,
}));

vi.mock("./_notion-action-utils.js", () => ({
  getCurrentNotionOwner: mocks.getCurrentNotionOwner,
}));

import connectNotionStatus from "./connect-notion-status";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentNotionOwner.mockReturnValue("owner@example.com");
  mocks.getNotionConnectionForOwner.mockResolvedValue(null);
  mocks.resolveSecret.mockResolvedValue(null);
});

describe("connect-notion-status", () => {
  it("reports connected for the owner's stored Notion OAuth account", async () => {
    mocks.getNotionConnectionForOwner.mockResolvedValue({
      accountId: "workspace-1",
      accessToken: "secret",
      workspaceName: "Docs",
      workspaceId: "workspace-1",
    });

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: true,
      workspaceName: "Docs",
      mode: "oauth",
      error: undefined,
    });
  });

  it("does not report missing_credentials when the OAuth client resolves", async () => {
    mocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "NOTION_CLIENT_ID" || key === "NOTION_CLIENT_SECRET"
        ? `deploy-${key}`
        : null,
    );

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      error: undefined,
    });
  });

  it("reports missing_credentials only when no client and no connection exist", async () => {
    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      error: "missing_credentials",
    });
  });

  it("requires both halves of the OAuth client before offering to connect", async () => {
    mocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "NOTION_CLIENT_ID" ? "deploy-id" : null,
    );

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      error: "missing_credentials",
    });
  });
});
