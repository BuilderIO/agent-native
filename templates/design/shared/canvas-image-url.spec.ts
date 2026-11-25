import { describe, expect, it } from "vitest";

import {
  CANVAS_IMAGE_MAX_EDGE,
  CANVAS_IMAGE_ROUTE,
  fromCanvasImageUrl,
  restoreCanvasImageUrls,
  restoreCanvasImageUrlsInMessage,
  toCanvasImageUrl,
  withCanvasImageSizing,
} from "./canvas-image-url";

const ORIGIN = "https://design.example.com";
const PROXY = {
  origin: ORIGIN,
  route: CANVAS_IMAGE_ROUTE,
  auth: { subject: "subj_-1", exp: 1893456000, token: "tok_-1" },
};
const PHOTO = "https://images.example.com/a/photo.jpg?w=5350&fit=crop";

function proxied(src: string): string {
  return `${ORIGIN}${CANVAS_IMAGE_ROUTE}?src=${encodeURIComponent(src)}&w=${CANVAS_IMAGE_MAX_EDGE}&u=subj_-1&exp=1893456000&t=tok_-1`;
}

describe("canvas image token params", () => {
  it("appends the token and strips it again on every restore path", () => {
    const out = toCanvasImageUrl(PHOTO, PROXY) ?? "";
    expect(out).toContain("&u=subj_-1&exp=1893456000&t=tok_-1");
    expect(fromCanvasImageUrl(out, ORIGIN)).toBe(PHOTO);
    expect(restoreCanvasImageUrls(out, ORIGIN)).toBe(PHOTO);
    const html = `<img src="${PHOTO.replace(/&/g, "&amp;")}">`;
    const rewritten = withCanvasImageSizing(html, PROXY);
    expect(rewritten).toContain("&amp;t=tok_-1");
    expect(restoreCanvasImageUrls(rewritten, ORIGIN)).toBe(html);
    const msg = { a: [`url(${out})`] };
    restoreCanvasImageUrlsInMessage(msg, ORIGIN);
    expect(msg.a[0]).toBe(`url(${PHOTO})`);
  });

  it("still restores URLs saved before tokens existed", () => {
    const legacy = `${ORIGIN}${CANVAS_IMAGE_ROUTE}?src=${encodeURIComponent(PHOTO)}&w=2048`;
    expect(restoreCanvasImageUrls(legacy, ORIGIN)).toBe(PHOTO);
  });
});

describe("canvas image URLs under a base path", () => {
  const mounted = { ...PROXY, route: `/design${CANVAS_IMAGE_ROUTE}` };

  it("builds the proxy URL on the mounted route and restores it", () => {
    const out = toCanvasImageUrl(PHOTO, mounted) ?? "";
    expect(out.startsWith(`${ORIGIN}/design${CANVAS_IMAGE_ROUTE}?src=`)).toBe(
      true,
    );
    expect(fromCanvasImageUrl(out, ORIGIN)).toBe(PHOTO);
    expect(restoreCanvasImageUrls(out, ORIGIN)).toBe(PHOTO);
    const html = `<img src="${PHOTO.replace(/&/g, "&amp;")}"><div style="background:url(/design${CANVAS_IMAGE_ROUTE}?src=${encodeURIComponent(PHOTO)}&w=2048&u=a&exp=1&t=b)"></div>`;
    const restored = restoreCanvasImageUrls(
      withCanvasImageSizing(html, mounted),
      ORIGIN,
    );
    expect(restored).toContain(`url(${PHOTO})`);
    expect(restored).not.toContain(CANVAS_IMAGE_ROUTE);
  });

  it("does not wrap an already proxied mounted URL again", () => {
    const out = toCanvasImageUrl(PHOTO, mounted) ?? "";
    expect(toCanvasImageUrl(out, mounted)).toBeNull();
  });
});

describe("toCanvasImageUrl / fromCanvasImageUrl", () => {
  it("rewrites absolute remote URLs and inverts exactly", () => {
    const out = toCanvasImageUrl(PHOTO, PROXY) ?? "";
    expect(out).toBe(proxied(PHOTO));
    expect(fromCanvasImageUrl(out, ORIGIN)).toBe(PHOTO);
  });

  it("rewrites protocol-relative URLs and inverts verbatim", () => {
    const src = "//cdn.example.com/x.png";
    const out = toCanvasImageUrl(src, PROXY) ?? "";
    expect(out).toBe(proxied(src));
    expect(fromCanvasImageUrl(out, ORIGIN)).toBe(src);
  });

  it("leaves non-remote, same-origin, svg, rewritten and bad URLs alone", () => {
    for (const src of [
      "data:image/png;base64,AAAA",
      "blob:https://x.com/1",
      "/relative/a.png",
      "a.png",
      `${ORIGIN}/uploads/a.png`,
      "https://images.example.com/logo.SVG?v=1",
      proxied(PHOTO),
      "https://",
      "",
      " https://a.com/x.png",
      "http://localhost:5173/hero.jpg",
      "http://app.localhost/a.jpg",
      "http://127.0.0.1/a.jpg",
      "http://10.0.0.8/a.jpg",
      "http://172.20.1.1/a.jpg",
      "http://192.168.1.4/a.jpg",
      "http://169.254.169.254/a.jpg",
      "http://printer.local/a.jpg",
      "https://images.example.test/a.jpg",
      "https://fills.invalid/a.jpg",
      "https://site.example/a.jpg",
      "http://[::1]:8080/a.jpg",
      "http://[fd00::1]/a.jpg",
    ]) {
      expect(toCanvasImageUrl(src, PROXY)).toBeNull();
    }
  });

  it("returns null from fromCanvasImageUrl for other URLs", () => {
    expect(fromCanvasImageUrl(PHOTO)).toBeNull();
    expect(
      fromCanvasImageUrl(`${ORIGIN}${CANVAS_IMAGE_ROUTE}?w=2048`),
    ).toBeNull();
    expect(
      fromCanvasImageUrl(
        `${CANVAS_IMAGE_ROUTE}?src=${encodeURIComponent(PHOTO)}`,
      ),
    ).toBe(PHOTO);
  });

  it("escapes characters that would end an unquoted CSS url()", () => {
    const out = toCanvasImageUrl("https://a.com/x(1)'!*.png", PROXY) ?? "";
    expect(out).not.toMatch(/[()'!*]/);
    expect(fromCanvasImageUrl(out, ORIGIN)).toBe("https://a.com/x(1)'!*.png");
  });
});

describe("withCanvasImageSizing", () => {
  const roundTrip = (html: string) => {
    const rewritten = withCanvasImageSizing(html, PROXY);
    expect(rewritten).not.toBe(html);
    expect(restoreCanvasImageUrls(rewritten, ORIGIN)).toBe(html);
    return rewritten;
  };

  it("rewrites img src in every quoting style", () => {
    for (const html of [
      `<img src="${PHOTO.replace(/&/g, "&amp;")}" alt="x">`,
      `<img alt='x' src='${PHOTO.replace(/&/g, "&amp;")}'>`,
      `<IMG SRC=https://images.example.com/a.jpg>`,
    ]) {
      const out = roundTrip(html);
      expect(out).toContain("/api/canvas-image?src=");
    }
  });

  it("decodes entities before encoding and escapes & when writing back", () => {
    const out = roundTrip(`<img src="https://a.com/p.jpg?x=1&amp;y=2">`);
    expect(out).toContain(
      `src=${encodeURIComponent("https://a.com/p.jpg?x=1&y=2")}&amp;w=2048`,
    );
  });

  it("rewrites public hosts that only look private", () => {
    for (const src of [
      "https://172.15.0.1/a.jpg",
      "https://localhost.example.com/a.jpg",
      "https://11.0.0.1/a.jpg",
    ]) {
      expect(toCanvasImageUrl(src, PROXY)).not.toBeNull();
    }
  });

  it("leaves video and audio source src alone", () => {
    const html = `<video autoplay><source src="https://cdn.example.com/hero.mp4" type="video/mp4"></video><audio><source src="https://cdn.example.com/a.mp3"></audio>`;
    expect(withCanvasImageSizing(html, PROXY)).toBe(html);
  });

  it("rewrites srcset candidates and keeps descriptors", () => {
    const html = `<picture><source srcset="https://a.com/s.jpg 480w, https://a.com/m.jpg 800w,//a.com/l.jpg 2x, /rel.jpg 1x" type="image/jpeg"><img src="/x.png"></picture>`;
    const out = roundTrip(html);
    expect(out.match(/canvas-image\?src=/g)).toHaveLength(3);
    expect(out).toContain(" 480w, ");
    expect(out).toContain(", /rel.jpg 1x");
  });

  it("rewrites url() in style attributes and style blocks, any quoting", () => {
    const html =
      `<style>.a{background:url(https://a.com/1.jpg)} .b{background-image:url('https://a.com/2.jpg?a=1&b=2') , url("https://a.com/3.png")}</style>` +
      `<div style="background: url(https://a.com/4.jpg) center / cover"></div>` +
      `<div style='background-image:url(&quot;https://a.com/5.jpg?q=1&amp;r=2&quot;)'></div>`;
    const out = roundTrip(html);
    expect(out.match(/canvas-image\?src=/g)).toHaveLength(5);
  });

  it("leaves fonts, imports and svg in CSS alone", () => {
    const html = `<style>@import url(https://fonts.com/css?family=A);@font-face{font-family:A;src:url(https://fonts.com/a.woff2)}.x{background:url(https://a.com/a.svg)}</style>`;
    expect(withCanvasImageSizing(html, PROXY)).toBe(html);
  });

  it("does not touch scripts, comments, other tags or data URLs", () => {
    const html =
      `<script>const u = '<img src="https://a.com/x.jpg">'; el.style.background = "url(https://a.com/y.jpg)";</script>` +
      `<!-- <img src="https://a.com/c.jpg"> -->` +
      `<a href="https://a.com/page"><video poster="https://a.com/p.jpg" src="https://a.com/v.mp4"></video></a>` +
      `<img src="data:image/png;base64,AAAA//BB"><div style="background:url(data:image/png;base64,AA//BB)"></div>`;
    expect(withCanvasImageSizing(html, PROXY)).toBe(html);
  });

  it("rewrites images next to a script without touching the script", () => {
    const html = `<img src="https://a.com/x.jpg"><script>var s = '<img src="https://a.com/y.jpg">';</script>`;
    const out = roundTrip(html);
    expect(out).toContain(
      `<script>var s = '<img src="https://a.com/y.jpg">';</script>`,
    );
  });

  it("returns the input unchanged when nothing matches", () => {
    for (const html of [
      "",
      "<p>hello</p>",
      `<img src="/local.png">`,
      `<img src="https://a.com/logo.svg">`,
      `<img src="${ORIGIN}/same.png">`,
    ]) {
      expect(withCanvasImageSizing(html, PROXY)).toBe(html);
    }
    const plain = "<div>no urls</div>";
    expect(restoreCanvasImageUrls(plain)).toBe(plain);
  });

  it("is idempotent", () => {
    const once = withCanvasImageSizing(
      `<img src="${PHOTO.replace(/&/g, "&amp;")}">`,
      PROXY,
    );
    expect(withCanvasImageSizing(once, PROXY)).toBe(once);
  });

  it("restores canvas-image URLs wherever serialized DOM left them", () => {
    const html = `<img src="${proxied(PHOTO).replace(/&/g, "&amp;")}"><div style="background-image: url(${proxied("https://a.com/z.jpg").replace(/&/g, "&amp;")})"></div>`;
    expect(restoreCanvasImageUrls(html, ORIGIN)).toBe(
      `<img src="${PHOTO.replace(/&/g, "&amp;")}"><div style="background-image: url(https://a.com/z.jpg)"></div>`,
    );
  });
});

describe("restore precision", () => {
  const other = `https://other.app${CANVAS_IMAGE_ROUTE}?src=${encodeURIComponent(PHOTO)}&w=300`;

  it("leaves a user-authored link to another origin untouched", () => {
    const html = `<a href="${other.replace(/&/g, "&amp;")}">x</a>`;
    expect(restoreCanvasImageUrls(html, ORIGIN)).toBe(html);
    expect(restoreCanvasImageUrls(html)).toBe(html);
    expect(fromCanvasImageUrl(other, ORIGIN)).toBeNull();
  });

  it("restores relative URLs and the app's own origin only", () => {
    const rel = `${CANVAS_IMAGE_ROUTE}?src=${encodeURIComponent(PHOTO)}&w=2048`;
    expect(restoreCanvasImageUrls(`<img src="${rel}">`)).toBe(
      `<img src="${PHOTO}">`,
    );
    expect(fromCanvasImageUrl(rel)).toBe(PHOTO);
    const own = proxied(PHOTO);
    expect(restoreCanvasImageUrls(own)).toBe(own);
    expect(restoreCanvasImageUrls(own, ORIGIN)).toBe(PHOTO);
  });

  it("returns the same reference when nothing matches", () => {
    const html = `<a href="${other}">x</a><p>plain</p>`;
    expect(restoreCanvasImageUrls(html, ORIGIN)).toBe(html);
  });

  it("normalizes a raw & in an authored attribute to &amp; after a round trip", () => {
    const authored = `<img src="${PHOTO}">`;
    const rewritten = withCanvasImageSizing(
      authored.replace(/&/g, "&amp;"),
      PROXY,
    );
    expect(restoreCanvasImageUrls(rewritten, ORIGIN)).toBe(
      `<img src="${PHOTO.replace(/&/g, "&amp;")}">`,
    );
  });
});

describe("restoreCanvasImageUrlsInMessage", () => {
  it("restores nested string fields in place and leaves the rest", () => {
    const msg = {
      type: "element-info",
      x: 4,
      payload: {
        htmlContent: `<img src="${proxied(PHOTO).replace(/&/g, "&amp;")}">`,
        computed: { backgroundImage: `url("${proxied(PHOTO)}")` },
        list: [`url(${proxied(PHOTO)})`],
        foreign: `https://other.app${CANVAS_IMAGE_ROUTE}?src=a&w=1`,
      },
    };
    restoreCanvasImageUrlsInMessage(msg, ORIGIN);
    expect(msg.payload.htmlContent).toBe(
      `<img src="${PHOTO.replace(/&/g, "&amp;")}">`,
    );
    expect(msg.payload.computed.backgroundImage).toBe(`url("${PHOTO}")`);
    expect(msg.payload.list[0]).toBe(`url(${PHOTO})`);
    expect(msg.payload.foreign).toBe(
      `https://other.app${CANVAS_IMAGE_ROUTE}?src=a&w=1`,
    );
    expect(msg.x).toBe(4);
  });

  it("does not walk typed arrays or buffers", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const msg = { bytes, buffer: new ArrayBuffer(4) };
    restoreCanvasImageUrlsInMessage(msg, ORIGIN);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("restores strings inside arrays", () => {
    const msg = { list: [1, null, `url(${proxied(PHOTO)})`] };
    restoreCanvasImageUrlsInMessage(msg, ORIGIN);
    expect(msg.list[2]).toBe(`url(${PHOTO})`);
  });

  it("restores every string however deep or wide the message is", () => {
    let deep: Record<string, unknown> = { s: proxied(PHOTO) };
    const innermost = deep;
    for (let i = 0; i < 200; i++) deep = { next: deep };
    restoreCanvasImageUrlsInMessage(deep, ORIGIN);
    expect(innermost.s).toBe(PHOTO);
    const wide = {
      items: Array.from({ length: 20_000 }, () => proxied(PHOTO)),
    };
    restoreCanvasImageUrlsInMessage(wide, ORIGIN);
    expect(wide.items.every((item) => item === PHOTO)).toBe(true);
  });

  it("terminates on cyclic messages", () => {
    const msg: Record<string, unknown> = { s: proxied(PHOTO) };
    msg.self = msg;
    restoreCanvasImageUrlsInMessage(msg, ORIGIN);
    expect(msg.s).toBe(PHOTO);
  });

  it("ignores primitives and null", () => {
    expect(() => restoreCanvasImageUrlsInMessage(null, ORIGIN)).not.toThrow();
    expect(() => restoreCanvasImageUrlsInMessage("x", ORIGIN)).not.toThrow();
  });
});
