/**
 * I/O-seam tests for the visual-recap CLI.
 *
 * Strategy: injected fake fetch (using the `fetchFn` DI seam on every function
 * under test) so there are no real HTTP servers, no undici connection-pool
 * handles, and no worker-termination hangs. The `makeResp` helper returns a
 * plain duck-typed Response with `body: null` / `bodyUsed: true` so undici
 * never gets involved at all.
 *
 * Real git repos (via execFileSync) are still used for the collect-diff tests
 * because those exercise git I/O that cannot be faked through a DI seam.
 *
 * DI seams on recap.ts (all preserve existing default behaviour):
 *   - findExistingComment / upsertComment → fetchFn?
 *   - uploadRecapImage → fetchFn?, waitFn?
 *   - waitForPublicRecapImage → fetchFn?
 *   - runShot → importPlaywright?
 *
 * NO vi.mock stubs: recap.spec.ts already imports recap.js without any mocks
 * and runs in ~265ms because vitest's Vite transform cache handles the large
 * dependency files (skills.ts, context-xray-local.ts etc.) efficiently. Adding
 * vi.mock stubs forces vitest into a mock-aware module isolation path that
 * bypasses the transform cache and causes multi-minute compilation. Removing
 * the stubs keeps the fast path and the tests still isolate correctly because
 * all DI seams are exercised via injected fetchFn / waitFn.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findExistingComment,
  runRecap,
  runShot,
  uploadRecapImage,
  upsertComment,
  waitForPublicRecapImage,
} from "./recap.js";

/* -------------------------------------------------------------------------- */
/* Temp dir fixture                                                             */
/* -------------------------------------------------------------------------- */

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-io-spec-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Fake fetch helpers — no undici / no real HTTP handles                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a duck-typed Response-compatible object that holds NO ReadableStream.
 *
 * Node.js 24 native-fetch Response objects (backed by undici) keep an open
 * ReadableStream handle even after .json()/.text() drains the body. In a
 * vitest forks worker those lingering handles prevent clean worker exit and
 * produce the "Timeout terminating forks worker" error. Using a plain object
 * with body:null and bodyUsed:true bypasses that entirely.
 */
function makeResp(body: string, status: number, contentType: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "content-type": contentType }),
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
    body: null,
    bodyUsed: true,
    arrayBuffer: () =>
      Promise.resolve(new TextEncoder().encode(body).buffer as ArrayBuffer),
    blob: () => Promise.resolve(new Blob([body])),
    clone() {
      return makeResp(body, status, contentType);
    },
    formData: () => Promise.reject(new Error("not implemented")),
    url: "",
    redirected: false,
    type: "default" as ResponseType,
  } as unknown as Response;
}

/**
 * Like makeResp but returns a raw binary buffer in arrayBuffer(). Used for
 * image/png responses so waitForPublicRecapImage sees real non-zero byte
 * lengths without going through a real HTTP stack.
 */
function makeBinaryResp(bytes: Uint8Array, contentType: string): Response {
  const buf = bytes.buffer as ArrayBuffer;
  return {
    ok: true,
    status: 200,
    statusText: "",
    headers: new Headers({ "content-type": contentType }),
    json: () => Promise.reject(new Error("not JSON")),
    text: () => Promise.resolve(""),
    body: null,
    bodyUsed: true,
    arrayBuffer: () => Promise.resolve(buf),
    blob: () => Promise.resolve(new Blob([bytes])),
    clone() {
      return makeBinaryResp(bytes, contentType);
    },
    formData: () => Promise.reject(new Error("not implemented")),
    url: "",
    redirected: false,
    type: "default" as ResponseType,
  } as unknown as Response;
}

function jsonResp(data: unknown, status = 200): Response {
  return makeResp(JSON.stringify(data), status, "application/json");
}

function textResp(text: string, status = 200): Response {
  return makeResp(text, status, "text/plain");
}

/** Build a fake `fetch` that dispatches based on URL pattern + method. */
function makeFakeFetch(
  specs: Array<{
    urlPattern: RegExp | string;
    method?: string;
    response: () => Response;
  }>,
): {
  fetchFn: typeof fetch;
  calls: { url: string; method: string; body?: unknown }[];
} {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const body = init?.body ?? undefined;
    calls.push({ url, method, body });
    for (const spec of specs) {
      const urlMatch =
        spec.urlPattern instanceof RegExp
          ? spec.urlPattern.test(url)
          : url.includes(spec.urlPattern);
      const methodMatch = !spec.method || spec.method.toUpperCase() === method;
      if (urlMatch && methodMatch) return spec.response();
    }
    return textResp("not found", 404);
  };
  return { fetchFn, calls };
}

/* ========================================================================== */
/* 1. uploadRecapImage                                                         */
/* ========================================================================== */

describe("uploadRecapImage — success on first try (fake fetch)", () => {
  it("POSTs the PNG bytes and returns the imageUrl after public-readiness check passes", async () => {
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 1]);
    const pngPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(pngPath, fakePng);

    const capturedBodies: unknown[] = [];
    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image",
        method: "POST",
        response: () => {
          capturedBodies.push(calls[calls.length - 1]?.body);
          return jsonResp({
            imageUrl: "https://cdn.example.com/recap/abc.png",
          });
        },
      },
    ]);

    const result = await uploadRecapImage({
      appUrl: "https://plan.example.com",
      token: "tok-test",
      pngPath,
      fetchFn,
      // waitFn always succeeds — tests the upload path only
      waitFn: async () => true,
    });

    expect(result).toBe("https://cdn.example.com/recap/abc.png");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/_agent-native/recap-image");
  });
});

describe("uploadRecapImage — upload failure returns null and logs stderr", () => {
  it("returns null and writes to stderr when the server responds 401", async () => {
    const pngPath = path.join(tmpDir, "bad.png");
    fs.writeFileSync(pngPath, Buffer.from([1, 2, 3]));

    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image",
        method: "POST",
        response: () => textResp("Unauthorized", 401),
      },
    ]);

    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // @ts-expect-error patching for test
    process.stderr.write = (chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    };

    try {
      const result = await uploadRecapImage({
        appUrl: "https://plan.example.com",
        token: "tok-test",
        pngPath,
        fetchFn,
      });
      expect(result).toBeNull();
      expect(stderrLines.join("")).toContain("image upload failed");
      expect(stderrLines.join("")).toContain("401");
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

describe("uploadRecapImage — not-publicly-readable returns null", () => {
  it("returns null and logs the not-publicly-readable note when waitFn returns false", async () => {
    const pngPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(pngPath, Buffer.from([137, 80, 78, 71]));

    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image",
        method: "POST",
        response: () =>
          jsonResp({ imageUrl: "https://cdn.example.com/img/abc.png" }),
      },
    ]);

    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // @ts-expect-error patching for test
    process.stderr.write = (chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    };

    try {
      const result = await uploadRecapImage({
        appUrl: "https://plan.example.com",
        token: "tok-test",
        pngPath,
        fetchFn,
        waitFn: async () => false, // permanent failure — image never becomes public
      });

      expect(result).toBeNull();
      expect(stderrLines.join("")).toContain("not publicly readable");
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

describe("uploadRecapImage — missing imageUrl in response returns null", () => {
  it("returns null and logs when the JSON response has no imageUrl", async () => {
    const pngPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(pngPath, Buffer.from([1, 2, 3, 4]));

    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image",
        method: "POST",
        response: () => jsonResp({ ok: true /* no imageUrl field */ }),
      },
    ]);

    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // @ts-expect-error patching for test
    process.stderr.write = (chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    };

    try {
      const result = await uploadRecapImage({
        appUrl: "https://plan.example.com",
        token: "tok-test",
        pngPath,
        fetchFn,
      });
      expect(result).toBeNull();
      expect(stderrLines.join("")).toContain("no imageUrl");
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

/* ========================================================================== */
/* 2. waitForPublicRecapImage — fake fetch round-trip                          */
/*                                                                             */
/* Uses injected fetchFn so there are no real HTTP servers, no undici handles, */
/* and no keep-alive connections keeping the worker alive.                     */
/* ========================================================================== */

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 1]);

describe("waitForPublicRecapImage — fake fetch", () => {
  it("succeeds when fetchFn returns a real PNG body", async () => {
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image/",
        method: "GET",
        response: () => makeBinaryResp(PNG_MAGIC, "image/png"),
      },
    ]);
    const result = await waitForPublicRecapImage({
      imageUrl: `https://cdn.example.com/_agent-native/recap-image/${"a".repeat(64)}.png`,
      attempts: 1,
      delayMs: 0,
      fetchFn,
    });
    expect(result).toBe(true);
  });

  it("returns false on permanent 404 (all attempts exhausted)", async () => {
    let calls = 0;
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image/",
        method: "GET",
        response: () => {
          calls += 1;
          return textResp("not found", 404);
        },
      },
    ]);
    const result = await waitForPublicRecapImage({
      imageUrl: `https://cdn.example.com/_agent-native/recap-image/${"b".repeat(64)}.png`,
      attempts: 3,
      delayMs: 0,
      fetchFn,
    });
    expect(result).toBe(false);
    expect(calls).toBe(3);
  });

  it("succeeds eventually after N 404s then a real PNG (backoff via attempt count)", async () => {
    let calls = 0;
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image/",
        method: "GET",
        response: () => {
          calls += 1;
          if (calls < 4) return textResp("not yet", 404);
          return makeBinaryResp(PNG_MAGIC, "image/png");
        },
      },
    ]);
    const result = await waitForPublicRecapImage({
      imageUrl: `https://cdn.example.com/_agent-native/recap-image/${"c".repeat(64)}.png`,
      attempts: 10,
      delayMs: 0,
      fetchFn,
    });
    expect(result).toBe(true);
    expect(calls).toBe(4);
  });

  it("rejects a text/html response even with status 200", async () => {
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image/",
        method: "GET",
        response: () => makeResp("<html>nope</html>", 200, "text/html"),
      },
    ]);
    const result = await waitForPublicRecapImage({
      imageUrl: `https://cdn.example.com/_agent-native/recap-image/${"d".repeat(64)}.png`,
      attempts: 2,
      delayMs: 0,
      fetchFn,
    });
    expect(result).toBe(false);
  });

  it("rejects an empty body even with image/png content-type", async () => {
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image/",
        method: "GET",
        response: () => makeBinaryResp(new Uint8Array(0), "image/png"),
      },
    ]);
    const result = await waitForPublicRecapImage({
      imageUrl: `https://cdn.example.com/_agent-native/recap-image/${"e".repeat(64)}.png`,
      attempts: 1,
      delayMs: 0,
      fetchFn,
    });
    expect(result).toBe(false);
  });

  it("body is a real Uint8Array round-trip (guards the h3-v2 bug class)", async () => {
    // The historical h3-v2 bug: a test mocked Buffer where the runtime returns
    // Uint8Array, hiding corruption. Here we use makeBinaryResp so the
    // ArrayBuffer comes from a Uint8Array (not a string encode path), exercising
    // the same byteLength check as the production path.
    const magic = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: "/_agent-native/recap-image/",
        method: "GET",
        response: () => makeBinaryResp(magic, "image/png"),
      },
    ]);
    const result = await waitForPublicRecapImage({
      imageUrl: `https://cdn.example.com/_agent-native/recap-image/${"f".repeat(64)}.png`,
      attempts: 1,
      delayMs: 0,
      fetchFn,
    });
    expect(result).toBe(true);
  });
});

/* ========================================================================== */
/* 3. runShot — playwright not available failure path                          */
/* ========================================================================== */

describe("runShot — playwright not available", () => {
  it("emits {ok:false, reason:'playwright not available…'} and returns without throwing", async () => {
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error patching for test
    process.stdout.write = (chunk: string) => {
      stdoutLines.push(String(chunk));
      return true;
    };

    try {
      await runShot(
        { url: "https://plan.agent-native.com/recaps/abc123" },
        () => Promise.reject(new Error("Cannot find module 'playwright'")),
      );

      const output = stdoutLines.join("");
      const parsed = JSON.parse(output.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.reason).toMatch(/playwright not available/i);
      expect(parsed.reason).toContain("Cannot find module 'playwright'");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("does not call process.exit when playwright is unavailable", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called unexpectedly");
    }) as never);

    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error patching for test
    process.stdout.write = () => true;

    try {
      await runShot(
        { url: "https://plan.agent-native.com/recaps/abc123" },
        () => Promise.reject(new Error("playwright missing")),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      process.stdout.write = origWrite;
      exitSpy.mockRestore();
    }
  });

  it("captures the clean recap screenshot URL at 950px, 100% zoom, and measured height", async () => {
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error patching for test
    process.stdout.write = (chunk: string) => {
      stdoutLines.push(String(chunk));
      return true;
    };

    const shotPath = path.join(tmpDir, "recap.png");
    const contextOptions: unknown[] = [];
    const viewportSizes: unknown[] = [];
    const gotoUrls: string[] = [];
    const evaluateCalls: string[] = [];
    const fakePage = {
      goto: vi.fn(async (nextUrl: string) => {
        gotoUrls.push(nextUrl);
      }),
      waitForSelector: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      evaluate: vi.fn(async (fn: unknown) => {
        evaluateCalls.push(String(fn));
        if (evaluateCalls.length === 2) return 1500;
      }),
      setViewportSize: vi.fn(async (size: unknown) => {
        viewportSizes.push(size);
      }),
      screenshot: vi.fn(async ({ path: outPath }: { path: string }) => {
        fs.writeFileSync(outPath, Buffer.from(PNG_MAGIC));
      }),
    };
    const fakeContext = {
      route: vi.fn(),
      newPage: vi.fn(async () => fakePage),
    };
    const fakeBrowser = {
      newContext: vi.fn(async (options: unknown) => {
        contextOptions.push(options);
        return fakeContext;
      }),
      close: vi.fn(async () => {}),
    };
    const fakeChromium = {
      launch: vi.fn(async () => fakeBrowser),
    };

    try {
      await runShot(
        {
          url: "https://plan.agent-native.com/recaps/abc123?foo=bar#section-a",
          out: shotPath,
        },
        async () => ({ chromium: fakeChromium as never }),
      );

      expect(contextOptions[0]).toMatchObject({
        viewport: { width: 950, height: 2000 },
        deviceScaleFactor: 2,
      });
      expect(viewportSizes[0]).toEqual({ width: 950, height: 1500 });
      expect(gotoUrls[0]).toBe(
        "https://plan.agent-native.com/recaps/abc123?foo=bar&recapScreenshot=1#section-a",
      );
      expect(evaluateCalls.join("\n")).toContain('style.zoom = "100%"');
      expect(evaluateCalls.join("\n")).toContain(".plan-document-shell");
      expect(evaluateCalls.join("\n")).not.toContain("90%");
      expect(JSON.parse(stdoutLines.join("").trim())).toMatchObject({
        ok: true,
        out: shotPath,
      });
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("refuses to attach token when URL origin differs from --app-url, before attempting playwright import", async () => {
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error patching for test
    process.stdout.write = (chunk: string) => {
      stdoutLines.push(String(chunk));
      return true;
    };

    let importCalled = false;
    try {
      await runShot(
        {
          url: "https://evil.example.com/recaps/abc123",
          token: "secret-tok",
          "app-url": "https://plan.agent-native.com",
        },
        async () => {
          importCalled = true;
          throw new Error("should not be reached");
        },
      );

      const output = stdoutLines.join("");
      const parsed = JSON.parse(output.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.reason).toContain("origin does not match");
      expect(importCalled).toBe(false);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

/* ========================================================================== */
/* 4. findExistingComment / upsertComment — fake fetch capturing requests      */
/* ========================================================================== */

const MARKER = "<!-- pr-visual-recap -->";

describe("findExistingComment — pagination", () => {
  it("returns null when page 1 is empty (< 100 items)", async () => {
    // NOTE: use /[&]page=1$/ (not /page=1/) — the URL also contains
    // "per_page=100" which contains the substring "page=1", causing every
    // page request to match the first spec and loop infinitely.
    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: /[&]page=1$/,
        method: "GET",
        response: () => jsonResp([]),
      },
    ]);

    const result = await findExistingComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "42",
      fetchFn,
    });

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("page=1");
  });

  it("paginates across full pages (100 items) and finds the marker on page 2", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: "no marker here",
      user: { type: "Bot" },
    }));
    const page2 = [
      { id: 201, body: `${MARKER}\nsome recap`, user: { type: "Bot" } },
      { id: 202, body: "another comment", user: { type: "User" } },
    ];

    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: /[&]page=1$/,
        method: "GET",
        response: () => jsonResp(page1),
      },
      {
        urlPattern: /[&]page=2$/,
        method: "GET",
        response: () => jsonResp(page2),
      },
    ]);

    const result = await findExistingComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "42",
      fetchFn,
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(201);
    expect(result!.body).toContain(MARKER);
    expect(calls).toHaveLength(2);
  });

  it("stops at the first page when it has fewer than 100 items and no match", async () => {
    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: /[&]page=1$/,
        method: "GET",
        response: () =>
          jsonResp([{ id: 1, body: "normal comment", user: { type: "User" } }]),
      },
    ]);

    const result = await findExistingComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "7",
      fetchFn,
    });

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("skips non-Bot comments that contain the marker", async () => {
    const { fetchFn } = makeFakeFetch([
      {
        urlPattern: /[&]page=1$/,
        method: "GET",
        response: () =>
          jsonResp([
            { id: 10, body: `${MARKER}\nhuman copy`, user: { type: "User" } },
          ]),
      },
    ]);

    const result = await findExistingComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "7",
      fetchFn,
    });

    expect(result).toBeNull();
  });
});

describe("upsertComment — PATCH vs POST decision", () => {
  it("POSTs a new comment when no existing marker comment is found", async () => {
    const { fetchFn, calls } = makeFakeFetch([
      {
        // Use /[&]page=\d+$/ — not /page=1/ — to avoid matching "per_page=100"
        urlPattern: /[&]page=\d+$/,
        method: "GET",
        response: () => jsonResp([]),
      },
      {
        urlPattern: /\/issues\/42\/comments$/,
        method: "POST",
        response: () =>
          jsonResp(
            {
              id: 999,
              html_url: "https://github.com/o/r/issues/42#issuecomment-999",
            },
            201,
          ),
      },
    ]);

    const result = await upsertComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "42",
      body: "recap body",
      fetchFn,
    });

    expect(result.action).toBe("created");
    expect(result.id).toBe(999);
    const postCall = calls.find((c) => c.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall!.url).toContain("/issues/42/comments");
    // Body must include the MARKER even when the caller's body didn't
    const posted = JSON.parse(
      typeof postCall!.body === "string" ? postCall!.body : "{}",
    );
    expect(posted.body).toContain(MARKER);
  });

  it("PATCHes the existing comment when the marker is found on page 1", async () => {
    const existingId = 501;
    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: /[&]page=1$/,
        method: "GET",
        response: () =>
          jsonResp([
            {
              id: existingId,
              body: `${MARKER}\nold recap body`,
              user: { type: "Bot" },
            },
          ]),
      },
      {
        urlPattern: new RegExp(`/comments/${existingId}$`),
        method: "PATCH",
        response: () =>
          jsonResp({
            id: existingId,
            html_url: `https://github.com/o/r/issues/42#issuecomment-${existingId}`,
          }),
      },
    ]);

    const result = await upsertComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "42",
      body: "updated recap body",
      fetchFn,
    });

    expect(result.action).toBe("updated");
    expect(result.id).toBe(existingId);
    const patchCall = calls.find((c) => c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall!.url).toContain(`/comments/${existingId}`);
    const patched = JSON.parse(
      typeof patchCall!.body === "string" ? patchCall!.body : "{}",
    );
    expect(patched.body).toContain("updated recap body");
    // Must NOT POST a new comment
    expect(calls.find((c) => c.method === "POST")).toBeUndefined();
  });

  it("returns {action:'skipped'} when updateOnly=true and no existing comment", async () => {
    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: /[&]page=\d+$/,
        method: "GET",
        response: () => jsonResp([]),
      },
    ]);

    const result = await upsertComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "99",
      body: "tiny diff body",
      updateOnly: true,
      fetchFn,
    });

    expect(result.action).toBe("skipped");
    expect(result.id).toBe(0);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("paginates to find the existing comment before deciding PATCH vs POST", async () => {
    const existingId = 777;
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: "no marker",
      user: { type: "Bot" },
    }));

    const { fetchFn, calls } = makeFakeFetch([
      {
        urlPattern: /[&]page=1$/,
        method: "GET",
        response: () => jsonResp(page1),
      },
      {
        urlPattern: /[&]page=2$/,
        method: "GET",
        response: () =>
          jsonResp([
            {
              id: existingId,
              body: `${MARKER}\nold recap`,
              user: { type: "Bot" },
            },
          ]),
      },
      {
        urlPattern: new RegExp(`/comments/${existingId}$`),
        method: "PATCH",
        response: () =>
          jsonResp({
            id: existingId,
            html_url: "https://github.com/o/r#c777",
          }),
      },
    ]);

    const result = await upsertComment({
      token: "tok",
      owner: "BuilderIO",
      repo: "ai-services",
      issue: "42",
      body: "new recap",
      fetchFn,
    });

    expect(result.action).toBe("updated");
    expect(result.id).toBe(existingId);
    const getReqs = calls.filter((c) => c.method === "GET");
    expect(getReqs).toHaveLength(2);
  });
});

/* ========================================================================== */
/* 5. runCollectDiff — git failure path                                        */
/* ========================================================================== */

/** Initialize a real git repo with one commit and return the commit SHA. */
function initGitRepo(
  dir: string,
  fileName = "app.ts",
  content = "const a = 1;\n",
): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "--initial-branch=main", dir], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", dir, "config", "user.email", "test@test.com"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"], {
    stdio: "ignore",
  });
  fs.writeFileSync(path.join(dir, fileName), content);
  execFileSync("git", ["-C", dir, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "init"], { stdio: "ignore" });
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

describe("runCollectDiff — git failure path (broken SHA)", () => {
  it("calls process.exit(1) with an actionable stderr message when both SHAs are invalid", async () => {
    const gitDir = path.join(tmpDir, "git-repo");
    initGitRepo(gitDir);

    const stderrLines: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    // @ts-expect-error patching for test
    process.stderr.write = (chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    };

    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    const origCwd = process.cwd();
    try {
      process.chdir(gitDir);
      await expect(
        runRecap([
          "collect-diff",
          "--base",
          "deadbeef000000000000000000000000deadbeef",
          "--head",
          "cafebabe000000000000000000000000cafebabe",
          "--out",
          path.join(tmpDir, "out.diff"),
          "--stat",
          path.join(tmpDir, "out.stat"),
        ]),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      const stderr = stderrLines.join("");
      expect(stderr).toContain("git diff failed");
      // Actionable message must mention shallow clone or fetch-depth
      expect(stderr).toMatch(/shallow|fetch-depth/i);
    } finally {
      process.chdir(origCwd);
      process.stderr.write = origStderr;
      process.exit = origExit;
    }
  });

  it("does NOT classify an empty diff as tiny when git fails — it must be a hard failure", async () => {
    // This guards the original regression: an empty diff from a broken SHA was
    // silently classified as `tiny: true` and the CI recap was skipped with no
    // diagnostic. After the fix, it must exit non-zero instead.
    const gitDir = path.join(tmpDir, "git-fail");
    initGitRepo(gitDir);

    const origStderr = process.stderr.write.bind(process.stderr);
    // @ts-expect-error patching for test
    process.stderr.write = () => true; // suppress noise

    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    const origStdout = process.stdout.write.bind(process.stdout);
    // @ts-expect-error patching for test
    process.stdout.write = () => true; // suppress JSON line

    const origCwd = process.cwd();
    try {
      process.chdir(gitDir);
      await expect(
        runRecap([
          "collect-diff",
          "--base",
          "0000000000000000000000000000000000000000",
          "--head",
          "ffffffffffffffffffffffffffffffffffffffff",
          "--out",
          path.join(tmpDir, "fail.diff"),
          "--stat",
          path.join(tmpDir, "fail.stat"),
        ]),
      ).rejects.toThrow();

      // Exit code must be 1 (failure), NOT 0 (which would mean "tiny" succeeded)
      expect(exitCode).toBe(1);
    } finally {
      process.chdir(origCwd);
      process.stderr.write = origStderr;
      process.stdout.write = origStdout;
      process.exit = origExit;
    }
  });
});

describe("runCollectDiff — success path (real two-commit git repo)", () => {
  it("writes recap.diff + recap.stat, classifies changed/huge/tiny correctly", async () => {
    const gitDir = path.join(tmpDir, "git-success");
    const base = initGitRepo(gitDir, "app.ts", "const a = 1;\n");

    // Second commit (head)
    fs.writeFileSync(
      path.join(gitDir, "app.ts"),
      "const a = 1;\nconst b = 2;\n",
    );
    execFileSync("git", ["-C", gitDir, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", gitDir, "commit", "-m", "add b"], {
      stdio: "ignore",
    });
    const head = execFileSync("git", ["-C", gitDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    const outDiff = path.join(tmpDir, "success.diff");
    const outStat = path.join(tmpDir, "success.stat");

    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error patching for test
    process.stdout.write = (chunk: string) => {
      stdoutLines.push(String(chunk));
      return true;
    };

    const origCwd = process.cwd();
    try {
      process.chdir(gitDir);
      await runRecap([
        "collect-diff",
        "--base",
        base,
        "--head",
        head,
        "--out",
        outDiff,
        "--stat",
        outStat,
      ]);

      // Diff file must contain the real change
      const diff = fs.readFileSync(outDiff, "utf8");
      expect(diff).toContain("+const b = 2;");

      // stat file must exist
      expect(fs.existsSync(outStat)).toBe(true);

      // stdout must carry valid JSON classification
      const json = JSON.parse(stdoutLines.join("").trim());
      expect(json.changed).toBe(1);
      expect(json.huge).toBe(false);
      // 1 file, 1 added line => tiny
      expect(json.tiny).toBe(true);
    } finally {
      process.chdir(origCwd);
      process.stdout.write = origWrite;
    }
  });
});
