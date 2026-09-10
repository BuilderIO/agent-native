import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPrivateBlob: vi.fn(),
  resolveReference: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: mocks.readPrivateBlob,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.test",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/creative-context/server", () => ({
  resolveNativeContextCloneReference: mocks.resolveReference,
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { decks: { id: "id" } },
  getDb: () => ({
    insert: () => ({ values: mocks.insertValues }),
    select: () => ({
      from: () => ({
        where: async () => [{ id: "cloned-deck", title: "Copy of launch" }],
      }),
    }),
  }),
}));
vi.mock("./_app-url.js", () => ({
  getDeckUrl: (id: string) => `/deck/${id}`,
}));

import action from "./clone-creative-context-deck.js";

describe("clone-creative-context-deck", () => {
  const body = JSON.stringify({
    title: "Launch",
    slides: [{ id: "source-slide", content: "<div>Exact</div>" }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReference.mockResolvedValue({
      publishedItemVersionId: "version-1",
      cloneHandle: { key: "private" },
    });
    mocks.readPrivateBlob.mockResolvedValue({
      data: Buffer.from(body),
      metadata: {
        appId: "slides",
        resourceType: "deck",
        resourceId: "source-deck",
        contentHash: createHash("sha256").update(body).digest("hex"),
      },
    });
  });

  it("persists an exact governed deck snapshot without exposing its handle", async () => {
    const result = await action.run({
      contextId: "context-1",
      artifactKey: "slides:deck:source-deck",
      resourceId: "source-deck",
    });
    expect(mocks.resolveReference).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "slides",
        resourceType: "deck",
        contextId: "context-1",
      }),
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "viewer@example.test" }),
    );
    expect(result).toMatchObject({
      id: "cloned-deck",
      slideCount: 1,
      clonedExactVersion: "version-1",
    });
    expect(result).not.toHaveProperty("cloneHandle");
  });

  it("rejects a payload whose governed resource identity was forged", async () => {
    mocks.readPrivateBlob.mockResolvedValue({
      data: Buffer.from(body),
      metadata: {
        appId: "slides",
        resourceType: "deck",
        resourceId: "another-deck",
        contentHash: createHash("sha256").update(body).digest("hex"),
      },
    });
    await expect(
      action.run({
        contextId: "context-1",
        artifactKey: "slides:deck:source-deck",
        resourceId: "source-deck",
      }),
    ).rejects.toThrow(/integrity verification/);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
