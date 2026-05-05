import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchToolEntry } from "./fetch-tool.js";

describe("createFetchToolEntry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runWebRequest(url: string) {
    const entry = createFetchToolEntry()["web-request"];
    return entry.run({ url });
  }

  it.each([
    "http://localhost:3000/_agent-native/actions/x",
    "http://127.0.0.1:3000/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.2/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1.nip.io/",
    "http://lvh.me/",
    "http://[::ffff:127.0.0.1]/",
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "file:///etc/passwd",
  ])("blocks private/internal target %s before fetching", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(runWebRequest(url)).resolves.toContain(
      "Requests to private/internal addresses are not allowed",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows ordinary external HTTPS requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200, statusText: "OK" }));

    await expect(runWebRequest("https://93.184.216.34/api")).resolves.toContain(
      "HTTP 200 OK",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://93.184.216.34/api",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("blocks redirects to private/internal addresses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        statusText: "Found",
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );

    await expect(runWebRequest("https://93.184.216.34/redirect")).resolves.toBe(
      "Redirect to private/internal address blocked.",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://93.184.216.34/redirect",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("redacts echoed key material from upstream responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authorization: "Bearer sk-secret" }), {
        status: 200,
        statusText: "OK",
      }),
    );

    const entry = createFetchToolEntry({
      resolveKeys: async (text) => ({
        resolved: text.replaceAll("${keys.API_TOKEN}", "sk-secret"),
        usedKeys: text.includes("${keys.API_TOKEN}") ? ["API_TOKEN"] : [],
        secretValues: text.includes("${keys.API_TOKEN}") ? ["sk-secret"] : [],
      }),
    })["web-request"];

    const result = await entry.run({
      url: "https://93.184.216.34/api",
      headers: '{"Authorization":"Bearer ${keys.API_TOKEN}"}',
    });

    expect(result).toContain("[redacted]");
    expect(result).not.toContain("sk-secret");
  });

  it("rejects unsupported HTTP methods before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const entry = createFetchToolEntry()["web-request"];

    await expect(
      entry.run({ url: "https://93.184.216.34/api", method: "TRACE" }),
    ).resolves.toContain("Unsupported HTTP method");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
