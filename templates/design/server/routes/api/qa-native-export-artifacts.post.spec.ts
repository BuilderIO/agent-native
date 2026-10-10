import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getSession: vi.fn(),
  runWithRequestContext: vi.fn(),
  assertAccess: vi.fn(),
  store: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: mocks.runWithRequestContext,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { designId: string }) => ({ designId: event.designId }),
  getRequestHeader: (
    event: { headers: Record<string, string> },
    name: string,
  ) => event.headers[name],
  getRequestURL: () =>
    new URL("http://localhost:9310/api/qa-native-export-artifacts"),
  setResponseHeader: vi.fn(),
  setResponseStatus: mocks.status,
}));
vi.mock("../../lib/local-figma-qa-upload.js", () => ({
  isLocalFigmaQaUploadEnabled: mocks.enabled,
}));
vi.mock("../../lib/local-native-export-artifact.js", () => ({
  LocalNativeArtifactError: class LocalNativeArtifactError extends Error {},
  MAX_NATIVE_MP4_BYTES: 100 * 1024 * 1024,
  MAX_NATIVE_DOCUMENT_BYTES: 40 * 1024 * 1024,
  MAX_NATIVE_RASTER_BYTES: 16 * 1024 * 1024,
  storeLocalNativeExportArtifact: mocks.store,
}));

import { ForbiddenError } from "@agent-native/core/sharing";

import handler from "./qa-native-export-artifacts.post.js";

const bytes = Buffer.alloc(32);
const metadata = {
  artifactId: "00000000-0000-4000-8000-000000000000.png",
  format: "png",
  byteLength: 32,
  sha256: "a".repeat(64),
  expiresAt: "2026-10-07T12:00:00.000Z",
};

function event(
  overrides: Partial<{
    designId: string;
    headers: Record<string, string>;
  }> = {},
) {
  return {
    designId: overrides.designId ?? "design-123",
    headers: overrides.headers ?? {
      origin: "http://localhost:9310",
      "content-type": "image/png",
      "content-length": "32",
    },
    node: {
      req: (async function* () {
        yield bytes;
      })(),
    },
  };
}

describe("POST /api/qa-native-export-artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.getSession.mockResolvedValue({
      email: "owner@example.test",
      orgId: null,
    });
    mocks.runWithRequestContext.mockImplementation((_ctx, callback) =>
      callback(),
    );
    mocks.assertAccess.mockResolvedValue({ role: "viewer" });
    mocks.store.mockResolvedValue(metadata);
  });

  it("rejects disabled, cross-origin, unauthenticated, and unauthorized requests before reading pixels", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await handler(event() as never)).toEqual({ error: "not-found" });
    mocks.enabled.mockReturnValue(true);
    expect(
      await handler(
        event({ headers: { origin: "https://attacker.test" } }) as never,
      ),
    ).toEqual({ error: "origin-mismatch" });
    mocks.getSession.mockResolvedValue(null);
    expect(await handler(event() as never)).toEqual({ error: "unauthorized" });
    mocks.getSession.mockResolvedValue({ email: "owner@example.test" });
    mocks.assertAccess.mockRejectedValue(new Error("database unavailable"));
    expect(await handler(event() as never)).toEqual({
      error: "design-access-unreadable",
    });
    mocks.assertAccess.mockRejectedValue(new ForbiddenError("no access"));
    expect(await handler(event() as never)).toEqual({
      error: "design-access-denied",
    });
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("requires a bounded declared length before reading and verifies exact body length", async () => {
    expect(
      await handler(
        event({
          headers: {
            origin: "http://localhost:9310",
            "content-type": "image/png",
          },
        }) as never,
      ),
    ).toEqual({ error: "content-length-required" });
    expect(
      await handler(
        event({
          headers: {
            origin: "http://localhost:9310",
            "content-type": "image/png",
            "content-length": String(20 * 1024 * 1024),
          },
        }) as never,
      ),
    ).toEqual({ error: "artifact-too-large" });
    const truncated = event();
    truncated.node.req = (async function* () {
      yield Buffer.alloc(31);
    })();
    expect(await handler(truncated as never)).toEqual({
      error: "content-length-mismatch",
    });
    const overlong = event();
    overlong.node.req = (async function* () {
      yield Buffer.alloc(33);
    })();
    expect(await handler(overlong as never)).toEqual({
      error: "content-length-mismatch",
    });
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("passes authenticated viewer scope and exact bytes to the local store", async () => {
    expect(await handler(event() as never)).toEqual(metadata);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-123",
      "viewer",
    );
    expect(mocks.store).toHaveBeenCalledWith({
      email: "owner@example.test",
      designId: "design-123",
      mimeType: "image/png",
      bytes,
    });
  });

  it.each([
    "image/jpeg",
    "image/webp",
    "image/avif",
    "image/svg+xml",
    "application/pdf",
    "application/zip",
    "text/html",
  ])(
    "accepts bounded %s bodies under the same access check",
    async (mimeType) => {
      await handler(
        event({
          headers: {
            origin: "http://localhost:9310",
            "content-type": mimeType,
            "content-length": "32",
          },
        }) as never,
      );
      expect(mocks.assertAccess).toHaveBeenCalledWith(
        "design",
        "design-123",
        "viewer",
      );
      expect(mocks.store).toHaveBeenCalledWith({
        email: "owner@example.test",
        designId: "design-123",
        mimeType,
        bytes,
      });
    },
  );

  it("rejects a third concurrent binary body before allocating or storing it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = event();
    const second = event();
    first.node.req = (async function* () {
      await held;
      yield bytes;
    })();
    second.node.req = (async function* () {
      await held;
      yield bytes;
    })();
    const firstResult = handler(first as never);
    const secondResult = handler(second as never);
    await vi.waitFor(() => expect(mocks.assertAccess).toHaveBeenCalledTimes(2));
    expect(await handler(event() as never)).toEqual({ error: "artifact-busy" });
    release();
    expect(await firstResult).toEqual(metadata);
    expect(await secondResult).toEqual(metadata);
  });
});
