import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  status: vi.fn(),
  header: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.session,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: () => "12345678-1234-4123-8123-123456789abc.png",
  setResponseHeader: mocks.header,
  setResponseStatus: mocks.status,
}));
vi.mock("../../../lib/design-native-texture-assets.js", () => ({
  DesignNativeTextureAssetError: class DesignNativeTextureAssetError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  readDesignNativeTextureAsset: mocks.read,
}));

import { DesignNativeTextureAssetError } from "../../../lib/design-native-texture-assets.js";
import route from "./[assetId].get";

const event = {} as Parameters<typeof route>[0];
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Design-native texture binary route", () => {
  it("refuses unauthenticated fetches before reading provider storage", async () => {
    mocks.session.mockResolvedValue(null);
    expect(await route(event)).toEqual({ error: "Unauthorized" });
    expect(mocks.status).toHaveBeenCalledWith(event, 401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("propagates session lookup failure instead of reporting an unauthenticated visitor", async () => {
    const failure = new Error("session database unavailable");
    mocks.session.mockRejectedValue(failure);
    await expect(route(event)).rejects.toBe(failure);
    expect(mocks.status).not.toHaveBeenCalledWith(event, 401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("reports unreadable storage as a server error, distinct from missing bytes", async () => {
    mocks.session.mockResolvedValue({
      email: "editor@example.test",
      orgId: "org-a",
    });
    mocks.read.mockRejectedValueOnce(
      new DesignNativeTextureAssetError(
        "unreadable",
        "Provider body unreadable",
      ),
    );
    expect(await route(event)).toEqual({
      error: "Provider body unreadable",
      errorCode: "native_texture_unreadable",
    });
    expect(mocks.status).toHaveBeenCalledWith(event, 503);
    mocks.read.mockRejectedValueOnce(
      new DesignNativeTextureAssetError("not-found", "Asset missing"),
    );
    expect(await route(event)).toEqual({ error: "Asset missing" });
    expect(mocks.status).toHaveBeenCalledWith(event, 404);
  });
  it("serves exact scoped bytes with private no-sniff headers", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    mocks.session.mockResolvedValue({
      email: "editor@example.test",
      orgId: "org-a",
    });
    mocks.read.mockResolvedValue({ mimeType: "image/png", bytes });
    expect(await route(event)).toBe(bytes);
    expect(mocks.read).toHaveBeenCalledWith(
      "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png",
      1_000_000,
    );
    expect(mocks.header).toHaveBeenCalledWith(
      event,
      "Cache-Control",
      "private, no-store",
    );
    expect(mocks.header).toHaveBeenCalledWith(
      event,
      "X-Content-Type-Options",
      "nosniff",
    );
  });
});
