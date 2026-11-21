import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../action.js";
import { runWithRequestContext } from "../server/request-context.js";
import { createFetchToolEntry } from "./fetch-tool.js";

const mockWriteWorkspaceFile = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

vi.mock("../workspace-files/store.js", () => ({
  SAVE_TO_FILE_MAX_BYTES: 20 * 1024 * 1024,
  isScratchWorkspacePath: (path: string) =>
    path === "scratch" || path.startsWith("scratch/"),
  toWorkspaceFileCard: (meta: unknown) => ({ meta }),
  writeWorkspaceFile: mockWriteWorkspaceFile,
}));

describe("createFetchToolEntry", () => {
  it.each([undefined, "exports/digest.json", "scratch/digest.json"])(
    "rejects a provider failure inside HTTP 200 before saving (%s)",
    async (saveToFile) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await expect(
        createFetchToolEntry()["web-request"].run({
          url: "https://slack.com/api/chat.postMessage",
          method: "POST",
          saveToFile,
        }),
      ).rejects.toMatchObject({
        errorCode: "web_request_provider_failed",
        message: expect.stringContaining("invalid_auth"),
      });
      expect(mockWriteWorkspaceFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    { url: "https://slack.com/api/chat.postMessage", ok: true },
    { url: "https://93.184.216.34/api/chat.postMessage", ok: false },
    { url: "https://slack.com/api-example", ok: false },
    { url: "https://slack.com/help", ok: false },
  ])(
    "uses only the matching provider envelope: $url, ok=$ok",
    async ({ url, ok }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok }), { status: 200 }),
      );
      await expect(
        createFetchToolEntry()["web-request"].run({ url, method: "POST" }),
      ).resolves.toContain("HTTP 200");
    },
  );

  it.each([200, 429, 503])(
    "preserves an HTTP failure when its body is unreadable (%s)",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("Response stream failed"));
            },
          }),
          { status },
        ),
      );
      await expect(
        createFetchToolEntry()["web-request"].run({
          url: "https://93.184.216.34/digest",
          method: "POST",
        }),
      ).rejects.toMatchObject({
        errorCode:
          status === 200 ? "web_request_body_unreadable" : `http_${status}`,
      });
    },
  );

  it.each([400, 403, 429, 503])(
    "rejects an unsuccessful HTTP mutation (%s)",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Send rejected", { status }),
      );
      await expect(
        createFetchToolEntry()["web-request"].run({
          url: "https://93.184.216.34/digest",
          method: "POST",
        }),
      ).rejects.toMatchObject({
        errorCode: `http_${status}`,
        message: expect.stringContaining("Send rejected"),
      });
    },
  );

  it("rejects absent key references before any request is sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const tool = createFetchToolEntry({
      resolveKeys: async () => {
        throw new Error("Key SLACK_WEBHOOK is unavailable");
      },
    })["web-request"];
    await expect(
      tool.run({ url: "https://${keys.SLACK_WEBHOOK}", method: "POST" }),
    ).rejects.toMatchObject({ errorCode: "web_request_key_resolution_failed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a network failure without exposing substituted secrets", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Unavailable: synthetic-secret"),
    );
    const tool = createFetchToolEntry({
      resolveKeys: async (text) => ({
        resolved: text,
        usedKeys: ["SLACK_WEBHOOK"],
        secretValues: ["synthetic-secret"],
      }),
    })["web-request"];
    await expect(
      tool.run({ url: "https://93.184.216.34/digest", method: "POST" }),
    ).rejects.toMatchObject({
      errorCode: "web_request_failed",
      message: "Request failed: Unavailable: [redacted]",
    });
  });
  beforeEach(() => {
    mockWriteWorkspaceFile.mockReset();
    mockWriteWorkspaceFile.mockResolvedValue({ id: "workspace-file-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runWebRequest(url: string) {
    const entry = createFetchToolEntry()["web-request"];
    return entry.run({ url });
  }

  async function runSavedWebRequest(
    args: Record<string, unknown> & { url: string },
  ) {
    return runWithRequestContext(
      { userEmail: "ada@example.com", orgId: "org-1" },
      () => createFetchToolEntry()["web-request"].run(args),
    );
  }

  it("classifies only non-persisting GET and HEAD calls as Plan-mode reads", () => {
    const entry = createFetchToolEntry()["web-request"];
    const effect = entry.planMode?.effect;
    expect(typeof effect).toBe("function");
    if (typeof effect !== "function") throw new Error("Missing classifier");

    expect(effect({ url: "https://example.com" })).toBe("read");
    expect(effect({ url: "https://example.com", method: "HEAD" })).toBe("read");
    expect(effect({ url: "https://example.com", method: "POST" })).toBe(
      "write",
    );
    expect(
      effect({
        url: "https://example.com",
        method: "GET",
        saveToFile: "page.html",
      }),
    ).toBe("write");
    expect(entry.planMode?.allowedValues).toEqual({
      method: ["GET", "HEAD"],
    });
    expect(entry.planMode?.omittedProperties).toEqual(["saveToFile"]);
  });

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

    await expect(runWebRequest(url)).rejects.toThrow(
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

  it.each([
    {
      method: "HEAD",
      contentType: "application/zip",
      body: null,
      length: "42",
    },
    {
      method: "GET",
      contentType: "application/zip",
      body: new Uint8Array(),
      length: "0",
    },
    {
      method: "GET",
      contentType: "image/png",
      body: new Uint8Array(),
      length: "0",
    },
  ])(
    "returns an empty $method response with $contentType",
    async ({ method, contentType, body, length }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          status: 200,
          statusText: "OK",
          headers: { "content-type": contentType, "content-length": length },
        }),
      );
      await expect(
        createFetchToolEntry()["web-request"].run({
          url: "https://example.com/archive",
          method,
        }),
      ).resolves.toBe("HTTP 200 OK\n\n");
    },
  );

  it("rejects nonempty binary responses even with a zero content length", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("binary", {
        headers: { "content-type": "application/zip", "content-length": "0" },
      }),
    );
    await expect(
      runWebRequest("https://example.com/archive"),
    ).rejects.toMatchObject({
      errorCode: "web_request_binary_response",
    });
  });

  it("attaches public image responses as vision context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([255, 216, 0, 4]), {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "image/jpeg" },
      }),
    );

    await expect(
      runWebRequest("https://93.184.216.34/frame.jpg"),
    ).resolves.toEqual({
      status: 200,
      statusText: "OK",
      contentType: "image/jpeg",
      url: "https://93.184.216.34/frame.jpg",
      _agentImages: [{ data: "/9gABA==", mediaType: "image/jpeg" }],
    });
  });

  it.each([
    {
      name: "an Authorization header",
      args: {
        url: "https://93.184.216.34/frame.jpg",
        headers: JSON.stringify({ Authorization: "Bearer example-token" }),
      },
    },
    {
      name: "userinfo in the URL",
      args: { url: "https://user:password@93.184.216.34/frame.jpg" },
    },
    {
      name: "a signed URL query parameter",
      args: {
        url: "https://93.184.216.34/frame.jpg?X-Amz-Signature=example-signature",
      },
    },
    {
      name: "a bare key query parameter",
      args: {
        url: "https://93.184.216.34/frame.jpg?key=example-key",
      },
    },
    {
      name: "a compact credential header",
      args: {
        url: "https://93.184.216.34/frame.jpg",
        headers: JSON.stringify({ "x-rapidapi-key": "example-key" }),
      },
    },
    {
      name: "a credential-bearing URL fragment",
      args: {
        url: "https://93.184.216.34/frame.jpg#access_token=example-token",
      },
    },
  ])(
    "does not attach credentialed image responses with $name",
    async ({ args }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("jpeg bytes", {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "image/jpeg" },
        }),
      );

      await expect(
        createFetchToolEntry()["web-request"].run(args),
      ).rejects.toMatchObject({
        errorCode: "web_request_binary_response",
        message: expect.not.stringContaining("jpeg bytes"),
      });
    },
  );

  it("blocks redirects to private/internal addresses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        statusText: "Found",
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );

    await expect(
      runWebRequest("https://93.184.216.34/redirect"),
    ).rejects.toThrow("Redirect to private/internal address blocked.");
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

  it("does not persist failed responses to durable files", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error_code,permission_denied\n", {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "text/csv" },
      }),
    );

    const result = runWithRequestContext(
      { userEmail: "ada@example.com", orgId: "org-1" },
      () =>
        createFetchToolEntry()["web-request"].run({
          url: "https://93.184.216.34/api",
          responseMode: "raw",
          saveToFile: "exports/report.csv",
        }),
    );

    await expect(result).rejects.toMatchObject({
      errorCode: "http_403",
      message: expect.stringContaining("Refusing to save a failed response"),
    });
    expect(mockWriteWorkspaceFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "ZIP bytes mislabeled as text",
      bytes: [80, 75, 3, 4, 0, 255],
      contentType: "text/plain",
      status: 200,
    },
    {
      name: "ZIP bytes without a content type",
      bytes: [80, 75, 3, 4, 0, 255],
      contentType: undefined,
      status: 200,
    },
    {
      name: "invalid UTF-8 without NUL",
      bytes: [255, 254],
      contentType: "application/json",
      status: 200,
    },
    {
      name: "NUL in valid UTF-8",
      bytes: [0],
      contentType: "text/plain",
      status: 200,
    },
    {
      name: "binary Excel workbook bytes",
      bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
      contentType: "application/vnd.ms-excel",
      status: 200,
    },
    {
      name: "Excel-labeled UTF-8 control bytes",
      bytes: [0, 1, 2],
      contentType: "application/vnd.ms-excel",
      status: 200,
    },
    {
      name: "valid UTF-8 ZIP MIME",
      bytes: [65, 66],
      contentType: "application/zip",
      status: 200,
    },
    {
      name: "valid UTF-8 binary media MIME",
      bytes: [65, 66],
      contentType: "audio/mpeg",
      status: 200,
    },
    {
      name: "valid UTF-8 octet stream",
      bytes: [65, 66],
      contentType: "application/octet-stream",
      status: 200,
    },
    {
      name: "valid UTF-8 ZIP alias",
      bytes: [65, 66],
      contentType: "application/x-zip-compressed",
      status: 200,
    },
    {
      name: "binary HTTP error",
      bytes: [80, 75, 3, 4, 0, 255],
      contentType: "text/plain",
      status: 503,
    },
  ])(
    "rejects $name before processing, errors, or writes",
    async ({ bytes, contentType, status }) => {
      const marker = "synthetic-binary-marker";
      const body = new Uint8Array([
        ...new TextEncoder().encode(marker),
        ...bytes,
      ]);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          status,
          headers: contentType ? { "content-type": contentType } : {},
        }),
      );

      let caught: unknown;
      try {
        await runSavedWebRequest({
          url: "https://example.com/archive",
          saveToFile: "scratch/archive.zip",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        errorCode:
          status === 200 ? "web_request_binary_response" : `http_${status}`,
        message: expect.stringContaining("UTF-8 text only"),
      });
      expect(String((caught as Error).message)).toContain("blob/file storage");
      expect(String((caught as Error).message)).not.toContain(marker);
      expect(String((caught as Error).message)).not.toContain("\0");
      expect(mockWriteWorkspaceFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "binary MIME", bytes: [65, 66], contentType: "application/zip" },
    { name: "image MIME", bytes: [65, 66], contentType: "image/png" },
    { name: "invalid UTF-8", bytes: [255, 254], contentType: "text/plain" },
    { name: "NUL", bytes: [0], contentType: "text/plain" },
    { name: "ZIP control bytes", bytes: [3, 4], contentType: "text/plain" },
    {
      name: "escape sequence",
      bytes: [27, 91, 50, 74],
      contentType: "text/plain",
    },
    { name: "DEL", bytes: [127], contentType: "text/plain" },
  ])(
    "does not expose $name in inline HTTP errors",
    async ({ bytes, contentType }) => {
      const marker = "synthetic-inline-binary-marker";
      const body = new Uint8Array([
        ...new TextEncoder().encode(marker),
        ...bytes,
      ]);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          status: 503,
          headers: { "content-type": contentType },
        }),
      );

      let caught: unknown;
      try {
        await runWebRequest("https://example.com/error");
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        errorCode: "http_503",
        message: expect.stringContaining("UTF-8 text only"),
      });
      expect(String((caught as Error).message)).not.toContain(marker);
    },
  );

  it("rejects binary MIME before reporting an HTTP 200 provider failure", async () => {
    const body = JSON.stringify({
      ok: false,
      error: "synthetic-provider-marker",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { headers: { "content-type": "application/zip" } }),
    );
    await expect(
      createFetchToolEntry()["web-request"].run({
        url: "https://slack.com/api/chat.postMessage",
        method: "POST",
      }),
    ).rejects.toMatchObject({
      errorCode: "web_request_binary_response",
      message: expect.not.stringContaining("synthetic-provider-marker"),
    });
  });

  it.each([undefined, "scratch/result.txt"])(
    "rejects valid UTF-8 binary control bytes before inline output or saving (%s)",
    async (saveToFile) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { "content-type": "text/plain" },
        }),
      );
      await expect(
        runSavedWebRequest({ url: "https://example.com/data", saveToFile }),
      ).rejects.toMatchObject({ errorCode: "web_request_binary_response" });
      expect(mockWriteWorkspaceFile).not.toHaveBeenCalled();
    },
  );

  it.each([200, 503])(
    "preserves normal Unicode text and whitespace in inline responses (%s)",
    async (status) => {
      const body = "こんにちは\tcolumn\r\nnext\fpage";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          status,
          headers: { "content-type": "text/plain" },
        }),
      );
      const result = runWebRequest("https://example.com/text");
      if (status === 200) await expect(result).resolves.toContain(body);
      else
        await expect(result).rejects.toMatchObject({
          errorCode: "http_503",
          message: expect.stringContaining(body),
        });
    },
  );

  it.each([
    {
      contentType: "application/vnd.ms-excel",
      body: "name,value\r\n東京,42\r\n",
    },
    { contentType: "application/json", body: '{"greeting":"こんにちは"}' },
    { contentType: "application/problem+json", body: '{"title":"Example"}' },
    { contentType: "application/xml", body: "<message>hello</message>" },
    { contentType: "application/rss+xml", body: "<rss>hello</rss>" },
    {
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    },
  ])("saves UTF-8 text with $contentType", async ({ contentType, body }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { headers: { "content-type": contentType } }),
    );
    await runSavedWebRequest({
      url: "https://example.com/data",
      saveToFile: "scratch/data.txt",
    });
    expect(mockWriteWorkspaceFile).toHaveBeenCalledWith(
      expect.anything(),
      "scratch/data.txt",
      body,
      contentType,
      expect.anything(),
    );
  });

  it("returns Excel-labeled UTF-8 CSV inline", async () => {
    const body = "name,value\r\n東京,42\r\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "Application/Vnd.Ms-Excel; charset=utf-8" },
      }),
    );

    await expect(
      runWebRequest("https://example.com/data.csv"),
    ).resolves.toContain(body);
  });

  it("reports redirects without processing or saving their binary body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([80, 75, 0, 255]), {
        status: 302,
        headers: { location: "https://example.com/elsewhere" },
      }),
    );
    await expect(
      runSavedWebRequest({
        url: "https://example.com/archive",
        saveToFile: "scratch/archive.zip",
      }),
    ).rejects.toMatchObject({
      errorCode: "http_302",
      message: expect.stringContaining(
        "Redirect: https://example.com/elsewhere",
      ),
    });
    expect(mockWriteWorkspaceFile).not.toHaveBeenCalled();
  });

  it.each([
    "Invalid path: synthetic-save-body-marker",
    "Only organization owners and admins can edit organization files: synthetic-save-body-marker",
    "File exceeds the limit: synthetic-save-body-marker",
    "database rejected synthetic-save-body-marker and synthetic-credential",
  ])(
    "does not expose writer exception details in save errors",
    async (message) => {
      const body = "synthetic-save-body-marker";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { headers: { "content-type": "text/plain" } }),
      );
      mockWriteWorkspaceFile.mockRejectedValue(new Error(message));

      let caught: unknown;
      try {
        await runSavedWebRequest({
          url: "https://example.com/data",
          saveToFile: "scratch/data.txt",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        errorCode: "web_request_save_failed",
        message: "saveToFile error: could not write workspace file.",
      });
      expect(String((caught as Error).message)).not.toContain(body);
      expect(String((caught as Error).message)).not.toContain(
        "synthetic-credential",
      );
    },
  );

  it("fails oversized response bodies before processing or saving them", async () => {
    const responseBytes = 20 * 1024 * 1024 + 1;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html><html><body>${"x".repeat(responseBytes)}</body></html>`,
        {
          status: 200,
          statusText: "OK",
          headers: {
            "content-type": "text/html",
          },
        },
      ),
    );

    await expect(
      runSavedWebRequest({
        url: "https://93.184.216.34/page",
        saveToFile: "exports/page.html",
      }),
    ).rejects.toMatchObject({
      errorCode: "web_request_response_too_large",
      message: expect.stringContaining("maximum 20971520 bytes"),
    });
    expect(mockWriteWorkspaceFile).not.toHaveBeenCalled();
  });

  it("extracts HTML over 1 MiB before applying maxChars", async () => {
    const html = `<!doctype html><html><head><title>United States</title><style>/*${"s".repeat(250_000)}*/</style></head><body><script>/*${"x".repeat(2_500_000)}*/</script><main><article><h1>United States</h1><p>The article body is available for research.</p></article></main></body></html>`;
    expect(Buffer.byteLength(html)).toBeGreaterThan(1024 * 1024);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await runWebRequest("https://example.com/page");

    expect(result).toContain("# United States");
    expect(result).toContain("The article body is available for research.");
    expect(result).not.toContain("x".repeat(100));
  });

  it("saves extracted HTML as Markdown without adding links by default", async () => {
    const html = `<!doctype html><html><head><title>United States</title><style>/*${"s".repeat(50_000)}*/</style></head><body><script>/*${"x".repeat(1_500_000)}*/</script><main><article><h1>United States</h1><p>Article content.</p><a href="/related">Related article</a></article></main></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = JSON.parse(
      String(
        await runSavedWebRequest({
          url: "https://example.com/page",
          saveToFile: "scratch/page.md",
        }),
      ),
    );
    const savedContent = String(mockWriteWorkspaceFile.mock.calls[0]?.[2]);

    expect(result).toMatchObject({
      savedToFile: true,
      savedFormat: "markdown",
    });
    expect(mockWriteWorkspaceFile.mock.calls[0]?.[3]).toBe("text/markdown");
    expect(savedContent).toContain("# United States");
    expect(savedContent).toContain("Article content.");
    expect(savedContent).not.toContain("script");
    expect(savedContent).not.toContain("\nLinks:\n");
    expect(savedContent.length).toBe(result.chars);
  });

  it("preserves the raw HTML body when saving with responseMode raw", async () => {
    const html =
      "<!doctype html><html><body><script>keep this</script></body></html>";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = JSON.parse(
      String(
        await runSavedWebRequest({
          url: "https://example.com/page",
          responseMode: "raw",
          saveToFile: "scratch/page.html",
        }),
      ),
    );

    expect(result.savedFormat).toBe("raw");
    expect(mockWriteWorkspaceFile.mock.calls[0]?.[2]).toBe(html);
    expect(mockWriteWorkspaceFile.mock.calls[0]?.[3]).toBe("text/html");
  });

  it("includes the extracted links list when explicitly requested for a save", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<!doctype html><html><head><title>Research</title></head><body><main><article><p>Article content.</p><a href="/related">Related article</a></article></main></body></html>',
        { headers: { "content-type": "text/html" } },
      ),
    );

    await runSavedWebRequest({
      url: "https://example.com/research",
      saveToFile: "scratch/research.md",
      includeLinks: true,
    });
    const savedContent = String(mockWriteWorkspaceFile.mock.calls[0]?.[2]);

    expect(savedContent).toContain("\nLinks:\n");
    expect(savedContent).toContain("https://example.com/related");
  });

  it("saves extracted HTML as plain text when responseMode is text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        "<!doctype html><html><head><title>Research</title></head><body><main><article><p>Article content.</p></article></main></body></html>",
        { headers: { "content-type": "text/html" } },
      ),
    );

    const result = JSON.parse(
      String(
        await runSavedWebRequest({
          url: "https://example.com/research",
          responseMode: "text",
          saveToFile: "scratch/research.txt",
        }),
      ),
    );
    const savedContent = String(mockWriteWorkspaceFile.mock.calls[0]?.[2]);

    expect(result.savedFormat).toBe("text");
    expect(mockWriteWorkspaceFile.mock.calls[0]?.[3]).toBe("text/plain");
    expect(savedContent).toContain("Article content.");
    expect(savedContent).not.toContain("<article>");
  });

  it("saves the full extracted HTML content beyond the inline processing cap", async () => {
    const articleText = "Research evidence. ".repeat(15_000);
    const html = `<!doctype html><html><body><main><article><h1>Research</h1><p>${articleText}</p></article></main></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = JSON.parse(
      String(
        await runSavedWebRequest({
          url: "https://example.com/research",
          saveToFile: "scratch/research.md",
        }),
      ),
    );
    const savedContent = String(mockWriteWorkspaceFile.mock.calls[0]?.[2]);

    expect(result.savedFormat).toBe("markdown");
    expect(savedContent.length).toBeGreaterThan(200_000);
    expect(savedContent).toContain("Research evidence.");
  });

  it("returns complete search matches instead of the short save preview", async () => {
    const repeatedMatch =
      "Population estimate: The United States population figure was 331000000 in this report. ";
    const html = `<!doctype html><html><body><main><article><h1>Population</h1><p>${repeatedMatch.repeat(100)}</p></article></main></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = JSON.parse(
      String(
        await runSavedWebRequest({
          url: "https://example.com/population",
          search: { query: "Population estimate" },
          maxChars: 4_000,
          saveToFile: "scratch/population.md",
        }),
      ),
    );

    expect(result.searchResults.length).toBeGreaterThan(2_000);
    expect(result.searchResults.length).toBeLessThanOrEqual(4_000);
    expect(result.searchResultsTruncated).toBe(true);
    expect(result.searchResults).toContain("Population estimate");
  });

  it("reports when a saved search scans only the first 500k source characters", async () => {
    const lateMatch = "late-search-match";
    const html = `<!doctype html><html><body><main><article><h1>Research</h1><p>${"x".repeat(510_000)} ${lateMatch}</p></article></main></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = JSON.parse(
      String(
        await runSavedWebRequest({
          url: "https://example.com/research",
          extract: "all-visible",
          search: { query: lateMatch },
          maxChars: 200_000,
          saveToFile: "scratch/research.md",
        }),
      ),
    );
    const savedContent = String(mockWriteWorkspaceFile.mock.calls[0]?.[2]);

    expect(savedContent).toContain(lateMatch);
    expect(result.searchResults).not.toContain(lateMatch);
    expect(result.searchResultsTruncated).toBe(false);
    expect(result.searchSourceTruncated).toBe(true);
  });

  it("bounds failed HTML save error content by maxChars", async () => {
    const html = `<!doctype html><html><head><title>Failed page</title></head><body><main><article><p>${"Failure detail. ".repeat(10_000)}</p></article></main></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "content-type": "text/html" },
      }),
    );

    let caught: unknown;
    try {
      await runSavedWebRequest({
        url: "https://example.com/failed",
        maxChars: 128,
        saveToFile: "scratch/failed.md",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      errorCode: "http_500",
      message: expect.stringContaining("...[truncated]"),
    });
    expect(String((caught as Error).message).length).toBeLessThan(250);
    expect(String((caught as Error).message)).not.toContain(
      "Failure detail. ".repeat(10),
    );
    expect(mockWriteWorkspaceFile).toHaveBeenCalledOnce();
  });

  it("gives an actionable saveToFile hint for oversized inline JSON", async () => {
    const json = JSON.stringify({ payload: "j".repeat(1_500_000) });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(json, { headers: { "content-type": "application/json" } }),
    );

    await expect(
      runWebRequest("https://example.com/data"),
    ).rejects.toMatchObject({
      errorCode: "web_request_response_too_large",
      message: expect.stringContaining("Retry with saveToFile"),
    });
  });

  it("accumulates resolvedKeys across url/headers/body and passes them to validateUrl", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200, statusText: "OK" }),
    );

    const validateUrl = vi.fn().mockResolvedValue(true);
    const entry = createFetchToolEntry({
      resolveKeys: async (text) => {
        if (text.includes("${keys.URL_KEY}")) {
          return {
            resolved: text.replaceAll("${keys.URL_KEY}", "93.184.216.34/api"),
            usedKeys: ["URL_KEY"],
            secretValues: [],
            resolvedKeys: [{ name: "URL_KEY", scope: "org", scopeId: "org_1" }],
          };
        }
        if (text.includes("${keys.HEADER_KEY}")) {
          return {
            resolved: text.replaceAll("${keys.HEADER_KEY}", "secret-header"),
            usedKeys: ["HEADER_KEY"],
            secretValues: ["secret-header"],
            resolvedKeys: [
              { name: "HEADER_KEY", scope: "user", scopeId: "alice" },
            ],
          };
        }
        return { resolved: text, usedKeys: [], secretValues: [] };
      },
      validateUrl,
    })["web-request"];

    await entry.run({
      url: "https://${keys.URL_KEY}",
      headers: '{"X-Token":"${keys.HEADER_KEY}"}',
    });

    expect(validateUrl).toHaveBeenCalledWith(
      "https://93.184.216.34/api",
      ["URL_KEY", "HEADER_KEY"],
      [
        { name: "URL_KEY", scope: "org", scopeId: "org_1" },
        { name: "HEADER_KEY", scope: "user", scopeId: "alice" },
      ],
    );
  });

  it("passes resolvedKeys as undefined when the resolver never reports any", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200, statusText: "OK" }),
    );

    const validateUrl = vi.fn().mockResolvedValue(true);
    const entry = createFetchToolEntry({
      resolveKeys: async (text) => ({
        resolved: text.replaceAll("${keys.API_TOKEN}", "sk-secret"),
        usedKeys: text.includes("${keys.API_TOKEN}") ? ["API_TOKEN"] : [],
        secretValues: text.includes("${keys.API_TOKEN}") ? ["sk-secret"] : [],
        // No `resolvedKeys` field — mirrors resolvers written before this
        // field existed. The fetch tool must stay backwards compatible.
      }),
      validateUrl,
    })["web-request"];

    await entry.run({
      url: "https://93.184.216.34/api?token=${keys.API_TOKEN}",
    });

    expect(validateUrl).toHaveBeenCalledWith(
      "https://93.184.216.34/api?token=sk-secret",
      ["API_TOKEN"],
      undefined,
    );
  });

  it("rejects unsupported HTTP methods before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const entry = createFetchToolEntry()["web-request"];

    await expect(
      entry.run({ url: "https://93.184.216.34/api", method: "TRACE" }),
    ).rejects.toThrow("Unsupported HTTP method");
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

  it("returns the status and text for a plain-text response labeled as HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Access denied", {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      runWebRequest("https://93.184.216.34/blocked"),
    ).rejects.toThrow("HTTP 403 Forbidden\n\nAccess denied");
  });

  it("preserves alternate discovery links outside the readable article", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html>
        <html>
          <head><title>Shared clip</title></head>
          <body>
            <a
              rel="alternate"
              type="application/json"
              href="/api/agent-context.json?id=clip-1"
            >Agent-readable context</a>
            <main><article><h1>Shared clip</h1></article></main>
          </body>
        </html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );

    const result = await runWebRequest("https://93.184.216.34/share/clip-1");

    expect(result).toContain("Links:");
    expect(result).toContain(
      "https://93.184.216.34/api/agent-context.json?id=clip-1",
    );
  });

  it("surfaces shared agent-readable metadata outside the readable article", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<!doctype html>
        <html>
          <head><title>Shared artifact</title></head>
          <body>
            <script type="application/agent-native+json">
              {
                "type": "agent-native.resource.discovery",
                "resourceType": "dashboard",
                "resourceId": "dash-1",
                "contextUrl": "/api/dashboard-agent-context.json?id=dash-1&agent_access=scoped-token",
                "instructions": "Fetch contextUrl for the dashboard data."
              }
            </script>
            <main><article><h1>Shared artifact</h1></article></main>
          </body>
        </html>`,
        {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );

    const result = await runWebRequest("https://93.184.216.34/d/dash-1");

    expect(result).toContain("Agent-readable metadata:");
    expect(result).toContain('"type": "agent-native.resource.discovery"');
    expect(result).toContain(
      '"/api/dashboard-agent-context.json?id=dash-1&agent_access=scoped-token"',
    );
    expect(result).toContain("Fetch contextUrl for the dashboard data.");
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
    const result = entry.run({
      url: "https://93.184.216.34/logs",
      responseMode: "matches",
      search: { regex: "(a+)+$" },
    });

    await expect(result).rejects.toThrow("Unsafe regex rejected");
  });
});

describe("web-request approval", () => {
  const gate = async (args: Record<string, unknown>, ctx: ActionRunContext) => {
    const needsApproval = createFetchToolEntry()["web-request"].needsApproval;
    if (typeof needsApproval !== "function") throw new Error("no gate");
    return needsApproval(args, ctx);
  };
  const chat = { caller: "tool" };
  const automation = {
    caller: "tool",
    automation: { triggerId: "t1", triggerName: "digest" },
  };

  it("does not ask for GET or HEAD", async () => {
    expect(await gate({ url: "https://example.com" }, chat)).toBe(false);
    expect(
      await gate({ url: "https://example.com", method: "GET" }, chat),
    ).toBe(false);
    expect(
      await gate({ url: "https://example.com", method: "head" }, chat),
    ).toBe(false);
  });

  it("asks for other methods in chat", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(await gate({ url: "https://example.com", method }, chat)).toBe(
        true,
      );
    }
  });

  it("does not ask inside an automation run", async () => {
    expect(
      await gate({ url: "https://example.com", method: "POST" }, automation),
    ).toBe(false);
    expect(
      await gate(
        { url: "https://example.com", method: "POST" },
        { caller: "automation" },
      ),
    ).toBe(false);
  });

  it("still allows persistent approval", () => {
    expect(
      createFetchToolEntry()["web-request"].allowPersistentApproval,
    ).toBeUndefined();
  });
});
