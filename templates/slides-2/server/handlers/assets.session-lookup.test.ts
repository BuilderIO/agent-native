import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSlidesRequestAuth = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  runWithRequestContext: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  like: vi.fn(),
  or: vi.fn(),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { uploadedAssets: {} },
}));

vi.mock("h3", () => ({
  assertBodySize: vi.fn(),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: vi.fn(),
  readMultipartFormData: vi.fn(),
  readRawBody: vi.fn(),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) =>
    mockResolveSlidesRequestAuth(...args),
}));

import { uploadAsset } from "./assets";

describe("image upload session lookup", () => {
  beforeEach(() => {
    mockResolveSlidesRequestAuth.mockReset();
    mockSetResponseStatus.mockReset();
  });

  it("returns a retryable service error when session lookup fails", async () => {
    mockResolveSlidesRequestAuth.mockResolvedValue({
      ok: false,
      statusCode: 503,
      error: "Could not resolve session.",
    });
    const event = {};

    const result = await uploadAsset(event as never);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 503);
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(event, 401);
    expect(result).toEqual({
      error: "The upload service is temporarily unavailable. Try again.",
      errorCode: "image_upload_session_unavailable",
    });
  });

  it("returns an authentication error for a genuine anonymous visitor", async () => {
    mockResolveSlidesRequestAuth.mockResolvedValue({
      ok: true,
      context: { email: undefined },
    });
    const event = {};

    const result = await uploadAsset(event as never);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 401);
    expect(result).toEqual({
      error: "Sign in to upload images.",
      errorCode: "image_upload_auth_required",
    });
  });
});
