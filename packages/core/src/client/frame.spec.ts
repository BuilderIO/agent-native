// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";

function parentWindow() {
  return {
    postMessage: vi.fn(),
  } as unknown as Window;
}

function setParent(parent: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
}

function dispatchFrameOrigin(origin: string, parent: Window, payload = origin) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "agentNative.frameOrigin", origin: payload },
      origin,
      source: parent,
    }),
  );
}

async function loadFrame() {
  vi.resetModules();
  return import("./frame.js");
}

function setEmbedToken(token: string | null): void {
  const url = new URL(window.location.href);
  url.search = token
    ? `?${EMBED_MODE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=${token}`
    : "";
  window.history.replaceState(null, "", url.toString());
  window.sessionStorage.clear();
}

function stubSessionResponse(body: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("frame bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    setParent(window);
    setEmbedToken(null);
    delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
      .__AGENT_NATIVE_CONFIG__;
  });

  it("handshakes with a Builder parent", async () => {
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("https://builder.io", parent);

    expect(frame.getFrameOrigin()).toBe("https://builder.io");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "agentNative.embeddedAppReady" },
      "https://builder.io",
    );
  });

  it("handles view requests from the trusted parent of a credentialed embed", async () => {
    const originalUrl = window.location.href;
    const origin = "https://view-host.example.test";
    Object.assign(window, {
      __AGENT_NATIVE_CONFIG__: { frameHostOrigins: [origin] },
    });
    const parent = parentWindow();
    setParent(parent);
    setEmbedToken("test-embed-ticket");
    const session = stubSessionResponse({
      email: "member@example.test",
      token: "test-embed-ticket",
    });
    await loadFrame();
    dispatchFrameOrigin(origin, parent);
    const port = { postMessage: vi.fn(), close: vi.fn() };
    const send = (operation: string, path?: string, senderOrigin = origin) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.viewRequest",
            operation,
            path,
            deadline: Date.now() + 1000,
          },
          origin: senderOrigin,
          source: parent,
          ports: [port as unknown as MessagePort],
        }),
      );
    };
    try {
      send("read", undefined, "https://untrusted.example.test");
      expect(port.postMessage).not.toHaveBeenCalled();
      send("navigate", "/tasks/one");
      await vi.waitFor(() => expect(port.close).toHaveBeenCalledTimes(1));
      expect(port.postMessage).toHaveBeenLastCalledWith({
        result: { path: "/tasks/one" },
      });
      send("read");
      await vi.waitFor(() => expect(port.close).toHaveBeenCalledTimes(2));
      expect(port.postMessage).toHaveBeenLastCalledWith({
        result: expect.objectContaining({ path: "/tasks/one" }),
      });
      send("navigate", "//untrusted.example.test/");
      await vi.waitFor(() => expect(port.close).toHaveBeenCalledTimes(3));
      expect(port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
      session.mockResolvedValueOnce(new Response(null, { status: 401 }));
      send("read");
      await vi.waitFor(() => expect(port.close).toHaveBeenCalledTimes(4));
      expect(port.postMessage).toHaveBeenLastCalledWith({
        error: expect.stringContaining("could not be verified"),
      });
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("handshakes with a configured host origin", async () => {
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      frameHostOrigins: ["https://dispatch.example.com"],
    };
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("https://dispatch.example.com", parent);

    expect(frame.getFrameOrigin()).toBe("https://dispatch.example.com");
  });

  it("ignores a same-site parent that is not a known host", async () => {
    const fetchSpy = stubSessionResponse({ email: "member@example.com" });
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("https://other.builder.cloud", parent);
    // fixed-sleep-ok: message events dispatch on a later task, so a refusal needs one turn
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(frame.getFrameOrigin()).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      frame.isTrustedFrameMessage(
        new MessageEvent("message", {
          data: { type: "agentNative.submitChat" },
          origin: "https://other.builder.cloud",
          source: parent,
        }),
      ),
    ).toBe(false);
  });

  it("ignores an opaque parent without an embed session", async () => {
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("null", parent, "https://sandbox.example");
    // fixed-sleep-ok: message events dispatch on a later task, so a refusal needs one turn
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(frame.getFrameOrigin()).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("ignores an opaque parent when the embed token resolves to the cookie session", async () => {
    setEmbedToken("unverified");
    stubSessionResponse({ email: "member@example.com", token: "cookie" });
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("null", parent, "https://sandbox.example");
    // fixed-sleep-ok: message events dispatch on a later task, so a refusal needs one turn
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(frame.getFrameOrigin()).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("ignores an opaque parent when the embed session has no signed-in user", async () => {
    setEmbedToken("embed-session");
    stubSessionResponse({ error: "Not authenticated" });
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("null", parent, "https://sandbox.example");
    // fixed-sleep-ok: message events dispatch on a later task, so a refusal needs one turn
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(frame.getFrameOrigin()).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("allows the embed handshake without granting opaque parents view requests", async () => {
    setEmbedToken("embed-session");
    stubSessionResponse({
      email: "member@example.com",
      token: "embed-session",
    });
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("null", parent, "https://chatgpt-sandbox.example");
    await vi.waitFor(() => expect(frame.getFrameOrigin()).toBe("null"));

    const port = { postMessage: vi.fn(), close: vi.fn() };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agentNative.viewRequest",
          operation: "read",
          deadline: Date.now() + 1000,
        },
        origin: "null",
        source: parent,
        ports: [port as unknown as MessagePort],
      }),
    );
    expect(port.postMessage).not.toHaveBeenCalled();

    expect(frame.getFramePostMessageTargetOrigin()).toBe("*");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "agentNative.embeddedAppReady" },
      "*",
    );
    expect(
      frame.isTrustedFrameMessage(
        new MessageEvent("message", {
          data: { type: "agentNative.ping" },
          origin: "null",
          source: parent,
        }),
      ),
    ).toBe(true);

    frame.sendToFrame("agentNative.test", { ok: true });

    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "agentNative.test", data: { ok: true } },
      "*",
    );
  });
  it.each([
    "https://0123456789abcdef0123456789abcdef.claudemcpcontent.com",
    "https://abc.web-sandbox.oaiusercontent.com",
  ])("ignores %s without an embed session", async (origin) => {
    const fetchSpy = stubSessionResponse({ error: "Not authenticated" });
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin(origin, parent);
    // fixed-sleep-ok: message events dispatch on a later task, so a refusal needs one turn
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(frame.isKnownFrameHostOrigin(origin)).toBe(false);
    expect(frame.getFrameOrigin()).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "https://0123456789abcdef0123456789abcdef.claudemcpcontent.com",
    "https://abc.web-sandbox.oaiusercontent.com",
  ])("handshakes with %s on a confirmed embed session", async (origin) => {
    setEmbedToken("embed-session");
    stubSessionResponse({
      email: "member@example.com",
      token: "embed-session",
    });
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin(origin, parent);
    await vi.waitFor(() => expect(frame.getFrameOrigin()).toBe(origin));
  });
});
