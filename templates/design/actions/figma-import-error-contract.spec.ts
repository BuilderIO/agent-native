/**
 * The Figma import cluster's failure contract.
 *
 * `import-figma-frame` reached users as "Action import-figma-frame failed:
 * Internal server error" for every cause — an expired token, a frame the token
 * cannot read, an oversized payload, a missing storage provider — because each
 * was raised as a bare `Error`, which the action HTTP transport replaces with a
 * generic 500. The per-message specs all passed while no user could read any of
 * those messages.
 *
 * These tests assert the property the transport actually keys on
 * (`isActionContractError`), imported from core so it cannot drift, plus the
 * stable `errorCode` the UI branches on. A new diagnosis added to this path
 * without going through `failFigmaImport` fails here.
 */

import { isActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
  getRequestUserEmail: vi.fn(),
  assertAccess: vi.fn(),
  resolveImportDesignId: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  uploadFile: vi.fn(),
  snapshotDesignBeforeAgentEdit: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

vi.mock("../server/lib/import-design-files.js", () => ({
  normalizeImportedHtmlDocument: vi.fn((content: string) => content),
  resolveImportDesignId: mocks.resolveImportDesignId,
  saveImportedDesignFiles: mocks.saveImportedDesignFiles,
}));

import importFigmaFrame from "./import-figma-frame.js";

const VECTOR_FRAME = {
  document: {
    id: "1:2",
    name: "Hero",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    children: [
      {
        id: "1:3",
        name: "Icon",
        type: "VECTOR",
        absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
      },
    ],
  },
};

function jsonEnvelope(json: unknown) {
  return { response: { ok: true, status: 200, json } };
}

/** What the caller receives once the action route has had its say. */
interface CapturedFailure {
  userFacing: boolean;
  message: string;
  errorCode?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

async function captureFailure(
  args: Record<string, unknown>,
): Promise<CapturedFailure> {
  try {
    await importFigmaFrame.run(args as never);
  } catch (err) {
    const typed = err as {
      message?: string;
      errorCode?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
    };
    return {
      userFacing: isActionContractError(err),
      message: typed.message ?? String(err),
      errorCode: typed.errorCode,
      statusCode: typed.statusCode,
      details: typed.details,
    };
  }
  throw new Error("expected the import to fail");
}

describe("figma import failure contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
    mocks.resolveImportDesignId.mockImplementation(
      async (designId?: string) => designId ?? "design-1",
    );
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.snapshotDesignBeforeAgentEdit.mockResolvedValue(undefined);
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "content-type": "image/png" },
      }),
    );
    mocks.uploadFile.mockResolvedValue({
      url: "https://assets.example.test/figma-import.png",
    });
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [],
      warnings: [],
    });
  });

  it("names an unusable URL instead of returning a generic 500", async () => {
    const failure = await captureFailure({
      figmaUrl: "https://example.com/not-figma",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_url_invalid");
    expect(failure.statusCode).toBe(400);
    expect(failure.message).toMatch(/Could not find a Figma file key/);
  });

  it("names an option this path does not implement", async () => {
    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
      asNewScreen: false,
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_unsupported_option");
  });

  it.each([
    { status: 401, detail: "Invalid token", expectedStatus: 401 },
    {
      status: 403,
      detail: "Not allowed to access this file",
      expectedStatus: 403,
    },
    { status: 404, detail: "Not found", expectedStatus: 404 },
    { status: 500, detail: "Figma is down", expectedStatus: 502 },
  ])(
    "surfaces Figma's own $status so the user can act on it",
    async ({ status, detail, expectedStatus }) => {
      mocks.executeProviderApiRequest.mockResolvedValue({
        response: { ok: false, status, statusText: "Error", text: detail },
      });

      const failure = await captureFailure({
        fileKey: "abcDEF12345",
        nodeId: "1:2",
      });
      expect(failure.userFacing).toBe(true);
      expect(failure.errorCode).toBe("figma_request_failed");
      expect(failure.statusCode).toBe(expectedStatus);
      expect(failure.message).toContain(detail);
      expect(failure.details).toMatchObject({ figmaStatus: status });
    },
  );

  it("carries rate-limit retry and plan facts in details, not on the error object", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: "Rate limit exceeded",
        headers: {
          "retry-after": "90",
          "x-figma-plan-tier": "starter",
          "x-figma-rate-limit-type": "low",
          "x-figma-upgrade-link": "https://www.figma.com/pricing",
        },
      },
    });

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_rate_limited");
    expect(failure.statusCode).toBe(429);
    expect(failure.details).toEqual({
      figmaStatus: 429,
      retryAfterSeconds: 90,
      planTier: "starter",
      rateLimitType: "low",
      upgradeUrl: "https://www.figma.com/pricing",
    });
  });

  it("drops an HTTP-date Retry-After rather than reporting a NaN countdown", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: {
        ok: false,
        status: 429,
        text: "Rate limit exceeded",
        headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      },
    });

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.errorCode).toBe("figma_rate_limited");
    expect(failure.details).not.toHaveProperty("retryAfterSeconds");
  });

  it("names a missing node instead of returning a generic 500", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      jsonEnvelope({ nodes: {} }),
    );

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_node_not_found");
    expect(failure.statusCode).toBe(404);
    expect(failure.details).toMatchObject({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
  });

  it("names a truncated provider response instead of parsing it as whole", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: true, status: 200, truncated: true, size: 5_000_000 },
    });

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_payload_too_large");
    expect(failure.statusCode).toBe(413);
  });

  it("names an unreachable render asset instead of returning a generic 500", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": VECTOR_FRAME } });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: { "1:3": "https://renders.example.test/icon.png" },
          });
        }
        return jsonEnvelope({ images: {} });
      },
    );
    mocks.ssrfSafeFetch.mockRejectedValue(new Error("SSRF blocked"));

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_asset_unavailable");
    expect(failure.statusCode).toBe(502);
  });

  it("names missing durable storage instead of returning a generic 500", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": VECTOR_FRAME } });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: { "1:3": "https://renders.example.test/icon.png" },
          });
        }
        return jsonEnvelope({ images: {} });
      },
    );
    mocks.uploadFile.mockResolvedValue(null);

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_storage_unavailable");
    expect(failure.message).toMatch(
      /Settings > File uploads|Connect Builder\.io/,
    );
  });

  it("names an unauthenticated import instead of returning a generic 500", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": VECTOR_FRAME } });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: { "1:3": "https://renders.example.test/icon.png" },
          });
        }
        return jsonEnvelope({ images: {} });
      },
    );

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.userFacing).toBe(true);
    expect(failure.errorCode).toBe("figma_auth_required");
    expect(failure.statusCode).toBe(401);
  });

  it("leaves an access denial to the sharing layer", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("No access"));

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
      designId: "private-design",
    });
    expect(failure.message).toBe("No access");
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });
});

describe("image download failures keep their own diagnosis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
    mocks.resolveImportDesignId.mockImplementation(
      async (designId?: string) => designId ?? "design-1",
    );
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.snapshotDesignBeforeAgentEdit.mockResolvedValue(undefined);
    mocks.uploadFile.mockResolvedValue({
      url: "https://assets.example.test/figma-import.png",
    });
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [],
      warnings: [],
    });
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ path }: any) => {
        if (path === "/files/abcDEF12345/nodes") {
          return jsonEnvelope({ nodes: { "1:2": VECTOR_FRAME } });
        }
        if (path === "/images/abcDEF12345") {
          return jsonEnvelope({
            images: { "1:3": "https://renders.example.test/icon.png" },
          });
        }
        return jsonEnvelope({ images: {} });
      },
    );
  });

  it("reports an over-budget asset as too large", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: {
          "content-length": String(15 * 1024 * 1024 + 1),
          "content-type": "image/png",
        },
      }),
    );

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.errorCode).toBe("figma_payload_too_large");
    expect(failure.message).toMatch(/15 MB per-asset limit/i);
  });

  it("reports a download that dies mid-stream as unreachable, not oversized", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([137, 80, 78, 71]));
        controller.error(new Error("socket hang up"));
      },
    });
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(body, { headers: { "content-type": "image/png" } }),
    );

    const failure = await captureFailure({
      fileKey: "abcDEF12345",
      nodeId: "1:2",
    });
    expect(failure.errorCode).toBe("figma_asset_unavailable");
    expect(failure.statusCode).toBe(502);
    expect(failure.message).toMatch(/socket hang up/);
  });
});
