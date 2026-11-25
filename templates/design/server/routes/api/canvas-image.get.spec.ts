import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.hoisted(() => vi.fn());
const MockTooLargeError = vi.hoisted(() => class extends Error {});
const sharpControl = vi.hoisted(() => ({ breakResize: false }));

vi.mock("sharp", async () => {
  const actual = await vi.importActual<{
    default: (typeof import("sharp"))["default"];
  }>("sharp");
  const wrapped = ((...args: Parameters<typeof actual.default>) => {
    const instance = actual.default(...args);
    if (sharpControl.breakResize) {
      instance.resize = () => {
        throw new Error("resize exploded");
      };
    }
    return instance;
  }) as typeof actual.default;
  return { default: wrapped };
});

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockFetch(...args),
}));
const mockReadBounded = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query: Record<string, string> }) => event.query,
}));

vi.mock("@agent-native/core/ingestion", () => ({
  RemoteArtifactTooLargeError: MockTooLargeError,
  readBoundedResponseBytes: async (response: Response, maxBytes: number) => {
    const forced = mockReadBounded();
    if (forced) return forced;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("too large");
    return bytes;
  },
}));

import { mintCanvasImageToken } from "../../lib/canvas-image-token.js";
import handler from "./canvas-image.get.js";

const run = handler as unknown as (event: {
  query: Record<string, string>;
}) => Promise<Response>;

function tokenQuery(nowMs = Date.now()): Record<string, string> {
  const minted = mintCanvasImageToken("viewer@example.test", nowMs);
  if (minted === null) throw new Error("expected a minted token");
  return { u: minted.subject, exp: String(minted.exp), t: minted.token };
}

function call(query: Record<string, string>) {
  return run({ query: { ...tokenQuery(), ...query } });
}

function callRaw(query: Record<string, string>) {
  return run({ query });
}

const CDN_VARY = "query=src|w";

function imageResponse(body: Buffer, type = "image/jpeg") {
  return new Response(new Blob([new Uint8Array(body)]), {
    headers: { "content-type": type },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockReadBounded.mockReset();
  sharpControl.breakResize = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("canvas-image route", () => {
  it("rejects missing, non-http and credentialed src with 400", async () => {
    for (const src of [
      undefined,
      "",
      "/relative.png",
      "ftp://a.test/x.png",
      "data:image/png;base64,AA",
      "https://user:pw@a.test/x.png",
    ]) {
      const res = await call(src === undefined ? {} : { src });
      expect(res.status).toBe(400);
    }
    expect((await call({ src: "https://a.test/x.png", w: "abc" })).status).toBe(
      400,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("answers 403 and never redirects when the address is blocked", async () => {
    mockFetch.mockRejectedValue(
      new Error("SSRF blocked: refusing to fetch private/internal address"),
    );
    const res = await call({ src: "http://169.254.169.254/latest" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("answers 403 when the connect-time DNS check blocks the host", async () => {
    const blocked = Object.assign(
      new Error("Connect blocked: a.test resolved to private address 10.0.0.1"),
      { code: "EAI_BLOCKED" },
    );
    mockFetch.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: blocked }),
    );
    const res = await call({ src: "https://a.test/rebinds.jpg" });
    expect(res.status).toBe(403);
  });

  it("resizes oversized images to the bucket and honors EXIF rotation", async () => {
    const big = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: "#c00" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    mockFetch.mockResolvedValue(imageResponse(big));
    const res = await call({ src: "https://a.test/big.jpg", w: "2048" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    expect(res.headers.get("Netlify-CDN-Cache-Control")).toBe(
      "public, durable, max-age=86400, stale-while-revalidate=604800",
    );
    expect(res.headers.get("Netlify-Vary")).toBe(CDN_VARY);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    const out = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(out.height).toBe(2048);
    expect(out.width).toBeLessThan(2048);
    expect(Math.round((out.width / out.height) * 3000)).toBe(1000);
  });

  it("uses smaller buckets and never enlarges", async () => {
    const png = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    mockFetch.mockResolvedValue(imageResponse(png, "image/png"));
    const res = await call({ src: "https://a.test/a.png", w: "300" });
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const out = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(out.width).toBe(512);
    expect(out.hasAlpha).toBe(true);
  });

  it("keeps the source format when it resizes PNG, WebP and GIF", async () => {
    const base = sharp({
      create: { width: 1600, height: 800, channels: 3, background: "#c00" },
    });
    const sources = {
      png: await base.clone().png().toBuffer(),
      webp: await base.clone().webp().toBuffer(),
      gif: await base.clone().gif().toBuffer(),
    };
    for (const [format, bytes] of Object.entries(sources)) {
      mockFetch.mockResolvedValueOnce(imageResponse(bytes, `image/${format}`));
      const res = await call({ src: `https://a.test/a.${format}`, w: "512" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(`image/${format}`);
      const out = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect(out.format).toBe(format);
      expect(out.width).toBe(512);
    }
  });

  it("returns original bytes for images already within the bucket", async () => {
    const small = await sharp({
      create: { width: 100, height: 80, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    mockFetch.mockResolvedValue(imageResponse(small));
    const res = await call({ src: "https://a.test/s.jpg" });
    expect(Buffer.from(await res.arrayBuffer()).equals(small)).toBe(true);
  });

  it("answers 415 for non-images and svg", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    const res = await call({ src: "https://a.test/page" });
    expect(res.status).toBe(415);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("X-Canvas-Image-Fallback")).toContain(
      "unsupported content type",
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    mockFetch.mockResolvedValueOnce(
      imageResponse(Buffer.from("<svg/>"), "image/svg+xml"),
    );
    const svg = await call({ src: "https://a.test/a" });
    expect(svg.status).toBe(415);
    expect(svg.headers.get("Location")).toBeNull();
  });

  it("rejects query keys other than src, w and the token params", async () => {
    const res = await call({ src: "https://a.test/x.png", cb: "1" });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sniffs images served without a usable content type", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#0a0" },
    })
      .png()
      .toBuffer();
    for (const type of [
      "",
      "application/octet-stream",
      "binary/octet-stream",
    ]) {
      mockFetch.mockResolvedValueOnce(
        new Response(new Blob([new Uint8Array(png)]), {
          headers: type ? { "content-type": type } : {},
        }),
      );
      const res = await call({ src: "https://a.test/untyped" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
    }
    mockFetch.mockResolvedValueOnce(
      imageResponse(
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
        "application/octet-stream",
      ),
    );
    const svg = await call({ src: "https://a.test/untyped-svg" });
    expect(svg.status).toBe(422);
  });

  it("does not echo internal error text in 502 bodies", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5"));
    const res = await call({ src: "https://a.test/b" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
    expect(res.headers.get("X-Canvas-Image-Fallback")).not.toContain(
      "10.0.0.5",
    );
  });

  it("answers 502 for upstream errors and fetch failures", async () => {
    mockFetch.mockResolvedValueOnce(new Response("no", { status: 404 }));
    const res = await call({ src: "https://a.test/b" });
    expect(res.status).toBe(502);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("X-Canvas-Image-Fallback")).toContain(
      "upstream refused",
    );
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const failed = await call({ src: "https://a.test/b" });
    expect(failed.status).toBe(502);
    expect(failed.headers.get("Location")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 413 when the input is over the byte limit", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(new Blob([new Uint8Array(8)]), {
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(50 * 1024 * 1024),
        },
      }),
    );
    mockReadBounded.mockRejectedValueOnce(new MockTooLargeError("too big"));
    const res = await call({ src: "https://a.test/huge.jpg" });
    expect(res.status).toBe(413);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("X-Canvas-Image-Fallback")).toBeTruthy();
  });

  it("answers 422 for bytes sharp cannot read as an image", async () => {
    mockFetch.mockResolvedValueOnce(
      imageResponse(Buffer.from("not an image at all")),
    );
    const res = await call({ src: "https://a.test/c" });
    expect(res.status).toBe(422);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Content-Type")).not.toMatch(/^image\//);
  });

  it("relays verified original bytes under the sniffed type when resizing fails", async () => {
    const big = await sharp({
      create: { width: 3000, height: 100, channels: 3, background: "#c00" },
    })
      .png()
      .toBuffer();
    sharpControl.breakResize = true;
    mockFetch.mockResolvedValueOnce(imageResponse(big, "image/jpeg"));
    const res = await call({ src: "https://a.test/c.jpg" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("X-Canvas-Image-Fallback")).toContain(
      "resize failed",
    );
    expect(Buffer.from(await res.arrayBuffer()).equals(big)).toBe(true);
  });

  describe("token", () => {
    const base = { src: "https://a.test/x.png", w: "512" };

    async function expectForbidden(res: Response) {
      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Netlify-CDN-Cache-Control")).toBe("no-store");
      expect(res.headers.get("Netlify-Vary")).toBe(CDN_VARY);
      expect(mockFetch).not.toHaveBeenCalled();
    }

    it("refuses a missing token before fetching", async () => {
      await expectForbidden(await callRaw(base));
    });

    it("refuses each missing token param", async () => {
      for (const key of ["u", "exp", "t"]) {
        const { [key]: _omitted, ...rest } = tokenQuery();
        await expectForbidden(await callRaw({ ...base, ...rest }));
        mockFetch.mockReset();
      }
    });

    it("refuses a tampered subject, expiry or signature", async () => {
      const good = tokenQuery();
      const { u = "", exp = "0", t = "" } = good;
      const tampered = [
        { ...good, u: `${u}x` },
        { ...good, exp: String(Number(exp) + 1) },
        {
          ...good,
          t: `${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`,
        },
        { ...good, t: "" },
      ];
      for (const extra of tampered) {
        await expectForbidden(await callRaw({ ...base, ...extra }));
        mockFetch.mockReset();
      }
    });

    it("refuses an expired token", async () => {
      const stale = tokenQuery(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await expectForbidden(await callRaw({ ...base, ...stale }));
    });

    it("refuses a non-integer expiry", async () => {
      await expectForbidden(
        await callRaw({ ...base, ...tokenQuery(), exp: "1e10" }),
      );
    });

    it("refuses an expiry more than 48 hours out", async () => {
      const far = tokenQuery(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await expectForbidden(await callRaw({ ...base, ...far }));
    });

    it("sends Netlify-Vary on errors and fallbacks", async () => {
      expect(
        (await call({ src: "ftp://a.test/x" })).headers.get("Netlify-Vary"),
      ).toBe(CDN_VARY);
      mockFetch.mockResolvedValueOnce(new Response("no", { status: 500 }));
      const refused = await call({ src: "https://a.test/y.png" });
      expect(refused.status).toBe(502);
      expect(refused.headers.get("Cache-Control")).toBe("no-store");
      expect(refused.headers.get("Netlify-Vary")).toBe(CDN_VARY);
    });
  });
});
