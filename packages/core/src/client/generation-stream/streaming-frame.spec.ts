// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  buildStreamingFrameDocument,
  isStreamingFrameReadyMessage,
  STREAMING_FRAME_MESSAGE,
  STREAMING_FRAME_READY_MESSAGE,
} from "./streaming-frame";

function frameScript(doc: string): string {
  const match = /<script>([\s\S]*)<\/script><\/head>/.exec(doc);
  if (!match?.[1]) throw new Error("frame document has no script");
  return match[1];
}

describe("buildStreamingFrameDocument", () => {
  it("serializes a script that compiles on its own", () => {
    const script = frameScript(buildStreamingFrameDocument());
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it("escapes the base href", () => {
    const doc = buildStreamingFrameDocument({
      baseHref: 'https://example.com/"><script>',
    });
    expect(doc).toContain(
      '<base href="https://example.com/&quot;>&lt;script>">',
    );
  });
});

describe("streaming frame script", () => {
  let disposers: (() => void)[] = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  /** Runs the frame script in this window, which is its own parent. */
  function startFrame() {
    const added: EventListener[] = [];
    const addEventListener = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListener) => {
      if (type === "message") added.push(listener);
      addEventListener(type, listener);
    }) as typeof window.addEventListener;
    new Function(frameScript(buildStreamingFrameDocument()))();
    window.addEventListener = addEventListener;
    disposers.push(() => {
      for (const listener of added) {
        window.removeEventListener("message", listener);
      }
    });
    return (html: string) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: STREAMING_FRAME_MESSAGE, html },
          source: window,
        }),
      );
    };
  }

  const hrefs = () =>
    Array.from(document.head.querySelectorAll("link")).map((link) =>
      link.getAttribute("href"),
    );

  it("retires stylesheets a later document dropped once its head is whole", () => {
    const post = startFrame();
    post(
      '<html><head><link rel="alternate" href="a.css"><link rel="alternate" href="b.css"></head><body><p>One</p></body></html>',
    );
    expect(hrefs()).toEqual(["a.css", "b.css"]);

    // A head still streaming in keeps what has not arrived yet.
    post('<html><head><link rel="alternate" href="b.css">');
    expect(hrefs()).toEqual(["a.css", "b.css"]);

    post(
      '<html><head><link rel="alternate" href="b.css"></head><body><p>Two</p></body></html>',
    );
    expect(hrefs()).toEqual(["b.css"]);
  });

  /** Scripts run through an ordered queue; let it drain. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs a body script again when a later document changes it", async () => {
    const post = startFrame();
    post(
      "<html><head></head><body><p>One</p><script>window.__step = 1;</script></body></html>",
    );
    await settle();
    const first = document.body.querySelector("script");
    expect(first?.text).toBe("window.__step = 1;");

    post(
      "<html><head></head><body><p>One</p><script>window.__step = 1;</script></body></html>",
    );
    await settle();
    expect(document.body.querySelector("script")).toBe(first);

    post(
      "<html><head></head><body><p>One</p><script>window.__step = 2;</script></body></html>",
    );
    await settle();
    const second = document.body.querySelector("script");
    expect(second).not.toBe(first);
    expect(second?.text).toBe("window.__step = 2;");
  });

  it("inserts external scripts in order instead of async", async () => {
    const post = startFrame();
    post(
      '<html><head><script src="data:text/javascript,window.__lib=1"></script></head><body></body></html>',
    );
    await settle();
    const script =
      document.head.querySelector<HTMLScriptElement>("script[src]");
    expect(script?.async).toBe(false);
  });
});

describe("isStreamingFrameReadyMessage", () => {
  it("accepts only its own frame's ready message carrying its token", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ready = (
      token: string,
      source: Window | null = frame.contentWindow,
    ) =>
      new MessageEvent("message", {
        data: { type: STREAMING_FRAME_READY_MESSAGE, token },
        source,
      });

    expect(buildStreamingFrameDocument({ token: "abc" })).toContain('"abc"');
    expect(isStreamingFrameReadyMessage(ready("abc"), frame, "abc")).toBe(true);
    expect(isStreamingFrameReadyMessage(ready("xyz"), frame, "abc")).toBe(
      false,
    );
    expect(
      isStreamingFrameReadyMessage(ready("abc", window), frame, "abc"),
    ).toBe(false);
    frame.remove();
  });
});
