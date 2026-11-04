import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvers: new Map<string, (resource: any, ctx: any) => Promise<unknown>>(),
  isBrainAdmin: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({ createGetDb: () => () => ({}) }));
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
  });

  it("gives every current admin editor, never manager", async () => {
    mocks.isBrainAdmin.mockResolvedValue(true);
    await expect(resolve(intake(), "other-admin@example.test")).resolves.toBe(
      "editor",
    );
  });

  it("denies the creator once they are no longer an admin", async () => {
    mocks.isBrainAdmin.mockResolvedValue(false);
    await expect(resolve(intake(), "creator@example.test")).resolves.toBeNull();
  });

  it("leaves other members to the normal org-visibility rules", async () => {
    mocks.isBrainAdmin.mockResolvedValue(false);
    await expect(
      resolve(intake(), "member@example.test"),
    ).resolves.toBeUndefined();
  });

  it("grants nothing extra once the source is private, archived, or unmarked", async () => {
    mocks.isBrainAdmin.mockResolvedValue(true);
    for (const overrides of [
      { visibility: "private" },
      { status: "archived" },
      { configJson: "{}" },
    ]) {
      await expect(
        resolve(intake(overrides), "admin@example.test"),
      ).resolves.toBeUndefined();
    }
  });

  it("ignores every other source", async () => {
    mocks.isBrainAdmin.mockResolvedValue(true);
    await expect(
      resolve(intake({ id: "src_123" }), "admin@example.test"),
    ).resolves.toBeUndefined();
    expect(mocks.isBrainAdmin).not.toHaveBeenCalled();
  });
});
