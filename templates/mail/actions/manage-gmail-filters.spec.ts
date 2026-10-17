import { isActionContractError } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessTokens: vi.fn(),
  gmailCreateFilter: vi.fn(),
  gmailCreateLabel: vi.fn(),
  gmailDeleteFilter: vi.fn(),
  gmailGetFilter: vi.fn(),
  gmailListFilters: vi.fn(),
  gmailListLabels: vi.fn(),
  writeAppState: vi.fn(),
  assertGmailNotCoolingDown: vi.fn(),
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: mocks.getAccessTokens,
}));

vi.mock("../server/lib/gmail-quota.js", () => ({
  assertGmailNotCoolingDown: mocks.assertGmailNotCoolingDown,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailCreateFilter: mocks.gmailCreateFilter,
  gmailCreateLabel: mocks.gmailCreateLabel,
  gmailDeleteFilter: mocks.gmailDeleteFilter,
  gmailGetFilter: mocks.gmailGetFilter,
  gmailListFilters: mocks.gmailListFilters,
  gmailListLabels: mocks.gmailListLabels,
}));

import action from "./manage-gmail-filters";

const account = { email: "owner@example.test", accessToken: "token" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertGmailNotCoolingDown.mockResolvedValue(undefined);
  mocks.getAccessTokens.mockResolvedValue([]);
  mocks.gmailCreateFilter.mockResolvedValue({
    id: "filter-new",
    criteria: { from: "bots@example.test" },
    action: { removeLabelIds: ["INBOX"] },
  });
  mocks.gmailGetFilter.mockResolvedValue({
    id: "filter-old",
    criteria: { from: "old@example.test" },
    action: { removeLabelIds: ["INBOX"] },
  });
  mocks.gmailListFilters.mockResolvedValue({ filter: [] });
  mocks.gmailListLabels.mockResolvedValue({ labels: [] });
  mocks.gmailDeleteFilter.mockResolvedValue(undefined);
  mocks.writeAppState.mockResolvedValue(undefined);
});

describe("manage-gmail-filters action", () => {
  it("returns a created change with criteria, action, and Gmail link", async () => {
    mocks.getAccessTokens.mockResolvedValue([account]);

    const result = await action.run({
      operation: "create",
      account: account.email,
      from: "bots@example.test",
      archive: true,
    });

    expect(result.change).toEqual({
      verb: "created",
      kind: "gmail-filter",
      title: "from bots@example.test",
      detail: "Archive",
      url: "https://mail.google.com/mail/?authuser=owner%40example.test#settings/filters",
      undo: {
        action: "manage-gmail-filters",
        args: {
          operation: "delete",
          id: "filter-new",
          account: "owner@example.test",
        },
      },
    });
    expect(result.filter.criteriaSummary).toBe(result.change.title);
    expect(result.filter.actionSummary).toBe(result.change.detail);
  });

  it("returns an updated change after replacing a filter", async () => {
    mocks.getAccessTokens.mockResolvedValue([account]);

    const result = await action.run({
      operation: "replace",
      id: "filter-old",
      account: account.email,
      from: "bots@example.test",
      archive: true,
    });

    expect(mocks.gmailDeleteFilter).toHaveBeenCalledWith(
      account.accessToken,
      "filter-old",
    );
    expect(result.change).toEqual({
      verb: "updated",
      kind: "gmail-filter",
      title: "from bots@example.test",
      detail: "Archive",
      url: "https://mail.google.com/mail/?authuser=owner%40example.test#settings/filters",
      undo: {
        action: "manage-gmail-filters",
        args: {
          operation: "replace",
          id: "filter-new",
          account: "owner@example.test",
          criteriaJson: JSON.stringify({ from: "old@example.test" }),
          filterActionJson: JSON.stringify({ removeLabelIds: ["INBOX"] }),
          replaceCriteria: true,
          replaceAction: true,
        },
      },
    });
  });

  it("leaves list, get, and delete results without a change card", async () => {
    mocks.getAccessTokens.mockResolvedValue([account]);
    mocks.gmailListFilters.mockResolvedValue({ filter: [] });

    const listed = await action.run({
      operation: "list",
      account: account.email,
    });
    const got = await action.run({
      operation: "get",
      id: "filter-old",
      account: account.email,
    });
    const deleted = await action.run({
      operation: "delete",
      id: "filter-old",
      account: account.email,
    });

    expect(listed).not.toHaveProperty("change");
    expect(got).not.toHaveProperty("change");
    expect(deleted).not.toHaveProperty("change");
  });

  it("refuses repeated list calls inside a Gmail cooldown with the typed error and no Gmail work", async () => {
    mocks.getAccessTokens.mockResolvedValue([account]);
    const cooldown = Object.assign(
      new Error("Email service is briefly busy."),
      {
        actionContractError: true,
        errorCode: "gmail_quota_cooldown",
        statusCode: 429,
      },
    );
    mocks.assertGmailNotCoolingDown.mockRejectedValue(cooldown);

    for (let call = 0; call < 3; call++) {
      await expect(action.run({ operation: "list" })).rejects.toBe(cooldown);
    }

    expect(mocks.assertGmailNotCoolingDown).toHaveBeenCalledWith([
      account.email,
    ]);
    expect(mocks.gmailListFilters).not.toHaveBeenCalled();
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
  });

  it("throws a typed, caller-facing ActionContractError when no Google account is connected", async () => {
    await expect(action.run({ operation: "list" })).rejects.toSatisfy(
      (err: unknown) => {
        expect(isActionContractError(err)).toBe(true);
        expect((err as Error).message).toBe(
          "No Google account connected. Connect Gmail first.",
        );
        expect((err as { statusCode?: number }).statusCode).toBeLessThan(500);
        return true;
      },
    );
  });
});
