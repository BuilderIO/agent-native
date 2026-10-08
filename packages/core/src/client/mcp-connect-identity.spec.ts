import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMcpConnectIdentity } from "./mcp-connect-identity.js";

function serve(identity: Record<string, string>) {
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
  it("keeps the page's plain-HTTP scheme for its own host", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "192.168.1.20:8080" },
    });
    serve(lanIdentity);

    const identity = await fetchMcpConnectIdentity();

    expect(identity.appUrl).toBe("http://192.168.1.20:8080");
    expect(identity.mcpUrl).toBe("http://192.168.1.20:8080/mcp");
    expect(identity.serverName).toBe("agent-native-mail");
  });

  it("leaves another host's URLs as the server sent them", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:3000" },
    });
    serve(lanIdentity);

    const identity = await fetchMcpConnectIdentity();

    expect(identity.mcpUrl).toBe("https://192.168.1.20:8080/mcp");
  });
});
