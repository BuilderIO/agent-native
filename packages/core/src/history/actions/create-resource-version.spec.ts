import { beforeEach, describe, expect, it, vi } from "vitest";

const insertResourceVersion = vi.fn(
  async (row: Record<string, unknown>) => row,
);

vi.mock("../store.js", () => ({
  insertResourceVersion: (row: Record<string, unknown>) =>
    insertResourceVersion(row),
}));

vi.mock("../registry.js", () => ({
  assertVersionedResourceAccess: vi.fn(async () => ({
    role: "owner",
    ownerEmail: "person@example.com",
  })),
  getVersionedResource: vi.fn(() => undefined),
  normalizeHistoryVisibility: vi.fn(() => "private"),
}));

import createResourceVersion from "./create-resource-version.js";

async function actorKindFor(ctx: Record<string, unknown>) {
  insertResourceVersion.mockClear();
  await createResourceVersion.run(
    { resourceType: "doc", resourceId: "d1", snapshot: { body: "x" } },
    { userEmail: "person@example.com", ...ctx } as never,
  );
  return insertResourceVersion.mock.calls[0]?.[0]?.actorKind;
}

describe("create-resource-version actor kind", () => {
  beforeEach(() => insertResourceVersion.mockClear());

  it.each(["agent", "tool", "mcp", "webmcp", "a2a"])(
    "records a %s call as the agent's",
    async (caller) => {
      expect(await actorKindFor({ caller })).toBe("agent");
    },
  );

  it("records a UI call as the person's", async () => {
    expect(await actorKindFor({ caller: "frontend" })).toBe("human");
  });

  it("records a call with no person as the system's", async () => {
    expect(await actorKindFor({ caller: "cli", userEmail: undefined })).toBe(
      "system",
    );
  });
});
