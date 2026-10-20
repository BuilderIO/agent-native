import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: null as null | ((event: any) => Promise<Response>),
  getSession: vi.fn(),
  runWithRequestContext: vi.fn(async (_context, fn) => fn()),
  readPrivateArtifact: vi.fn(async () => new Uint8Array([1, 2, 3])),
  getCreativeContextItem: vi.fn(),
  readPendingCreativeContextMedia: vi.fn(),
  isCreativeContextLabAvailable: vi.fn(),
  labKey: "creative-context.library",
}));

vi.mock("@agent-native/core/server", () => ({
  getH3App: vi.fn(() => ({
    use: vi.fn((_path: string, handler: (event: any) => Promise<Response>) => {
      mocks.handler = handler;
    }),
  })),
  getSession: mocks.getSession,
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("../connectors/private-artifacts.js", () => ({
  parsePrivateBlobHandle: vi.fn(() => ({
    id: "blob-example",
    provider: "test",
    opaque: true,
    encrypted: true,
    mimeType: "image/png",
  })),
  readPrivateArtifact: mocks.readPrivateArtifact,
}));

vi.mock("../store/index.js", () => ({
  getCreativeContextItem: mocks.getCreativeContextItem,
  readPendingCreativeContextMedia: mocks.readPendingCreativeContextMedia,
}));

vi.mock("./context.js", () => ({
  getCreativeContext: vi.fn(() => ({
    connectorContext: {},
    labKey: mocks.labKey,
  })),
}));

vi.mock("./labs.js", () => ({
  isCreativeContextLabAvailable: mocks.isCreativeContextLabAvailable,
}));

const { createCreativeContextMediaPlugin } = await import("./media.js");

function event() {
  return {
    req: {
      method: "GET",
      url: "http://app.example/_agent-native/creative-context/media?itemId=item-1&itemVersionId=version-1",
      headers: new Headers({ origin: "http://app.example" }),
    },
  };
}

describe("creative context media route", () => {
  beforeEach(async () => {
    mocks.handler = null;
    mocks.getSession.mockReset();
    mocks.runWithRequestContext.mockClear();
    mocks.readPrivateArtifact.mockClear();
    mocks.isCreativeContextLabAvailable.mockReset().mockResolvedValue(true);
    mocks.labKey = "creative-context.library";
    mocks.getCreativeContextItem.mockReset().mockResolvedValue({
      item: {
        id: "item-1",
        thumbnailBlobRef: "creative-context-blob:v1:example",
      },
      version: { id: "version-1" },
      media: [],
    });
    mocks.readPendingCreativeContextMedia.mockReset().mockResolvedValue(null);
    await createCreativeContextMediaPlugin()({});
  });

  it("rejects requests without an authenticated session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await mocks.handler!(event());
    expect(response.status).toBe(401);
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
    expect(mocks.isCreativeContextLabAvailable).not.toHaveBeenCalled();
  });

  it("does not read private media when its app-specific Lab is disabled", async () => {
    mocks.getSession.mockResolvedValue({
      email: "Alice@Example.test ",
      orgId: "org-1",
    });
    mocks.labKey = "content.creative-context";
    mocks.isCreativeContextLabAvailable.mockResolvedValue(false);

    const response = await mocks.handler!(event());

    expect(response.status).toBe(404);
    expect(mocks.isCreativeContextLabAvailable).toHaveBeenCalledWith(
      "alice@example.test",
      "content.creative-context",
    );
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
    expect(mocks.readPendingCreativeContextMedia).not.toHaveBeenCalled();
    expect(mocks.readPrivateArtifact).not.toHaveBeenCalled();
  });

  it("fails closed when the app Labs setting cannot be read", async () => {
    mocks.getSession.mockResolvedValue({
      email: "alice@example.test",
      orgId: "org-1",
    });
    mocks.isCreativeContextLabAvailable.mockRejectedValue(
      new Error("Labs settings unavailable"),
    );

    await expect(mocks.handler!(event())).rejects.toThrow(
      "Labs settings unavailable",
    );
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
    expect(mocks.readPrivateArtifact).not.toHaveBeenCalled();
  });

  it("runs access-scoped reads under the authenticated request context", async () => {
    mocks.getSession.mockResolvedValue({
      email: "Alice@Example.test ",
      orgId: "org-1",
    });
    const response = await mocks.handler!(event());
    expect(response.status).toBe(200);
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "alice@example.test", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mocks.getCreativeContextItem).toHaveBeenCalledWith(
      "item-1",
      "version-1",
    );
    expect(mocks.isCreativeContextLabAvailable).toHaveBeenCalledWith(
      "alice@example.test",
      "creative-context.library",
    );
  });

  it("uses the narrow pending-submission path only after generic item access fails", async () => {
    mocks.getSession.mockResolvedValue({
      email: "bob@example.test",
      orgId: "org-1",
    });
    mocks.getCreativeContextItem.mockResolvedValue(null);
    mocks.readPendingCreativeContextMedia.mockResolvedValue({
      itemId: "item-1",
      itemVersionId: "version-1",
      mediaId: null,
      storageKey: "creative-context-blob:v1:example",
      mimeType: "image/png",
    });

    const response = await mocks.handler!(event());

    expect(response.status).toBe(200);
    expect(mocks.readPendingCreativeContextMedia).toHaveBeenCalledWith({
      itemId: "item-1",
      itemVersionId: "version-1",
      mediaId: undefined,
    });
    expect(await response.text()).not.toContain("creative-context-blob");
  });
});
