import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDbExec: vi.fn(),
  resourcePutIfAbsent: vi.fn(),
  sharedResourceOwner: vi.fn(),
  currentOrgId: vi.fn(),
  currentOwnerEmail: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: mocks.getDbExec,
}));

vi.mock("@agent-native/core/resources/store", () => ({
  resourcePutIfAbsent: mocks.resourcePutIfAbsent,
  sharedResourceOwner: mocks.sharedResourceOwner,
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  currentOrgId: mocks.currentOrgId,
  currentOwnerEmail: mocks.currentOwnerEmail,
}));

import { isActionContractError } from "@agent-native/core/action";

import action from "./connect-external-agent.js";

describe("connect-external-agent action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentOrgId.mockReturnValue("org_1");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.sharedResourceOwner.mockReturnValue("shared-owner");
    mocks.resourcePutIfAbsent.mockResolvedValue({ id: "resource_1" });
    mocks.getDbExec.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ rows: [{ role: "owner" }] }),
    });
  });

  it("rejects a malformed endpoint URL with a clean validation error instead of an unhandled throw", async () => {
    const malformedUrl = "https://api.github.com](https://api.github.com";

    let caught: unknown;
    try {
      await action.run({ url: malformedUrl, scope: "personal" } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/https/i);
    expect(mocks.resourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects a URL with a disallowed protocol via a clean validation error", async () => {
    let caught: unknown;
    try {
      await action.run({
        url: "ftp://agent.example.com",
        scope: "personal",
      } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/https/i);
  });

  it.each([
    "https://127.0.0.1",
    "https://10.0.0.8",
    "https://192.168.1.2",
    "https://[::1]",
    "https://user:pass@agent.example.com",
  ])("rejects unsafe endpoint %s without writing", async (url) => {
    let caught: unknown;
    try {
      await action.run({ url, scope: "personal" } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect(mocks.resourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("requires an active organization for shared agents before any writes", async () => {
    mocks.currentOrgId.mockReturnValue(null);
    let caught: unknown;
    try {
      await action.run({
        url: "https://agent.example.com",
        scope: "shared",
      } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect(mocks.getDbExec).not.toHaveBeenCalled();
    expect(mocks.sharedResourceOwner).not.toHaveBeenCalled();
    expect(mocks.resourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("requires an owner or admin actor for shared agents before writing", async () => {
    mocks.currentOrgId.mockReturnValue("org_1");
    mocks.getDbExec.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ rows: [{ role: "member" }] }),
    });

    let caught: unknown;
    try {
      await action.run({
        url: "https://agent.example.com",
        scope: "shared",
      } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect((caught as { statusCode?: number }).statusCode).toBe(403);
    expect(mocks.sharedResourceOwner).not.toHaveBeenCalled();
    expect(mocks.resourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("requires an owner or admin actor for personal agents too", async () => {
    mocks.currentOrgId.mockReturnValue("org_1");
    mocks.getDbExec.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ rows: [{ role: "member" }] }),
    });

    await expect(
      action.run({
        url: "https://agent.example.com",
        scope: "personal",
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("connects a well-formed https endpoint", async () => {
    const result = await action.run({
      url: "https://agent.example.com",
      scope: "personal",
    } as never);

    expect(result.status).toBe("created");
    expect(mocks.resourcePutIfAbsent).toHaveBeenCalled();
  });

  it("rejects a concurrent duplicate connect as a clean 409, not an overwrite", async () => {
    mocks.resourcePutIfAbsent.mockResolvedValue(null);

    let caught: unknown;
    try {
      await action.run({
        url: "https://agent.example.com",
        scope: "personal",
      } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
  });
});
