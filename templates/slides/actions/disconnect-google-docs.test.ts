import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  listGoogleDocsAccounts: vi.fn(),
  disconnectGoogleDocs: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/google-docs-oauth.js", () => ({
  disconnectGoogleDocs: mocks.disconnectGoogleDocs,
  listGoogleDocsAccounts: mocks.listGoogleDocsAccounts,
}));

import disconnectGoogleDocsAction from "./disconnect-google-docs";

describe("disconnect-google-docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
  });

  it("removes the caller's own account and reports it", async () => {
    mocks.listGoogleDocsAccounts.mockResolvedValue([
      { email: "owner@example.com" },
    ]);

    await expect(disconnectGoogleDocsAction.run({})).resolves.toEqual({
      disconnected: true,
    });
    expect(mocks.disconnectGoogleDocs).toHaveBeenCalledWith(
      "owner@example.com",
    );
  });

  it("reports nothing disconnected when only a shared account exists", async () => {
    mocks.listGoogleDocsAccounts.mockResolvedValue([]);

    await expect(disconnectGoogleDocsAction.run({})).resolves.toEqual({
      disconnected: false,
    });
    expect(mocks.disconnectGoogleDocs).not.toHaveBeenCalled();
  });
});
