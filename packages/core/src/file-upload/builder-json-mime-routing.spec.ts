import { beforeEach, describe, expect, it, vi } from "vitest";

import { builderFileUploadProvider } from "./builder.js";

const resolveBuilderCredentialsDetailedMock = vi.hoisted(() => vi.fn());
const resolveBuilderApiAuthorizationMock = vi.hoisted(() => vi.fn());
const resolveBuilderRequestAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("../server/builder-api-auth.js", () => ({
  resolveBuilderApiAuthorization: resolveBuilderApiAuthorizationMock,
  resolveBuilderRequestAuthorization: resolveBuilderRequestAuthorizationMock,
}));

vi.mock("../server/credential-provider.js", () => ({
  resolveBuilderCredentialsDetailed: resolveBuilderCredentialsDetailedMock,
}));

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("builderFileUploadProvider JSON/text-plain MIME routing", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BUILDER_APP_HOST;
    delete process.env.BUILDER_PUBLIC_APP_HOST;
    vi.clearAllMocks();
    vi.useFakeTimers();
    resolveBuilderCredentialsDetailedMock.mockResolvedValue({
      privateKey: "bpk-secret",
      publicKey: "public-key",
    });
    resolveBuilderApiAuthorizationMock.mockResolvedValue("Bearer bpk-secret");
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "bpk-secret",
      authorization: "Bearer bpk-secret",
      source: "legacy",
      legacyPublicKey: "public-key",
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it.each(["application/json", "text/plain", "Application/JSON", "TEXT/PLAIN"])(
    "routes %s uploads through the signed URL path instead of the legacy endpoint that misparses them",
    async (mimeType) => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            uploadUrl: "https://storage.example.com/upload",
            assetId: "asset-json",
            requiredHeaders: { "Content-Type": mimeType },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
        .mockResolvedValueOnce(
          jsonResponse({
            url: "https://cdn.builder.io/file.json",
            id: "asset-json",
          }),
        );

      const result = await builderFileUploadProvider.upload({
        data: new Uint8Array([1, 2, 3]),
        filename: "data.json",
        mimeType,
      });

      expect(result).toEqual({
        url: "https://cdn.builder.io/file.json",
        id: "asset-json",
        provider: "builder",
      });
      const [signedUrl] = fetchMock.mock.calls[0];
      expect(new URL(signedUrl.toString()).pathname).toBe(
        "/api/v1/upload/signed-url",
      );
    },
  );
});
