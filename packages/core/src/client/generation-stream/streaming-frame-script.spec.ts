// @vitest-environment happy-dom

// These tests run the frame's serialized script. Mutation testing instruments
// the functions it serializes with helpers that only exist in their own
// module, so they live apart from `streaming-frame.spec.ts`, the spec
// mutation testing runs for `streaming-frame.ts`.

import { afterEach, describe, expect, it } from "vitest";

import {
  buildStreamingFrameDocument,
  STREAMING_FRAME_CONNECT_MESSAGE,
  STREAMING_FRAME_MESSAGE,
} from "./streaming-frame";

function frameScript(doc: string): string {
  const match = /<script>([\s\S]*)<\/script><\/head>/.exec(doc);
  if (!match?.[1]) throw new Error("frame document has no script");
  return match[1];
}

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
    const port = connect();
    return (html: string) => {
      port.onmessage?.({ data: { type: STREAMING_FRAME_MESSAGE, html } });
    };
  }

  /** Hands the frame a port, as the parent does once it is ready. */
  function connect() {
    const port: { onmessage: ((event: { data: unknown }) => void) | null } = {
      onmessage: null,
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: STREAMING_FRAME_CONNECT_MESSAGE },
        source: window,
        ports: [port as unknown as MessagePort],
      }),
    );
    return port;
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

  it("takes documents only from the port it was handed first", () => {
    const post = startFrame();
    post("<html><head></head><body><p>From the port</p></body></html>");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: STREAMING_FRAME_MESSAGE,
          html: "<html><head></head><body><p>From a window message</p></body></html>",
        },
        source: window,
      }),
    );
    const late = connect();
    late.onmessage?.({
      data: {
        type: STREAMING_FRAME_MESSAGE,
        html: "<html><head></head><body><p>From a second port</p></body></html>",
      },
    });

    expect(late.onmessage).toBeNull();
    expect(document.body.textContent).toBe("From the port");
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

  it("runs only the new script when one is inserted before another", async () => {
    // A body script starts when the frame swaps its inert copy for a live one.
    const runs: string[] = [];
    const replaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function <T extends Node>(
      this: Node,
      node: Node,
      child: T,
    ): T {
      if (node instanceof HTMLScriptElement) runs.push(node.text);
      return replaceChild.call(this, node, child) as T;
    };
    disposers.push(() => {
      Node.prototype.replaceChild = replaceChild;
    });
    const post = startFrame();
    post(
      '<html><head></head><body><p>One</p><script>__ran("a")</script></body></html>',
    );
    await settle();
    expect(runs).toEqual(['__ran("a")']);

    post(
      '<html><head></head><body><p>One</p><script>__ran("b")</script><script>__ran("a")</script></body></html>',
    );
    await settle();
    expect(runs).toEqual(['__ran("a")', '__ran("b")']);
  });

  it("keeps the live scripts matching the source after an insert before two", async () => {
    const post = startFrame();
    post(
      '<html><head></head><body><script>"a"</script><script>"b"</script></body></html>',
    );
    await settle();
    post(
      '<html><head></head><body><script>"x"</script><script>"a"</script><script>"b"</script></body></html>',
    );
    await settle();
    expect(
      Array.from(document.body.querySelectorAll("script"), (node) => node.text),
    ).toEqual(['"x"', '"a"', '"b"']);
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
