import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  resolveAccess: vi.fn(),
  resolveAuth: vi.fn(),
  trackDeckExported: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "active-org",
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../../../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { uploadedAssets: {} },
}));

vi.mock("../../../lib/bounded-multipart.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/bounded-multipart.js")>();
  return {
    readBoundedMultipartFormData: actual.readBoundedMultipartFormData,
  };
});

vi.mock("../../../handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => mocks.resolveAuth(...args),
}));

vi.mock("../../../lib/chunked-upload-session.js", () => ({
  deleteOrphanedVideoAssetCleanup: vi.fn(),
  listOrphanedVideoAssetCleanups: vi.fn(),
  recordOrphanedVideoAssetCleanup: vi.fn(),
}));

vi.mock("../../../lib/deck-asset-scope.js", () => ({
  assertDeckAssetUploadScope: vi.fn(),
  parseOptionalDeckId: () => undefined,
}));

vi.mock("../../../lib/deck-export-tracking.js", () => ({
  trackDeckExported: (...args: unknown[]) => mocks.trackDeckExported(...args),
}));

vi.mock("../../../lib/google-docs-oauth.js", () => ({
  getGoogleDocsAccessToken: (...args: unknown[]) =>
    mocks.getAccessToken(...args),
}));

vi.mock("../../../lib/request-wait-until.js", () => ({
  requestWaitUntil: () => undefined,
}));

vi.mock("../../../lib/slides-tracking.js", () => ({
  generationAttemptIdOf: () => undefined,
}));

import { getResponseStatus, mockEvent } from "h3";

import handler, {
  MAX_GOOGLE_SLIDES_EXPORT_REQUEST_BYTES,
} from "./google-slides.post";

beforeEach(() => {
  mocks.getAccessToken.mockReset();
  mocks.resolveAccess.mockReset();
  mocks.resolveAuth.mockReset();
  mocks.resolveAuth.mockResolvedValue({
    ok: true,
    context: { email: "owner@example.test", orgId: "active-org" },
  });
  mocks.trackDeckExported.mockReset();
  mocks.trackDeckExported.mockResolvedValue(undefined);
});

it("parses a bounded export multipart body before reporting a missing PPTX", async () => {
  const form = new FormData();
  form.append("title", "Alpha deck");
  const event = mockEvent(
    new Request("https://slides.example.test/api/exports/google-slides", {
      method: "POST",
      body: form,
    }),
  );

  await expect(handler(event as never)).resolves.toEqual({
    error: "file required",
  });

  expect(getResponseStatus(event as never)).toBe(400);
  expect(mocks.getAccessToken).not.toHaveBeenCalled();
});

it("rejects an oversized export request before multipart parsing", async () => {
  const event = mockEvent(
    new Request("https://slides.example.test/api/exports/google-slides", {
      method: "POST",
      headers: {
        "content-length": String(MAX_GOOGLE_SLIDES_EXPORT_REQUEST_BYTES + 1),
        "content-type": "multipart/form-data; boundary=upload",
      },
      body: "--upload--",
    }),
  );

  await expect(handler(event as never)).rejects.toMatchObject({
    statusCode: 413,
  });
  expect(mocks.getAccessToken).not.toHaveBeenCalled();
});
