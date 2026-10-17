import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMcpConnectIdentity } from "./mcp-connect-identity.js";

function serve(identity: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(identity), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

const lanIdentity = {
  serverName: "agent-native-mail",
  appName: "mail",
  appUrl: "https://192.168.1.20:8080",
  mcpUrl: "https://192.168.1.20:8080/mcp",
  environment: "production",
  connect: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMcpConnectIdentity", () => {
  it("keeps the server's URLs when the page is plain HTTP on that host", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "192.168.1.20:8080" },
    });
    serve(lanIdentity);

    const identity = await fetchMcpConnectIdentity();

    expect(identity).toEqual(lanIdentity);
  });

  it("refuses a response without the connect flag", async () => {
    const { connect: _connect, ...withoutConnect } = lanIdentity;
    serve(withoutConnect);

    await expect(fetchMcpConnectIdentity()).rejects.toThrow("malformed");
  });
});
