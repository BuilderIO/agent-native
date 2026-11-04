import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvers: new Map<string, (resource: any, ctx: any) => Promise<unknown>>(),
  isBrainAdmin: vi.fn(),
  readOrgMemberRole: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({ createGetDb: () => () => ({}) }));
vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: mocks.readOrgMemberRole,
}));
vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: vi.fn(),
  registerHostAccessResolver: (
    type: string,
    resolver: (resource: any, ctx: any) => Promise<unknown>,
  ) => mocks.resolvers.set(type, resolver),
}));
vi.mock("../lib/zoom-governance.js", () => ({
  isBrainAdmin: mocks.isBrainAdmin,
}));

import "./index.js";

const resolve = (resource: Record<string, unknown>, email: string) =>
  mocks.resolvers.get("brain-source")!(resource, {
    userEmail: email,
    orgId: "org-1",
  });

const intake = (overrides: Record<string, unknown> = {}) => ({
  id: "company-context-org-1",
  orgId: "org-1",
  ownerEmail: "creator@example.test",
  visibility: "org",
  status: "active",
  configJson: '{"companyContextIntake":true}',
  ...overrides,
});

describe("Company Context intake host access", () => {
  beforeEach(() => {
    mocks.isBrainAdmin.mockReset();
    mocks.readOrgMemberRole.mockReset();
  });

  it("gives every current admin editor, whatever the source state", async () => {
    mocks.isBrainAdmin.mockResolvedValue(true);
    for (const overrides of [
      {},
      { visibility: "private" },
      { status: "archived" },
    ]) {
      await expect(
        resolve(intake(overrides), "other-admin@example.test"),
      ).resolves.toBe("editor");
    }
  });

  it("denies the creator once they are no longer an admin", async () => {
    mocks.isBrainAdmin.mockResolvedValue(false);
    mocks.readOrgMemberRole.mockResolvedValue("member");
    await expect(resolve(intake(), "creator@example.test")).resolves.toBeNull();
  });

  it("keeps other members read-only even if the source was shared with them", async () => {
    mocks.isBrainAdmin.mockResolvedValue(false);
    mocks.readOrgMemberRole.mockResolvedValue("member");
    await expect(resolve(intake(), "member@example.test")).resolves.toBe(
      "viewer",
    );
  });

  it("denies non-members, and members once the source is not org-visible", async () => {
    mocks.isBrainAdmin.mockResolvedValue(false);
    mocks.readOrgMemberRole.mockResolvedValue(null);
    await expect(
      resolve(intake(), "outsider@example.test"),
    ).resolves.toBeNull();
    mocks.readOrgMemberRole.mockResolvedValue("member");
    await expect(
      resolve(intake({ visibility: "private" }), "member@example.test"),
    ).resolves.toBeNull();
  });

  it("ignores every other source", async () => {
    mocks.isBrainAdmin.mockResolvedValue(true);
    await expect(
      resolve(intake({ id: "src_123" }), "admin@example.test"),
    ).resolves.toBeUndefined();
    await expect(
      resolve(intake({ configJson: "{}" }), "admin@example.test"),
    ).resolves.toBeUndefined();
    expect(mocks.isBrainAdmin).not.toHaveBeenCalled();
  });
});
