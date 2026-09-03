import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pull in the module fresh inside the token-exchange describe block so the
// module-level token cache does not leak across tests. The pure helpers
// (extractFileId, getServiceAccountKey, request builders) are stateless and
// can use a single static import.
import {
  extractFileId,
  getServiceAccountKey,
  getServiceAccountEmail,
  listDocComments,
  replyToComment,
  getStartPageToken,
  listChanges,
  googleDocsAdapter,
} from "./google-docs.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
});

describe("extractFileId", () => {
  it("extracts the file id from a /d/<id> document URL", () => {
    expect(
      extractFileId(
        "https://docs.google.com/document/d/1AbC_def-123/edit?usp=sharing",
      ),
    ).toBe("1AbC_def-123");
  });

  it("returns the input unchanged when it is already a bare id", () => {
    expect(extractFileId("1AbC_def-123")).toBe("1AbC_def-123");
  });

  it("returns the input when no /d/ segment is present", () => {
    expect(extractFileId("https://example.com/foo")).toBe(
      "https://example.com/foo",
    );
  });
});

describe("getServiceAccountKey / getServiceAccountEmail", () => {
  it("returns null when the env var is unset", () => {
    expect(getServiceAccountKey()).toBeNull();
    expect(getServiceAccountEmail()).toBeNull();
  });

  it("parses an inline JSON key", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "svc@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
    });

    const key = getServiceAccountKey();
    expect(key?.client_email).toBe("svc@project.iam.gserviceaccount.com");
    expect(getServiceAccountEmail()).toBe(
      "svc@project.iam.gserviceaccount.com",
    );
  });

  it("falls back to reading a file path when the value is not JSON", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const file = path.join(
      os.tmpdir(),
      `gdocs-key-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ client_email: "file@svc.test", private_key: "k" }),
    );
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = file;

    try {
      expect(getServiceAccountKey()?.client_email).toBe("file@svc.test");
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("returns null when the value is neither valid JSON nor a readable file", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "/no/such/path/at/all.json";
    expect(getServiceAccountKey()).toBeNull();
  });
});

describe("listDocComments", () => {
  it("requests the comments endpoint with the auth header and returns the array", async () => {
    let captured: { url: string; headers: any } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        captured = { url, headers: init?.headers };
        return Promise.resolve(
          new Response(JSON.stringify({ comments: [{ id: "c1" }] }), {
            status: 200,
          }),
        );
      }),
    );

    const comments = await listDocComments("FILE1", "tok-abc");

    expect(comments).toEqual([{ id: "c1" }]);
    expect(captured?.url).toContain("/files/FILE1/comments?");
    expect(captured?.url).toContain("pageSize=100");
    expect((captured?.headers as any).Authorization).toBe("Bearer tok-abc");
    // No startModifiedTime filter unless provided.
    expect(captured?.url).not.toContain("startModifiedTime");
  });

  it("includes startModifiedTime when provided", async () => {
    let url = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((u: string) => {
        url = u;
        return Promise.resolve(
          new Response(JSON.stringify({ comments: [] }), { status: 200 }),
        );
      }),
    );

    await listDocComments("FILE1", "tok", "2026-01-01T00:00:00Z");
    expect(url).toContain("startModifiedTime=");
  });

  it("defaults to an empty array when the response has no comments field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );
    await expect(listDocComments("F", "tok")).resolves.toEqual([]);
  });

  it("throws with the error body when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("permission denied", { status: 403 })),
      ),
    );
    await expect(listDocComments("F", "tok")).rejects.toThrow(
      /Failed to list comments: permission denied/,
    );
  });
});

describe("replyToComment", () => {
  it("POSTs the content to the comment replies endpoint", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        captured = { url, init };
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );

    await replyToComment("FILE1", "CMT1", "On it!", "tok");

    expect(captured?.url).toContain("/files/FILE1/comments/CMT1/replies");
    expect(captured?.init?.method).toBe("POST");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      content: "On it!",
    });
    expect((captured?.init?.headers as any).Authorization).toBe("Bearer tok");
  });

  it("throws when the reply request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );
    await expect(replyToComment("F", "C", "x", "tok")).rejects.toThrow(
      /Failed to reply to comment: nope/,
    );
  });
});

describe("getStartPageToken", () => {
  it("returns the start page token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ startPageToken: "tok-42" }), {
            status: 200,
          }),
        ),
      ),
    );
    await expect(getStartPageToken("auth")).resolves.toBe("tok-42");
  });

  it("throws on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 401 }))),
    );
    await expect(getStartPageToken("auth")).rejects.toThrow(
      "Failed to get start page token",
    );
  });
});

describe("listChanges", () => {
  it("returns changes and prefers nextPageToken from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              changes: [{ fileId: "f1", removed: false }],
              nextPageToken: "next-1",
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    const result = await listChanges("page-0", "tok");
    expect(result.changes).toEqual([{ fileId: "f1", removed: false }]);
    expect(result.nextPageToken).toBe("next-1");
  });

  it("falls back to newStartPageToken, then the input token, when nextPageToken is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ newStartPageToken: "fresh-start" }), {
            status: 200,
          }),
        ),
      ),
    );
    const withNewStart = await listChanges("page-0", "tok");
    expect(withNewStart.changes).toEqual([]);
    expect(withNewStart.nextPageToken).toBe("fresh-start");

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      ),
    );
    const noTokens = await listChanges("page-input", "tok");
    expect(noTokens.nextPageToken).toBe("page-input");
  });

  it("throws with the error body on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("boom", { status: 500 }))),
    );
    await expect(listChanges("p", "tok")).rejects.toThrow(
      /Failed to list changes: boom/,
    );
  });
});

describe("getServiceAccountAccessToken (with module-level cache)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  });

  it("returns null when no service account key is configured", async () => {
    const mod = await import("./google-docs.js");
    await expect(mod.getServiceAccountAccessToken()).resolves.toBeNull();
  });

  it("signs a JWT, exchanges it for a token, and caches the result", async () => {
    // Generate a real RSA key so node:crypto can actually sign the JWT.
    const crypto = await import("node:crypto");
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "svc@project.iam.gserviceaccount.com",
      private_key: privateKey,
    });

    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "ya29.token", expires_in: 3600 }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const mod = await import("./google-docs.js");
    const first = await mod.getServiceAccountAccessToken();
    expect(first).toBe("ya29.token");

    // The token-exchange POST carries a JWT assertion built from the key.
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const params = String(init.body);
    expect(params).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
    );
    expect(params).toContain("assertion=");

    // Second call within the validity window is served from cache — no
    // additional token exchange.
    const second = await mod.getServiceAccountAccessToken();
    expect(second).toBe("ya29.token");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not cache when the token exchange fails", async () => {
    const crypto = await import("node:crypto");
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "svc@project.iam.gserviceaccount.com",
      private_key: privateKey,
    });

    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response("invalid_grant", { status: 400 })),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const mod = await import("./google-docs.js");
    await expect(mod.getServiceAccountAccessToken()).resolves.toBeNull();
    // A retry still hits the network (nothing cached on failure).
    await mod.getServiceAccountAccessToken();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("googleDocsAdapter", () => {
  it("is poll-driven: parseIncomingMessage and handleVerification short-circuit", async () => {
    const adapter = googleDocsAdapter();
    await expect(adapter.parseIncomingMessage({} as any)).resolves.toBeNull();
    await expect(adapter.handleVerification({} as any)).resolves.toEqual({
      handled: false,
    });
    // verifyWebhook trusts the poller (no inbound webhook to verify).
    await expect(adapter.verifyWebhook({} as any)).resolves.toBe(true);
  });

  it("formatAgentResponse passes text through as plain text", () => {
    const out = googleDocsAdapter().formatAgentResponse("**hi**");
    expect(out.text).toBe("**hi**");
    expect(out.platformContext).toEqual({});
  });

  it("reports configured status from the service account key", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const unconfigured = await googleDocsAdapter().getStatus();
    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.error).toMatch(/GOOGLE_SERVICE_ACCOUNT_KEY/);

    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "svc@x.test",
      private_key: "k",
    });
    const configured = await googleDocsAdapter().getStatus();
    expect(configured.configured).toBe(true);
    expect(configured.error).toBeUndefined();
    expect(configured.details?.serviceAccountEmail).toBe("svc@x.test");
  });

  it("sendResponse replies to the doc comment using a resolved access token", async () => {
    // Use a real key so getServiceAccountAccessToken can mint a token via the
    // mocked token endpoint, then assert the reply hits the comments endpoint.
    vi.resetModules();
    const crypto = await import("node:crypto");
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "svc@x.test",
      private_key: privateKey,
    });

    const replyUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "ya29.x", expires_in: 3600 }),
              { status: 200 },
            ),
          );
        }
        replyUrls.push(String(url));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );

    const mod = await import("./google-docs.js");
    await mod.googleDocsAdapter().sendResponse(
      { text: "reply body", platformContext: {} },
      {
        platform: "google-docs",
        externalThreadId: "FILE9:CMT9",
        text: "@agent help",
        timestamp: 1,
        platformContext: { fileId: "FILE9", commentId: "CMT9" },
      },
    );

    expect(replyUrls).toHaveLength(1);
    expect(replyUrls[0]).toContain("/files/FILE9/comments/CMT9/replies");
  });

  it("sendResponse does nothing when no access token can be resolved", async () => {
    vi.resetModules();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const mod = await import("./google-docs.js");
    await mod.googleDocsAdapter().sendResponse(
      { text: "reply", platformContext: {} },
      {
        platform: "google-docs",
        externalThreadId: "F:C",
        text: "x",
        timestamp: 1,
        platformContext: { fileId: "F", commentId: "C" },
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
