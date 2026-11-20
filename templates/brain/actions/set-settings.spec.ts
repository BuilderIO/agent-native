import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userEmail: "member@example.test" as string | undefined,
  orgId: "org-1" as string | undefined,
  roles: new Map<string, string>(),
  writeBrainSettings: vi.fn(async (_orgId: string, patch: object) => patch),
}));

vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: vi.fn(
    async (orgId: string, email: string) =>
      mocks.roles.get(`${orgId}:${email}`) ?? null,
  ),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => ({
    userEmail: mocks.userEmail,
    orgId: mocks.orgId,
  }),
  getRequestOrgId: () => mocks.orgId,
  getRequestUserEmail: () => mocks.userEmail,
}));

vi.mock("../server/db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../server/lib/zoom.js", () => ({ zoomApprovedMeetingIds: vi.fn() }));
vi.mock("../server/lib/brain.js", () => ({
  nanoid: vi.fn(),
  nowIso: vi.fn(),
  stableJson: vi.fn(),
  writeBrainSettings: mocks.writeBrainSettings,
}));

import setSettings from "./set-settings.js";

describe("set-settings", () => {
  beforeEach(() => {
    mocks.writeBrainSettings.mockClear();
    mocks.roles.clear();
    mocks.roles.set("org-1:owner@example.test", "owner");
    mocks.roles.set("org-1:member@example.test", "member");
    mocks.orgId = "org-1";
  });

  it("refuses an organization member who is not a Brain admin", async () => {
    mocks.userEmail = "member@example.test";

    await expect(
      setSettings.run({ autoRedactEmails: false } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.writeBrainSettings).not.toHaveBeenCalled();
  });

  it("refuses a caller with no active organization", async () => {
    mocks.userEmail = "owner@example.test";
    mocks.orgId = undefined;

    await expect(
      setSettings.run({ autoRedactEmails: false } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.writeBrainSettings).not.toHaveBeenCalled();
  });

  it("writes an admin's settings to the admin's organization", async () => {
    mocks.userEmail = "owner@example.test";

    await setSettings.run({ autoRedactEmails: false } as never);

    expect(mocks.writeBrainSettings).toHaveBeenCalledWith("org-1", {
      autoRedactEmails: false,
    });
  });
});
