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
    mocks.currentOrgId.mockReturnValue(null);
    mocks.currentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.sharedResourceOwner.mockReturnValue("shared-owner");
    mocks.resourcePutIfAbsent.mockResolvedValue({ id: "resource_1" });
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
    expect((caught as Error).message).toMatch(/valid url/i);
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
    expect((caught as Error).message).toMatch(/http:\/\/ or https:\/\//i);
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
