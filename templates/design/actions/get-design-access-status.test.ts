import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("anonymous access status must not query designs");
  }),
  getRequestUserEmail: vi.fn(() => null),
  getRequestUserName: vi.fn(() => null),
  resolveAccess: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designs: {
      id: "designs.id",
      visibility: "designs.visibility",
    },
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestUserName: mocks.getRequestUserName,
}));

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: vi.fn(),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

import action from "./get-design-access-status";

describe("get-design-access-status", () => {
  it("does not reveal whether an anonymous viewer's design exists", async () => {
    await expect(action.run({ designId: "private-design" })).resolves.toEqual({
      exists: false,
      hasAccess: false,
      signedIn: false,
      viewerEmail: null,
      viewerName: null,
      role: null,
      visibility: null,
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });
});
