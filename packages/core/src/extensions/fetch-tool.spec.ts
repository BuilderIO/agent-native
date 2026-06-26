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

  it("sends browser-like headers by default so anti-bot middleware doesn't block the fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("<html></html>", { status: 200, statusText: "OK" }),
      );

    await runWebRequest("https://93.184.216.34/page");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentHeaders = (fetchSpy.mock.calls[0][1] as RequestInit)
      ?.headers as Record<string, string>;
    expect(sentHeaders["User-Agent"]).toMatch(/Chrome\/\d+/);
    expect(sentHeaders["Accept"]).toContain("text/html");
    expect(sentHeaders["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(sentHeaders["Sec-Fetch-Mode"]).toBe("navigate");
  });

  it("lets caller-supplied headers override the browser defaults", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200, statusText: "OK" }));

    const entry = createFetchToolEntry()["web-request"];
    await entry.run({
      url: "https://93.184.216.34/api",
      headers:
        '{"User-Agent":"my-bot/1.0","Authorization":"Bearer xyz","Accept":"application/json"}',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentHeaders = (fetchSpy.mock.calls[0][1] as RequestInit)
      ?.headers as Record<string, string>;
    expect(sentHeaders["User-Agent"]).toBe("my-bot/1.0");
    expect(sentHeaders["Authorization"]).toBe("Bearer xyz");
    expect(sentHeaders["Accept"]).toBe("application/json");
    // Other browser defaults still fill in for headers the caller didn't set.
    expect(sentHeaders["Sec-Fetch-Mode"]).toBe("navigate");
  });

  it("extracts HTML responses to readable markdown by default", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html>
        <html>
          <head><title>API Docs</title></head>
          <body>
            <nav>Navigation noise</nav>
            <main>
              <article>
                <h1>Widget API</h1>
                <p>Use the list widgets endpoint for pagination.</p>
                <a href="/reference/widgets">Widget reference</a>
              </article>
            </main>
          </body>
        </html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );

    const result = await runWebRequest("https://93.184.216.34/api");

    expect(result).toContain("HTTP 200 OK");
    expect(result).toContain("# Widget API");
    expect(result).toContain("Use the list widgets endpoint");
    expect(result).toContain(
      "[Widget reference](https://93.184.216.34/reference/widgets)",
    );
    expect(result).not.toContain("<html>");
  });

  it("returns bounded matches from extracted HTML content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html><html><body><main>
          <h1>Endpoints</h1>
          <p>GET /v1/widgets returns widgets.</p>
          <p>POST /v1/widgets creates widgets.</p>
        </main></body></html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html" },
        },
      ),
    );

    const entry = createFetchToolEntry()["web-request"];
    const result = await entry.run({
      url: "https://93.184.216.34/api",
      responseMode: "matches",
      search: {
        regex: "\\b(GET|POST) /v1/widgets\\b",
        maxMatches: 1,
        contextChars: 24,
      },
    });

    expect(result).toContain("Matches: 1 shown of 2");
    expect(result).toContain("GET /v1/widgets");
    expect(result).toContain("1 omitted");
  });

  it("rejects unsafe regex searches before running them over fetched content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("aaaaaaaaaaaaaaaaaaaa!", {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
      }),
    );

    const entry = createFetchToolEntry()["web-request"];
    const result = await entry.run({
      url: "https://93.184.216.34/logs",
      responseMode: "matches",
      search: { regex: "(a+)+$" },
    });

    expect(result).toContain("Unsafe regex rejected");
  });
});
