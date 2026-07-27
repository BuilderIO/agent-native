import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStatePut = vi.hoisted(() => vi.fn());
const mockRecordChange = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());

vi.mock("../application-state/store.js", () => ({
  appStatePut: (...args: unknown[]) => mockAppStatePut(...args),
}));

vi.mock("./poll.js", () => ({
  recordChange: (...args: unknown[]) => mockRecordChange(...args),
}));

vi.mock("./request-context.js", () => ({
  getRequestOrgId: () => mockGetRequestOrgId(),
  getRequestUserEmail: () => mockGetRequestUserEmail(),
}));

describe("notifyActionChange", () => {
  beforeEach(() => {
    mockAppStatePut.mockReset();
    mockRecordChange.mockReset();
    mockGetRequestOrgId.mockReset();
    mockGetRequestUserEmail.mockReset();
  });

  it("records in-memory and durable action changes for an owner", async () => {
    const { notifyActionChange } = await import("./action-change.js");

    await notifyActionChange({
      actionName: "create-project",
      owner: "owner@example.com",
    });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "action",
      type: "change",
      key: "create-project",
      owner: "owner@example.com",
    });
    expect(mockAppStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "__action_change__",
      expect.objectContaining({
        source: "action",
        actionName: "create-project",
        owner: "owner@example.com",
      }),
      { requestSource: "agent" },
    );
  });

  it("does not broaden owner-scoped action markers to the current org", async () => {
    mockGetRequestUserEmail.mockReturnValue("owner@example.com");
    mockGetRequestOrgId.mockReturnValue("org-1");
    const { notifyActionChange } = await import("./action-change.js");

    await notifyActionChange({ actionName: "update-project" });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "action",
      type: "change",
      key: "update-project",
      owner: "owner@example.com",
    });
    expect(mockAppStatePut.mock.calls[0][2]).not.toHaveProperty("orgId");
  });

  it("keeps explicit owner-scoped action changes out of explicit org scope", async () => {
    const { notifyActionChange } = await import("./action-change.js");

    await notifyActionChange({
      actionName: "publish-project",
      owner: "owner@example.com",
      orgId: "org-1",
    });

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "action",
      type: "change",
      key: "publish-project",
      owner: "owner@example.com",
    });
    expect(mockRecordChange.mock.calls[0][0]).not.toHaveProperty("orgId");
    expect(mockAppStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "__action_change__",
      expect.objectContaining({
        source: "action",
        actionName: "publish-project",
        owner: "owner@example.com",
      }),
      { requestSource: "agent" },
    );
    expect(mockAppStatePut.mock.calls[0][2]).not.toHaveProperty("orgId");
  });

  it("preserves a frontend tab source so the originating tab can ignore the echo", async () => {
    const { notifyActionChange } = await import("./action-change.js");

    await notifyActionChange({
      actionName: "update-project",
      owner: "owner@example.com",
      requestSource: "tab-123",
    });

    expect(mockRecordChange).toHaveBeenCalledWith(
      expect.objectContaining({ requestSource: "tab-123" }),
    );
    expect(mockAppStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      "__action_change__",
      expect.objectContaining({ requestSource: "tab-123" }),
      { requestSource: "tab-123" },
    );
  });
});
