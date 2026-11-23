import { fail, isActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  manager: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../server/model/data-connections.js", () => ({
  manager: state.manager,
}));
vi.mock("../server/model/sqlfluff-verdicts.js", () => ({
  readSqlFluffVerdict: state.read,
}));

import action from "./get-data-sql-formatting-verdict.js";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const uiCaller = { caller: "frontend" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  state.manager.mockResolvedValue({
    userEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  });
});

async function typedFailure(promise: Promise<unknown>) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isActionContractError(caught)).toBe(true);
  if (!isActionContractError(caught))
    throw new Error("expected a typed action failure");
  return caught;
}

describe("get-data-sql-formatting-verdict action", () => {
  it("authorizes with the canonical manager before reading the scoped verdict", async () => {
    state.read.mockResolvedValue({ valid: true, errorCode: null });
    await expect(action.run({ requestId }, uiCaller)).resolves.toEqual({
      valid: true,
      errorCode: null,
    });
    expect(state.read).toHaveBeenCalledWith(
      {
        userEmail: "qa-owner@example.invalid",
        orgId: "qa-workspace",
      },
      requestId,
    );
  });

  it("does not read a verdict when canonical authorization refuses", async () => {
    state.manager.mockRejectedValue(
      new Error("Only workspace admins can view or edit this configuration."),
    );
    await expect(action.run({ requestId }, uiCaller)).rejects.toThrow(
      "Only workspace admins can view or edit this configuration.",
    );
    expect(state.read).not.toHaveBeenCalled();
  });

  it.each([
    ["data_sqlfluff_verdict_not_found", 404],
    ["data_sqlfluff_verdict_unreadable", 503],
  ])("propagates the typed %s failure", async (errorCode, statusCode) => {
    state.read.mockImplementation(async () => {
      fail("The verdict is unavailable.", { errorCode, statusCode });
    });
    const failure = await typedFailure(action.run({ requestId }, uiCaller));
    expect(failure.errorCode).toBe(errorCode);
    expect(failure.statusCode).toBe(statusCode);
  });

  it("rejects a missing or malformed request id before reading", async () => {
    await expect(
      action.run({ requestId: "not-a-uuid" }, uiCaller),
    ).rejects.toThrow(/Invalid action parameters/);
    await expect(action.run({}, uiCaller)).rejects.toThrow(
      /Invalid action parameters/,
    );
    expect(state.read).not.toHaveBeenCalled();
  });
});
