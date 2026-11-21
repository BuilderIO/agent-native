import { actionCallIntent } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getConnectedAccounts: vi.fn(),
  settings: new Map<string, unknown>(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(
    async (owner: string, key: string) =>
      mocks.settings.get(`${owner}:${key}`) ?? null,
  ),
  mutateUserSetting: vi.fn(
    async (
      owner: string,
      key: string,
      updater: (current: unknown) => unknown,
    ) => {
      const next = await updater(mocks.settings.get(`${owner}:${key}`) ?? null);
      mocks.settings.set(`${owner}:${key}`, next);
      return next;
    },
  ),
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  getConnectedAccounts: mocks.getConnectedAccounts,
}));

import action from "./update-calendar-description.js";
import updateExternalCalendars from "./update-external-calendars.js";

const owner = "owner@example.com";
const run = (args: Parameters<typeof action.run>[0]) => action.run(args);
const isValid = async (args: unknown) =>
  (await actionCallIntent(action, args)).valid;

describe("update-calendar-description", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.clear();
    mocks.getRequestUserEmail.mockReturnValue(owner);
    mocks.getConnectedAccounts.mockResolvedValue([
      "work@example.com",
      "me@example.com",
    ]);
  });

  it("describes a connected account, keyed case-insensitively", async () => {
    await expect(
      run({
        accountEmail: "Work@Example.com",
        description: "  Work meetings\n and team 1:1s go here ",
      }),
    ).resolves.toEqual({
      accountEmail: "work@example.com",
      description: "Work meetings and team 1:1s go here",
    });
    expect(
      mocks.settings.get(`${owner}:calendar-account-descriptions`),
    ).toEqual({
      "work@example.com": "Work meetings and team 1:1s go here",
    });
  });

  it("clears an account's description when it's empty", async () => {
    mocks.settings.set(`${owner}:calendar-account-descriptions`, {
      "work@example.com": "Builder work",
      "me@example.com": "Personal",
    });

    await expect(
      run({ accountEmail: "work@example.com", description: "   " }),
    ).resolves.toEqual({ accountEmail: "work@example.com", description: null });
    expect(
      mocks.settings.get(`${owner}:calendar-account-descriptions`),
    ).toEqual({ "me@example.com": "Personal" });
  });

  it("refuses an account the user hasn't connected", async () => {
    await expect(
      run({ accountEmail: "someone@example.com", description: "Theirs" }),
    ).rejects.toThrow("isn't one of your connected Google accounts");
    expect(mocks.settings.has(`${owner}:calendar-account-descriptions`)).toBe(
      false,
    );
  });

  it("describes a feed and keeps the rest of the feed list", async () => {
    mocks.settings.set(`${owner}:external-calendars`, [
      {
        id: "talks",
        name: "Talks",
        url: "https://a.test/t.ics",
        color: "blue",
      },
      {
        id: "holidays",
        name: "Holidays",
        url: "https://a.test/h.ics",
        color: "green",
        description: "Public holidays",
      },
    ]);

    await expect(
      run({ feedId: "talks", description: "Conference talks I might attend" }),
    ).resolves.toEqual({
      feedId: "talks",
      name: "Talks",
      description: "Conference talks I might attend",
    });
    await run({ feedId: "holidays", description: "" });

    expect(mocks.settings.get(`${owner}:external-calendars`)).toEqual([
      {
        id: "talks",
        name: "Talks",
        url: "https://a.test/t.ics",
        color: "blue",
        description: "Conference talks I might attend",
      },
      {
        id: "holidays",
        name: "Holidays",
        url: "https://a.test/h.ics",
        color: "green",
      },
    ]);
  });

  it("refuses a feed id the user doesn't have", async () => {
    await expect(run({ feedId: "missing", description: "x" })).rejects.toThrow(
      "No calendar feed has the id missing",
    );
  });

  it("takes exactly one of an account or a feed", async () => {
    await expect(isValid({ description: "x" })).resolves.toBe(false);
    await expect(
      isValid({
        accountEmail: "work@example.com",
        feedId: "talks",
        description: "x",
      }),
    ).resolves.toBe(false);
    await expect(
      isValid({ accountEmail: "work@example.com", description: "x" }),
    ).resolves.toBe(true);
  });

  it("refuses to change a saved feed list that isn't a list", async () => {
    mocks.settings.set(`${owner}:external-calendars`, { talks: "Talks" });

    await expect(
      updateExternalCalendars.run({ calendars: [] }),
    ).rejects.toThrow("isn't a list");
    expect(mocks.settings.get(`${owner}:external-calendars`)).toEqual({
      talks: "Talks",
    });
  });

  it("keeps saved feed descriptions when the whole feed list is replaced", async () => {
    mocks.settings.set(`${owner}:external-calendars`, [
      {
        id: "talks",
        name: "Talks",
        url: "https://a.test/t.ics",
        color: "blue",
        description: "Talks",
      },
      {
        id: "holidays",
        name: "Holidays",
        url: "https://a.test/h.ics",
        color: "green",
        description: "Holidays",
      },
    ]);

    await updateExternalCalendars.run({
      calendars: [
        {
          id: "talks",
          name: "Talks",
          url: "https://a.test/t.ics",
          color: "red",
        },
        {
          id: "holidays",
          name: "Holidays",
          url: "https://a.test/h.ics",
          color: "green",
          description: " ",
        },
      ],
    });

    expect(mocks.settings.get(`${owner}:external-calendars`)).toEqual([
      {
        id: "talks",
        name: "Talks",
        url: "https://a.test/t.ics",
        color: "red",
        description: "Talks",
      },
      {
        id: "holidays",
        name: "Holidays",
        url: "https://a.test/h.ics",
        color: "green",
      },
    ]);
  });

  it("refuses unauthenticated calls", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    await expect(
      run({ accountEmail: "work@example.com", description: "x" }),
    ).rejects.toThrow("no authenticated user");
  });
});
