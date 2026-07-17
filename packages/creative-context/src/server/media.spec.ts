import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: null as null | ((event: any) => Promise<Response>),
  getSession: vi.fn(),
  runWithRequestContext: vi.fn(async (_context, fn) => fn()),
  readPrivateArtifact: vi.fn(async () => new Uint8Array([1, 2, 3])),
  getCreativeContextItem: vi.fn(),
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
}));

vi.mock("./context.js", () => ({
  getCreativeContext: vi.fn(() => ({ connectorContext: {} })),
}));

const { createCreativeContextMediaPlugin } = await import("./media.js");

function event() {
  return {
    req: {
      method: "GET",
      url: "http://app.example/_agent-native/creative-context/media?itemId=item-1",
      headers: new Headers({ origin: "http://app.example" }),
    },
  };
}

describe("creative context media route", () => {
  beforeEach(async () => {
    mocks.handler = null;
    mocks.getSession.mockReset();
    mocks.runWithRequestContext.mockClear();
    mocks.getCreativeContextItem.mockReset().mockResolvedValue({
      item: {
        id: "item-1",
        thumbnailBlobRef: "creative-context-blob:v1:example",
      },
      version: { id: "version-1" },
      media: [],
    });
    await createCreativeContextMediaPlugin()({});
  });

  it("rejects requests without an authenticated session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await mocks.handler!(event());
    expect(response.status).toBe(401);
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
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
      undefined,
    );
  });
});
