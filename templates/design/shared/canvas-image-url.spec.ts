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
      `<style>.a{background:url(https://a.com/1.jpg);background-size:cover} .b{background-image:url('https://a.com/2.jpg?a=1&b=2') , url("https://a.com/3.png");background-size:contain}</style>` +
      `<div style="background: url(https://a.com/4.jpg) center / cover"></div>` +
      `<div style='background-image:url(&quot;https://a.com/5.jpg?q=1&amp;r=2&quot;);background-size:cover'></div>`;
    const out = roundTrip(html);
    expect(out.match(/canvas-image\?src=/g)).toHaveLength(5);
  });

  it("rewrites a background only when its size ignores the image's own size", () => {
    const count = (html: string) =>
      withCanvasImageSizing(html, PROXY).match(/canvas-image\?src=/g)?.length ??
      0;
    const style = (css: string) => `<div style="${css}"></div>`;
    const img = "background-image:url(https://a.com/1.jpg)";
    for (const size of [
      "cover",
      "contain",
      "COVER",
      "100px 50px",
      "50% 50%",
      "0 0",
      "cover !important",
    ]) {
      expect(count(style(`${img};background-size:${size}`))).toBe(1);
      expect(count(style(`background-size:${size};${img}`))).toBe(1);
    }
    for (const size of [
      "auto",
      "auto auto",
      "200px",
      "100% auto",
      "auto 50%",
      "var(--s)",
      "calc(100% - 4px) 10px",
      "",
    ]) {
      expect(count(style(`${img};background-size:${size}`))).toBe(0);
    }
    expect(count(style(img))).toBe(0);
    expect(count(style("background-size:cover"))).toBe(0);
  });

  it("reads the size from the background shorthand", () => {
    const count = (css: string) =>
      withCanvasImageSizing(`<div style="${css}"></div>`, PROXY).match(
        /canvas-image\?src=/g,
      )?.length ?? 0;
    expect(count("background:url(https://a.com/1.jpg) center / cover")).toBe(1);
    expect(
      count("background:url(https://a.com/1.jpg) center/contain no-repeat"),
    ).toBe(1);
    expect(count("background:url(https://a.com/1.jpg) 0 0 / 40px 20px")).toBe(
      1,
    );
    expect(count("background:url(https://a.com/1.jpg) center / 40px")).toBe(0);
    expect(count("background:url(https://a.com/1.jpg) center / auto 50%")).toBe(
      0,
    );
    expect(count("background:url(https://a.com/1.jpg) center no-repeat")).toBe(
      0,
    );
    expect(
      count("background:rgb(0 0 0 / 50%) url(https://a.com/1.jpg) center"),
    ).toBe(0);
  });

  it("lets the last size declaration in the block win", () => {
    const count = (css: string) =>
      withCanvasImageSizing(`<div style="${css}"></div>`, PROXY).match(
        /canvas-image\?src=/g,
      )?.length ?? 0;
    const img = "background-image:url(https://a.com/1.jpg)";
    expect(count(`background-size:cover;${img};background-size:auto`)).toBe(0);
    expect(count(`background-size:auto;${img};background-size:cover`)).toBe(1);
    expect(
      count("background-size:cover;background:url(https://a.com/1.jpg)"),
    ).toBe(0);
    expect(
      count("background:url(https://a.com/1.jpg);background-size:cover"),
    ).toBe(1);
    expect(
      count(`background-size:cover !important;${img};background-size:auto`),
    ).toBe(1);
  });

  it("matches sizes to background layers one by one", () => {
    const out = withCanvasImageSizing(
      `<div style="background-image:url(https://a.com/1.jpg),url(https://a.com/2.jpg),url(https://a.com/3.jpg);background-size:cover,auto,10px 10px"></div>`,
      PROXY,
    );
    expect(out).toContain("url(https://a.com/2.jpg)");
    expect(out).not.toContain("url(https://a.com/1.jpg)");
    expect(out).not.toContain("url(https://a.com/3.jpg)");
    expect(out.match(/canvas-image\?src=/g)).toHaveLength(2);
    const cycled = withCanvasImageSizing(
      `<div style="background-image:url(https://a.com/1.jpg),url(https://a.com/2.jpg);background-size:cover"></div>`,
      PROXY,
    );
    expect(cycled.match(/canvas-image\?src=/g)).toHaveLength(2);
    const shorthand = withCanvasImageSizing(
      `<div style="background:url(https://a.com/1.jpg) center / cover, url(https://a.com/2.jpg) center"></div>`,
      PROXY,
    );
    expect(shorthand).toContain("url(https://a.com/2.jpg)");
    expect(shorthand.match(/canvas-image\?src=/g)).toHaveLength(1);
  });

  it("only reads sizes from the same rule in style blocks", () => {
    const out = withCanvasImageSizing(
      `<style>.a{background-image:url(https://a.com/1.jpg)} .b{background-size:cover} .c{background-image:url(https://a.com/2.jpg);background-size:cover} @media (min-width:1px){.d{background:url(https://a.com/3.jpg) center / cover}}</style>`,
      PROXY,
    );
    expect(out).toContain("url(https://a.com/1.jpg)");
    expect(out.match(/canvas-image\?src=/g)).toHaveLength(2);
    expect(restoreCanvasImageUrls(out, ORIGIN)).toBe(
      out.replace(/url\(https:\/\/design[^)]*\)/g, (m) => {
        const src = new URL(m.slice(4, -1)).searchParams.get("src");
        return `url(${src})`;
      }),
    );
  });

  it("leaves custom properties alone", () => {
    const html = `<div style="--bg:url(https://a.com/1.jpg);background:var(--bg) center / cover"></div>`;
    expect(withCanvasImageSizing(html, PROXY)).toBe(html);
  });

  it("leaves fonts, imports and svg in CSS alone", () => {
    const html = `<style>@import url(https://fonts.com/css?family=A);@font-face{font-family:A;src:url(https://fonts.com/a.woff2)}.x{background:url(https://a.com/a.svg) center / cover}</style>`;
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

describe("attribute-safe restore", () => {
  it("keeps a single-quoted attribute closed when the URL held an entity quote", () => {
    const html = "<img src='https://x.com/a&#39;b.jpg'>";
    const rewritten = withCanvasImageSizing(html, PROXY);
    expect(rewritten).not.toBe(html);
    const restored = restoreCanvasImageUrls(rewritten, ORIGIN);
    expect(restored).toBe(html);
    expect(restored).not.toContain("a'b");
  });

  it("keeps a double-quoted attribute closed when the URL held &quot;", () => {
    const html = '<img src="https://x.com/a&quot;b.jpg">';
    const rewritten = withCanvasImageSizing(html, PROXY);
    expect(rewritten).not.toBe(html);
    expect(restoreCanvasImageUrls(rewritten, ORIGIN)).toBe(html);
  });

  it("escapes angle brackets and leaves a plain query string unchanged", () => {
    const angle = '<img src="https://x.com/a&lt;b&gt;.jpg">';
    expect(
      restoreCanvasImageUrls(withCanvasImageSizing(angle, PROXY), ORIGIN),
    ).toBe(angle);
    const plain = `<img src="${PHOTO.replace(/&/g, "&amp;")}">`;
    expect(
      restoreCanvasImageUrls(withCanvasImageSizing(plain, PROXY), ORIGIN),
    ).toBe(plain);
  });

  it("round-trips entity quotes inside a style attribute", () => {
    const html = `<div style="background-image:url(&quot;https://x.com/a&#39;b.jpg&quot;);background-size:cover"></div>`;
    const rewritten = withCanvasImageSizing(html, PROXY);
    expect(rewritten).not.toBe(html);
    expect(restoreCanvasImageUrls(rewritten, ORIGIN)).toBe(html);
  });

  it("keeps an encoded space inside an unquoted attribute from starting a new attribute", () => {
    const html =
      "<img src=https://images.example.com/photo.jpg&#32;onerror=alert(1)>";
    const rewritten = withCanvasImageSizing(html, PROXY);
    expect(rewritten).not.toBe(html);
    expect(restoreCanvasImageUrls(rewritten, ORIGIN)).toBe(html);
  });

  it("leaves raw URLs without entities unescaped", () => {
    expect(restoreCanvasImageUrls(proxied(PHOTO), ORIGIN)).toBe(PHOTO);
  });
});
