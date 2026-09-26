import http from "node:http";
import type { AddressInfo } from "node:net";

import { auth } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  McpOAuthClientProvider,
  McpOAuthRegistrationUnsupportedError,
  startMcpOAuthAuthorization,
} from "./oauth-client.js";

/**
 * These run the real SDK against a loopback authorization server rather than a
 * mock, because the framework's refusal is only correct while the SDK really
 * does need a client it cannot obtain. If a future SDK gains another way to
 * reach `/authorize` without registering, these fail and the refusal has to go.
 */
const PRIVATE_ORIGINS_ENV = "AGENT_NATIVE_MCP_OAUTH_PRIVATE_ORIGINS";
const REDIRECT_URL =
  "https://app.example.com/_agent-native/mcp/servers/oauth/callback";

let activeServer: http.Server | undefined;
const previousPrivateOrigins = process.env[PRIVATE_ORIGINS_ENV];

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
  if (previousPrivateOrigins === undefined) {
    delete process.env[PRIVATE_ORIGINS_ENV];
  } else {
    process.env[PRIVATE_ORIGINS_ENV] = previousPrivateOrigins;
  }
});

async function startAuthorizationServer(
  extraMetadata: Record<string, unknown>,
): Promise<string> {
  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url?.startsWith("/.well-known/oauth-protected-resource")) {
      json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
      return;
    }
    if (req.url?.startsWith("/.well-known/oauth-authorization-server")) {
      json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        ...extraMetadata,
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env[PRIVATE_ORIGINS_ENV] = origin;
  return origin;
}

describe("MCP SDK registration contract", () => {
  it("cannot reach authorization via CIMD without a client metadata URL", async () => {
    const origin = await startAuthorizationServer({
      client_id_metadata_document_supported: true,
    });
    const provider = new McpOAuthClientProvider({
      serverUrl: `${origin}/mcp`,
      redirectUrl: REDIRECT_URL,
      state: "<STATE>",
    });

    expect(provider.clientMetadataUrl).toBeUndefined();
    await expect(
      auth(provider, { serverUrl: `${origin}/mcp` }),
    ).rejects.toThrow(/does not support dynamic client registration/);
    expect(provider.authorizationRedirect).toBeUndefined();
  }, 30_000);

  it("refuses that same server early, with an actionable error", async () => {
    const origin = await startAuthorizationServer({
      client_id_metadata_document_supported: true,
    });

    await expect(
      startMcpOAuthAuthorization({
        serverUrl: `${origin}/mcp`,
        redirectUrl: REDIRECT_URL,
        state: "<STATE>",
      }),
    ).rejects.toBeInstanceOf(McpOAuthRegistrationUnsupportedError);
  }, 30_000);
});
