import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrfSafeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import {
  resolveOAuthClientMetadataDocument,
  validateOAuthClientMetadataUrl,
} from "./oauth-client-metadata.js";

function metadataResponse(
  clientId: string,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      client_id: clientId,
      client_name: "Example MCP client",
      redirect_uris: ["http://localhost:54545/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      ...overrides,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    },
  );
}

describe("OAuth Client ID Metadata Documents", () => {
  beforeEach(() => {
    ssrfSafeFetchMock.mockReset();
  });

  it("fetches, validates, and conservatively caches a metadata document", async () => {
    const clientId = "https://client-one.example.com/oauth/client.json";
    ssrfSafeFetchMock.mockResolvedValueOnce(
      metadataResponse(clientId, {}, { "cache-control": "public, max-age=60" }),
    );

    await expect(
      resolveOAuthClientMetadataDocument(clientId),
    ).resolves.toMatchObject({
      clientId,
      clientName: "Example MCP client",
      redirectUris: ["http://localhost:54545/callback"],
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
    });
    await resolveOAuthClientMetadataDocument(clientId);

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({
        headers: {
          Accept: "application/json, application/client-metadata+json",
        },
        signal: expect.any(AbortSignal),
      }),
      { maxRedirects: 2, httpsOnly: true },
    );
  });

  it("does not cache documents without explicit HTTP freshness", async () => {
    const clientId = "https://uncached-client.example.com/oauth/client.json";
    ssrfSafeFetchMock
      .mockResolvedValueOnce(metadataResponse(clientId))
      .mockResolvedValueOnce(metadataResponse(clientId));

    await resolveOAuthClientMetadataDocument(clientId);
    await resolveOAuthClientMetadataDocument(clientId);

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a document whose client_id is not the exact URL", async () => {
    const clientId = "https://client-two.example.com/oauth/client.json";
    ssrfSafeFetchMock.mockResolvedValueOnce(
      metadataResponse("https://other.example.com/oauth/client.json"),
    );

    await expect(resolveOAuthClientMetadataDocument(clientId)).rejects.toThrow(
      /client_id does not match/,
    );
  });

  it("rejects non-HTTPS and root-path client IDs without fetching", async () => {
    expect(() =>
      validateOAuthClientMetadataUrl(
        "http://client-three.example.com/oauth/client.json",
      ),
    ).toThrow(/HTTPS with a non-root path/);
    expect(() =>
      validateOAuthClientMetadataUrl("https://client-three.example.com/"),
    ).toThrow(/HTTPS with a non-root path/);

    await expect(
      resolveOAuthClientMetadataDocument(
        "http://client-three.example.com/oauth/client.json",
      ),
    ).rejects.toThrow(/HTTPS with a non-root path/);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("rejects literal and encoded dot path segments", () => {
    expect(() =>
      validateOAuthClientMetadataUrl(
        "https://client-three.example.com/oauth/../client.json",
      ),
    ).toThrow(/dot path segments/);
    expect(() =>
      validateOAuthClientMetadataUrl(
        "https://client-three.example.com/oauth/%2e%2e/client.json",
      ),
    ).toThrow(/dot path segments/);
  });

  it("rejects private destinations through the shared SSRF guard", async () => {
    const clientId = "https://127.0.0.1/oauth/client.json";
    ssrfSafeFetchMock.mockRejectedValueOnce(
      new Error("SSRF blocked: refusing to fetch private/internal address"),
    );

    await expect(resolveOAuthClientMetadataDocument(clientId)).rejects.toThrow(
      /SSRF blocked/,
    );
  });

  it("rejects oversized response bodies", async () => {
    const clientId = "https://client-four.example.com/oauth/client.json";
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response("x".repeat(64 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(resolveOAuthClientMetadataDocument(clientId)).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects invalid JSON documents", async () => {
    const clientId = "https://client-five.example.com/oauth/client.json";
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(resolveOAuthClientMetadataDocument(clientId)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("bounds the complete metadata resolution time", async () => {
    vi.useFakeTimers();
    try {
      const clientId = "https://slow-client.example.com/oauth/client.json";
      ssrfSafeFetchMock.mockReturnValueOnce(new Promise(() => {}));

      const pending = resolveOAuthClientMetadataDocument(clientId);
      const rejection = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(5_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
