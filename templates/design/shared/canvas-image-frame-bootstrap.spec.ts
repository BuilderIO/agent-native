import { describe, expect, it } from "vitest";

import {
  canvasImageFrameBootstrap,
  CANVAS_IMAGE_DENIED_MESSAGE,
  CANVAS_IMAGE_ROUTE,
  fromCanvasImageUrl,
  toCanvasImageUrl,
  withCanvasImageSizing,
} from "./canvas-image-url";

const ORIGIN = "https://design.example.com";
const PROXY = {
  origin: ORIGIN,
  route: CANVAS_IMAGE_ROUTE,
  auth: { subject: "subj_-1", exp: 1893456000, token: "tok_-1" },
};

interface FakeElement {
  nodeType: 1;
  localName: string;
  parentNode: FakeElement | null;
  firstElementChild: null;
  attrs: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelectorAll(selector: string): FakeElement[];
}

function element(
  localName: string,
  attrs: Record<string, string>,
  parentNode: FakeElement | null = null,
  siblings: () => FakeElement[] = () => [],
): FakeElement {
  const map = new Map(Object.entries(attrs));
  return {
    nodeType: 1,
    localName,
    parentNode,
    firstElementChild: null,
    attrs: map,
    getAttribute: (name) => map.get(name) ?? null,
    setAttribute: (name, value) => void map.set(name, value),
    querySelectorAll: () => siblings(),
  };
}

type Record_ = {
  type: "attributes";
  target: FakeElement;
  attributeName?: string | undefined;
};

class FakeImage {
  static created: FakeImage[] = [];
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeImage.created.push(this);
  }
}

function runBootstrap(styled: FakeElement[] = []) {
  FakeImage.created = [];
  const script = canvasImageFrameBootstrap(PROXY);
  const body = script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  let observe: ((records: Record_[]) => void) | undefined;
  let onError: ((event: { target: FakeElement }) => void) | undefined;
  class FakeObserver {
    constructor(callback: (records: Record_[]) => void) {
      observe = callback;
    }
    observe() {}
  }
  const document = {
    documentElement: null,
    querySelectorAll: (selector: string) =>
      selector === "[style]" ? styled : [],
    addEventListener: (
      type: string,
      listener: (event: { target: FakeElement }) => void,
    ) => {
      if (type === "error") onError = listener;
    },
  };
  const posted: Array<{ message: unknown; target: string }> = [];
  const parent = {
    postMessage: (message: unknown, target: string) =>
      posted.push({ message, target }),
  };
  new Function("document", "MutationObserver", "Image", "parent", body)(
    document,
    FakeObserver,
    FakeImage,
    parent,
  );
  return {
    posted,
    mutate(target: FakeElement, attributeName?: string) {
      observe?.([{ type: "attributes", target, attributeName }]);
    },
    fail(target: FakeElement) {
      onError?.({ target });
    },
  };
}

const SOURCES = [
  "https://images.example.com/a/photo.jpg?w=5350&fit=crop",
  "//cdn.example.com/x.png",
  "http://images.example.com/a b/(1)'!*.jpeg",
  "https://images.example.com/漢字.webp?q=é",
  "https://design.example.com/uploads/own.jpg",
  "https://images.example.com/logo.svg",
  `${ORIGIN}${CANVAS_IMAGE_ROUTE}?src=x&w=2048`,
  "/relative/photo.jpg",
  "data:image/png;base64,AAAA",
  " https://images.example.com/padded.jpg",
];

describe("canvasImageFrameBootstrap", () => {
  it("is an inline script that marks itself and holds no closing tag early", () => {
    const script = canvasImageFrameBootstrap(PROXY);
    expect(
      script.startsWith(
        `<script data-agent-native-canvas-image-bootstrap data-origin="${ORIGIN}">`,
      ),
    ).toBe(true);
    expect(script.slice(0, -"</script>".length)).not.toContain("</script");
  });

  it("rewrites a later img src to exactly what toCanvasImageUrl returns", () => {
    const frame = runBootstrap();
    for (const src of SOURCES) {
      const img = element("img", { src });
      frame.mutate(img);
      expect(img.getAttribute("src")).toBe(toCanvasImageUrl(src, PROXY) ?? src);
    }
  });

  it("rewrites srcset like the string rewrite", () => {
    const frame = runBootstrap();
    const srcsets = [
      "https://a.example.com/1.jpg 1x, https://a.example.com/2.jpg?x=1&y=2 2x",
      "https://a.example.com/w.jpg 480w,https://a.example.com/x.jpg 800w",
      "/local.jpg 1x, https://a.example.com/1.jpg 2x",
    ];
    for (const srcset of srcsets) {
      const img = element("img", { srcset });
      frame.mutate(img);
      const escaped = srcset.replace(/&/g, "&amp;");
      const html = withCanvasImageSizing(`<img srcset="${escaped}">`, PROXY);
      const expected = /srcset="([^"]*)"/
        .exec(html)?.[1]
        ?.replace(/&amp;/g, "&");
      expect(img.getAttribute("srcset")).toBe(expected);
    }
  });

  it("ignores other elements and leaves its own output alone", () => {
    const frame = runBootstrap();
    const script = element("script", { src: "https://cdn.example.com/a.js" });
    frame.mutate(script);
    expect(script.getAttribute("src")).toBe("https://cdn.example.com/a.js");
    const img = element("img", { src: "https://images.example.com/a.jpg" });
    frame.mutate(img);
    const once = img.getAttribute("src");
    frame.mutate(img);
    expect(img.getAttribute("src")).toBe(once);
  });

  it("puts the original back when the resized image fails, once", () => {
    const frame = runBootstrap();
    const original = "https://images.example.com/a/photo.jpg?w=5350&fit=crop";
    const img = element("img", { src: original });
    frame.mutate(img);
    expect(fromCanvasImageUrl(img.getAttribute("src") ?? "", ORIGIN)).toBe(
      original,
    );
    frame.fail(img);
    expect(img.getAttribute("src")).toBe(original);
    expect(frame.posted).toEqual([
      { message: { type: CANVAS_IMAGE_DENIED_MESSAGE }, target: ORIGIN },
    ]);
    frame.mutate(img);
    expect(img.getAttribute("src")).toBe(original);
    frame.fail(img);
    expect(img.getAttribute("src")).toBe(original);
  });

  it("rewrites again when the page sets a different src after a failure", () => {
    const frame = runBootstrap();
    const img = element("img", { src: "https://images.example.com/a.jpg" });
    frame.mutate(img);
    frame.fail(img);
    img.setAttribute("src", "https://images.example.com/b.jpg");
    frame.mutate(img);
    expect(img.getAttribute("src")).toBe(
      toCanvasImageUrl("https://images.example.com/b.jpg", PROXY),
    );
  });

  it("restores picture sources together with the failed img", () => {
    const frame = runBootstrap();
    const sourceSrcset = "https://images.example.com/s.jpg 1x";
    const picture = element("picture", {});
    const source = element("source", { srcset: sourceSrcset }, picture);
    const img = element(
      "img",
      { src: "https://images.example.com/i.jpg" },
      picture,
      () => [source],
    );
    picture.querySelectorAll = () => [source];
    frame.mutate(source);
    frame.mutate(img);
    frame.fail(img);
    expect(img.getAttribute("src")).toBe("https://images.example.com/i.jpg");
    expect(source.getAttribute("srcset")).toBe(sourceSrcset);
  });

  it("leaves a video or audio source src alone", () => {
    const frame = runBootstrap();
    const src = "https://cdn.example.com/hero.mp4";
    const source = element("source", { src });
    frame.mutate(source);
    expect(source.getAttribute("src")).toBe(src);
  });

  it("leaves private and loopback hosts alone", () => {
    const frame = runBootstrap();
    for (const src of [
      "http://localhost:5173/hero.jpg",
      "http://127.0.0.1/a.jpg",
      "http://192.168.1.4/a.jpg",
      "http://printer.local/a.jpg",
      "https://images.example.test/a.jpg",
      "https://fills.invalid/a.jpg",
      "https://site.example/a.jpg",
      "http://[::1]:8080/a.jpg",
    ]) {
      const img = element("img", { src });
      frame.mutate(img);
      expect(img.getAttribute("src")).toBe(src);
    }
  });

  it("puts the original CSS url back when the resized background fails", () => {
    const original = "https://images.example.com/bg.jpg?a=1&b=2";
    const style = `background-image:url("${toCanvasImageUrl(original, PROXY)}")`;
    const target = element("div", { style });
    const other = element("section", { style });
    const frame = runBootstrap([target, other]);
    frame.mutate(target, "style");
    frame.mutate(other, "style");
    expect(FakeImage.created).toHaveLength(1);
    FakeImage.created[0]?.onerror?.();
    expect(target.getAttribute("style")).toBe(
      `background-image:url("${original}")`,
    );
    expect(other.getAttribute("style")).toBe(
      `background-image:url("${original}")`,
    );
  });

  it("keeps the resized CSS url when it loads", () => {
    const style = `background:url(${toCanvasImageUrl("https://images.example.com/bg.jpg", PROXY)})`;
    const target = element("div", { style });
    const frame = runBootstrap([target]);
    frame.mutate(target, "style");
    FakeImage.created[0]?.onload?.();
    expect(target.getAttribute("style")).toBe(style);
  });
});
