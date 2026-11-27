// @vitest-environment happy-dom

import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  focusSealedFrame,
  readSealedFrameMessage,
  SEALED_FRAME_MAX_HEIGHT,
  SEALED_FRAME_MIN_HEIGHT,
  SEALED_FRAME_SANDBOX,
  sealedFrameCsp,
  sealedFrameDocument,
} from "./sealed-frame";

const SOURCES = {
  imageSources: ["'self'", "data:", "blob:", "https://media.example.com"],
  mediaSources: ["'self'", "data:"],
};

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

function directives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("a block's frame", () => {
  it("never shares an origin with the app, or opens or moves its windows", () => {
    const granted = SEALED_FRAME_SANDBOX.split(" ");

    expect(granted).not.toContain("allow-same-origin");
    expect(granted.sort()).toEqual(["allow-forms", "allow-scripts"]);
    const inner = parse(sealedFrameDocument("<p>", SOURCES)).querySelector(
      "iframe",
    );
    expect(inner?.getAttribute("sandbox")).toBe(SEALED_FRAME_SANDBOX);
  });

  it("asks for nothing but the library host and the hosts media may come from", () => {
    const policy = directives(sealedFrameCsp(SOURCES));

    expect(policy).toMatchObject({
      "default-src": "'none'",
      "connect-src": "'none'",
      "frame-src": "'none'",
      "worker-src": "'none'",
      "object-src": "'none'",
      "base-uri": "'none'",
      "form-action": "'none'",
      "img-src": "data: blob: https://media.example.com",
      "media-src": "data: blob:",
    });
    expect(policy["script-src"]).toBe(
      "https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'",
    );
    expect(sealedFrameCsp(SOURCES)).not.toContain("'self'");
  });

  it("puts that policy on both documents, before anything of the block's", () => {
    const outer = parse(sealedFrameDocument("<p>Hi</p>", SOURCES));
    const inner = parse(
      outer.querySelector("iframe")?.getAttribute("srcdoc") ?? "",
    );

    for (const page of [outer, inner]) {
      const policy = page.querySelector("meta");
      expect(policy?.getAttribute("http-equiv")).toBe(
        "Content-Security-Policy",
      );
      expect(policy?.getAttribute("content")).toBe(sealedFrameCsp(SOURCES));
    }
    expect(inner.querySelector("p")?.textContent).toBe("Hi");
  });

  it.each([
    '<p title="&quot;">"quoted" & &amp;</p>',
    '</iframe><script>alert("out")</script>',
    '"></iframe><img src=x>',
  ])("can't be closed early by %s", (source) => {
    const outer = parse(sealedFrameDocument(source, SOURCES));

    expect(outer.querySelectorAll("iframe")).toHaveLength(1);
    expect(outer.querySelectorAll("script")).toHaveLength(1);
    expect(outer.querySelector("img")).toBeNull();
    expect(outer.querySelector("iframe")?.getAttribute("srcdoc")).toContain(
      source,
    );
  });

  it("runs the block in standards mode, whatever doctype it wrote", () => {
    const srcdoc = (source: string) =>
      parse(sealedFrameDocument(source, SOURCES))
        .querySelector("iframe")
        ?.getAttribute("srcdoc") ?? "";

    expect(srcdoc("\n<!DOCTYPE html>\n<p>").match(/<!doctype/gi)).toHaveLength(
      1,
    );
    expect(srcdoc("<p>")).toMatch(/^<!doctype html>/);
  });
});

describe("the document around a block", () => {
  function relay() {
    const block = { focus: vi.fn() };
    const frame = { contentWindow: block, focus: vi.fn() };
    const app = { postMessage: vi.fn() };
    const listeners = new Map<string, (event: object) => void>();
    runInNewContext(
      parse(sealedFrameDocument("<p>", SOURCES)).querySelector("body > script")
        ?.textContent ?? "",
      {
        document: { querySelector: () => frame },
        parent: app,
        addEventListener: (type: string, listener: (event: object) => void) =>
          listeners.set(type, listener),
      },
    );
    return {
      app,
      block,
      message: (source: object, data: unknown) =>
        listeners.get("message")?.({ source, data }),
      press: (key: string) => listeners.get("keydown")?.({ key }),
    };
  }

  it("tells the app a height or an Escape from its own block, and nothing else", () => {
    const { app, block, message, press } = relay();

    message(block, { type: "content-interactive-html-height", height: 300 });
    message(block, { type: "content-interactive-html-escape", extra: 1 });
    press("Escape");
    expect(app.postMessage.mock.calls.map(([data]) => data)).toEqual([
      { type: "content-interactive-html-height", height: 300 },
      { type: "content-interactive-html-escape" },
      { type: "content-interactive-html-escape" },
    ]);

    app.postMessage.mockClear();
    message(block, { type: "content-interactive-html-height", height: "300" });
    message(block, { type: "agent-native-chat", message: "hi" });
    message(block, null);
    message({}, { type: "content-interactive-html-escape" });
    press("a");
    expect(app.postMessage).not.toHaveBeenCalled();
  });

  it("hands the keyboard to the block when the app asks, and only then", () => {
    const { app, block, message } = relay();
    let asked: unknown;
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "contentWindow", {
      value: { postMessage: (data: unknown) => (asked = data) },
    });
    focusSealedFrame(frame);

    message(block, asked);
    expect(block.focus).not.toHaveBeenCalled();

    message(app, asked);
    expect(block.focus).toHaveBeenCalledOnce();
  });
});

describe("a block's height", () => {
  function blockOf(heightIn: (view: number, width: number) => number) {
    const sent: number[] = [];
    const window = {
      innerHeight: 400,
      innerWidth: 700,
      scrollY: 0,
      parent: {
        postMessage: ({ height }: { height: number }) => sent.push(height),
      },
    };
    const contentHeight = () => heightIn(window.innerHeight, window.innerWidth);
    const listeners = new Map<string, () => void>();
    class Observer {
      observe() {}
    }
    const outer = parse(sealedFrameDocument("<p>", SOURCES));
    const inner = parse(
      outer.querySelector("iframe")?.getAttribute("srcdoc") ?? "",
    );
    runInNewContext(inner.querySelector("script")?.textContent ?? "", {
      window,
      document: {
        documentElement: {
          clientWidth: 700,
          get scrollHeight() {
            return Math.max(window.innerHeight, contentHeight());
          },
        },
        body: {
          getBoundingClientRect: () => ({ bottom: contentHeight() }),
          getElementsByTagName: () => [],
        },
        addEventListener: () => {},
      },
      Element: class {
        attachShadow() {}
      },
      MutationObserver: Observer,
      ResizeObserver: Observer,
      getComputedStyle: () => ({ marginBottom: "0px" }),
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      setTimeout: (run: () => void) => run(),
    });
    return {
      window,
      settle() {
        sent.length = 0;
        listeners.get("resize")?.();
        for (const height of sent) {
          if (sent.length > 20) break;
          window.innerHeight = height;
          listeners.get("resize")?.();
        }
        return [...sent];
      },
    };
  }

  it("follows its content both ways", () => {
    let height = 300;
    const { settle } = blockOf(() => height);

    expect(settle()).toEqual([300]);
    height = 520;
    expect(settle()).toEqual([520]);
    height = 300;
    expect(settle()).toEqual([300]);
  });

  it("settles when the content is taller in a shorter frame", () => {
    const { settle, window } = blockOf((view) => (view < 500 ? 600 : 400));

    expect(settle()).toEqual([600, 400, 600]);
    expect(settle()).toEqual([]);

    window.innerWidth = 320;
    expect(settle()).toEqual([400, 600]);
    expect(settle()).toEqual([]);
  });
});

describe("a message from a block's frame", () => {
  const height = (value: unknown) =>
    readSealedFrameMessage({
      type: "content-interactive-html-height",
      height: value,
    });

  it("sets a height within bounds", () => {
    expect(height(240.2)).toEqual({ type: "height", height: 241 });
    expect(height(9e9)).toEqual({
      type: "height",
      height: SEALED_FRAME_MAX_HEIGHT,
    });
    expect(height(-1)).toEqual({
      type: "height",
      height: SEALED_FRAME_MIN_HEIGHT,
    });
  });

  it("says Escape was pressed", () => {
    expect(
      readSealedFrameMessage({ type: "content-interactive-html-escape" }),
    ).toEqual({ type: "escape" });
  });

  it.each([
    null,
    "content-interactive-html-escape",
    {},
    { type: "agent-native-chat", message: "hi" },
  ])("is ignored as %o", (data) => {
    expect(readSealedFrameMessage(data)).toBeNull();
  });

  it.each([NaN, Infinity, "400", null, undefined])(
    "is ignored with height %o",
    (value) => {
      expect(height(value)).toBeNull();
    },
  );
});
