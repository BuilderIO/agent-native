import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetHubCacheForTests,
  fetchHubServersDetailed,
} from "./hub-client.js";

// Minimal fake fetch response.
function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function errStatus(status: number): Response {
  return new Response("", { status });
}

describe("fetchHubServersDetailed", () => {
  const prevUrl = process.env.AGENT_NATIVE_MCP_HUB_URL;
  const prevToken = process.env.AGENT_NATIVE_MCP_HUB_TOKEN;

  beforeEach(() => {
    process.env.AGENT_NATIVE_MCP_HUB_URL = "https://hub.example";
    process.env.AGENT_NATIVE_MCP_HUB_TOKEN = "token";
    _resetHubCacheForTests();
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.AGENT_NATIVE_MCP_HUB_URL;
    else process.env.AGENT_NATIVE_MCP_HUB_URL = prevUrl;
    if (prevToken === undefined) delete process.env.AGENT_NATIVE_MCP_HUB_TOKEN;
    else process.env.AGENT_NATIVE_MCP_HUB_TOKEN = prevToken;
    vi.restoreAllMocks();
    _resetHubCacheForTests();
  });

  it("normalizes orgId in the merged key so mixed-case hub orgs pass the visibility gate", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ok({
        servers: [
          {
            orgId: "ACME-Corp",
            name: "zapier",
            url: "https://zapier.example",
          },
        ],
      }),
    );
    const result = await fetchHubServersDetailed();
    expect(result.state).toBe("ok");
    if (result.state !== "ok") return;
    // Key must be lowercased + symbol-stripped to match the normalization
    // in `isMcpToolAllowedForRequest()` in visibility.ts.
    expect(Object.keys(result.servers)).toEqual(["hub_acme-corp_zapier"]);
  });

  it("keeps cached servers across a transient 5xx", async () => {
    const good = ok({
      servers: [
        { orgId: "acme", name: "zapier", url: "https://zapier.example" },
      ],
    });
    const bad = errStatus(503);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce(bad);

    const first = await fetchHubServersDetailed();
    expect(first.state).toBe("ok");

    const second = await fetchHubServersDetailed();
    expect(second.state).toBe("unreachable");
    if (second.state !== "unreachable") return;
    // Cache served across the transient failure.
    expect(Object.keys(second.servers)).toEqual(["hub_acme_zapier"]);
  });

  it("clears cached servers on a 401 so a rotated/revoked hub token actually revokes access", async () => {
    const good = ok({
      servers: [
        { orgId: "acme", name: "zapier", url: "https://zapier.example" },
      ],
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce(errStatus(401));

    const first = await fetchHubServersDetailed();
    expect(first.state).toBe("ok");

    const second = await fetchHubServersDetailed();
    expect(second.state).toBe("unreachable");
    if (second.state !== "unreachable") return;
    // Auth error must NOT fall back to the cached set.
    expect(Object.keys(second.servers)).toEqual([]);
  });

  it("clears cached servers on a 403 (forbidden) for the same reason as 401", async () => {
    const good = ok({
      servers: [
        { orgId: "acme", name: "zapier", url: "https://zapier.example" },
      ],
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(good)
      .mockResolvedValueOnce(errStatus(403));

    await fetchHubServersDetailed();
    const second = await fetchHubServersDetailed();
    expect(second.state).toBe("unreachable");
    if (second.state !== "unreachable") return;
    expect(Object.keys(second.servers)).toEqual([]);
  });
});
