import { afterEach, describe, expect, it, vi } from "vitest";

import { saveApiKeyValue, updateApiKeyOrigins } from "./api-keys-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("custom key requests", () => {
  it("sends an approved origin with a new key, then edits only policy metadata", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    await saveApiKeyValue({
      name: "WEBHOOK_TOKEN",
      value: "fake-value",
      registered: false,
      shared: true,
      urlAllowlist: ["https://api.example.test"],
    });
    await updateApiKeyOrigins({
      name: "WEBHOOK_TOKEN",
      scope: "workspace",
      owner: "org",
      urlAllowlist: ["https://new.example.test"],
    });

    expect(requests[0]?.url).toContain("/_agent-native/secrets/adhoc");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      name: "WEBHOOK_TOKEN",
      value: "fake-value",
      scope: "workspace",
      urlAllowlist: ["https://api.example.test"],
    });
    expect(requests[1]?.init.method).toBe("PATCH");
    expect(requests[1]?.url).toContain(
      "/_agent-native/secrets/adhoc/WEBHOOK_TOKEN",
    );
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      scope: "workspace",
      owner: "org",
      urlAllowlist: ["https://new.example.test"],
    });
  });
});
