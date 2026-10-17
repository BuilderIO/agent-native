// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_NATIVE_EXTENSION_MESSAGE_TYPES,
  buildAgentNativeExtensionHtml,
  createHttpAgentNativeExtensionStorage,
  createLocalStorageAgentNativeExtensionStorage,
  getAgentNativeExtensionManifest,
  isAgentNativeExtensionAllowedInSlot,
  normalizeAgentNativeExtensionSandbox,
} from "./portable-extension.js";

function runtimeScript(html: string): string {
  const scripts = Array.from(
    html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1],
  );
  const script = scripts.find((value) => value.includes("var messageTypes ="));
  if (!script) throw new Error("Portable extension runtime script not found");
  return script;
}

function executeRuntime(linkNonce?: string): string {
  const html = buildAgentNativeExtensionHtml({
    extensionId: "ext-1",
    content: "<div></div>",
    ...(linkNonce ? { linkNonce } : {}),
  });
  window.eval(runtimeScript(html));
  return html;
}

function createTestPort() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const messages: unknown[] = [];
  const port = {
    addEventListener(type: string, listener: EventListener) {
      if (type === "message") {
        listeners.add(listener as (event: MessageEvent) => void);
      }
    },
    removeEventListener(type: string, listener: EventListener) {
      if (type === "message") {
        listeners.delete(listener as (event: MessageEvent) => void);
      }
    },
    start() {},
    postMessage(message: unknown) {
      messages.push(message);
    },
  };
  return {
    port: port as unknown as MessagePort,
    messages,
    dispatch(data: unknown) {
      for (const listener of listeners) listener({ data } as MessageEvent);
    },
  };
}

function postHostMessage(data: unknown, source: MessageEventSource | null) {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}

describe("portable extension runtime", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    delete (window as any).agentNative;
    delete (window as any).extensionData;
    delete (window as any).__agentNativeExtensionHostPort;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("builds sandbox iframe HTML with isolated external links", () => {
    const html = buildAgentNativeExtensionHtml({
      extensionId: "ext-1",
      slotId: "crm.sidebar",
      title: "Customer notes",
      content: '<div x-data="{ ready: true }">Hello</div>',
      linkNonce: "test-link-nonce",
      slotContext: { customerId: "cus_123" },
    });

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("@tailwindcss/browser@4.2.4");
    expect(html).toContain("alpinejs@3.15.11");
    expect(html).toContain("@rrweb/record@2.1.0/umd/record.min.js");
    expect(html).toContain("recordCrossOriginIframes: true");
    expect(html).toContain("agentNative.host.ready");
    expect(html).toContain("link.getAttribute('href')");
    expect(html).toContain("agent-native-extension.hello-link-channel");
    expect(html).not.toContain("agent-native-extension.reseed-link-channel");
    expect(html).toContain("agent-native-extension.open-external-link");
    expect(html).toContain("window.appAction = hostAction");
    expect(html).toContain("window.extensionData = extensionData");
    expect(html).toContain("var bodyRect = body.getBoundingClientRect()");
    expect(html).toContain("bodyRect.height - paddingBottom");
    expect(html).toContain("body.querySelectorAll('*')");
    expect(html).toContain("style.overflowY");
    expect(html).toContain("auto|scroll|overlay|hidden|clip");
    expect(html).toContain("style.position === 'fixed'");
    expect(html).toContain("style.position === 'absolute'");
    expect(html).toContain("requestAnimationFrame");
    expect(html).toContain("positionObservationScheduled");
    expect(html).toContain("schedulePositionObservation");
    expect(html).toContain("positionMonitorActive");
    expect(html).toContain("activeCssMotionCount");
    expect(html).toContain("animationProbeTimer");
    expect(html).toContain("document.getAnimations()");
    expect(html).toContain("positionedElements.forEach");
    expect(html).toContain("motionElements.forEach");
    expect(html).toContain("watchAnimationCompletion");
    expect(html).toContain("Element.prototype.animate");
    expect(html).toContain("document.addEventListener('animationend'");
    expect(html).toContain("document.addEventListener('transitionend'");
    expect(html).not.toContain(
      "document.addEventListener('animationiteration'",
    );
    expect(html).toContain("positionMonitorFramesRemaining");
    expect(html).toContain("document.addEventListener('transitionstart'");
    expect(html).toContain("new MutationObserver");
    const reportStart = html.indexOf("function reportHeight()");
    const reportEnd = html.indexOf(
      "window.addEventListener('load', reportHeight)",
      reportStart,
    );
    expect(reportStart).toBeGreaterThanOrEqual(0);
    expect(reportEnd).toBeGreaterThan(reportStart);
    expect(html.slice(reportStart, reportEnd)).toContain(
      "measurePositionedContent",
    );
    expect(html.slice(reportStart, reportEnd)).not.toContain(
      "querySelectorAll('*')",
    );
    expect(html.slice(reportStart, reportEnd)).not.toContain(
      "document.createTreeWalker(body, 4)",
    );
    expect(html.slice(reportStart, reportEnd)).not.toContain(
      "range.getClientRects()",
    );
    expect(html).toContain(
      "document.addEventListener('DOMContentLoaded', setupResizeObservation)",
    );
    expect(html).toContain('<div x-data="{ ready: true }">Hello</div>');
    expect(html).toContain("cus_123");
  });

  it("escapes JSON values embedded in runtime scripts", () => {
    const html = buildAgentNativeExtensionHtml({
      extensionId: "ext-1",
      content: "<div></div>",
      linkNonce: "test-link-nonce",
      slotContext: { label: "</script><script>alert(1)</script>" },
    });

    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>alert");
  });

  it("preserves callers that build extension HTML without link routing", () => {
    const html = buildAgentNativeExtensionHtml({
      extensionId: "ext-1",
      content: "<div></div>",
    });

    expect(html).toContain("<div></div>");
    expect(html).not.toContain("data-link-nonce=");
    expect(html).toContain("agentNative.host.ready");
    expect(html).not.toContain("agent-native-extension.hello-link-channel");
  });

  it("keeps the legacy source-checked window host bridge without a nonce", async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      sent.push(message);
    });
    const html = executeRuntime();
    expect(html).not.toContain("agent-native-extension.hello-link-channel");

    expect(sent).toContainEqual(
      expect.objectContaining({ type: "agentNative.host.ready" }),
    );

    const forgedInit = {
      type: "agentNative.host.init",
      context: { source: "untrusted" },
    };
    postHostMessage(forgedInit, {} as Window);
    expect((window as any).agentNative.init).toBeNull();

    postHostMessage(
      {
        type: "agentNative.host.init",
        context: { source: "host" },
        actions: [{ name: "save" }],
      },
      window,
    );
    expect((window as any).agentNative.contextSnapshot).toEqual({
      source: "host",
    });
    expect((window as any).agentNative.actionsSnapshot).toEqual([
      { name: "save" },
    ]);

    const contextPromise = (window as any).agentNative.context();
    const contextRequest = sent.find(
      (message: any) => message.type === "agentNative.host.getContext",
    ) as any;
    expect(contextRequest).toBeTruthy();
    postHostMessage(
      {
        type: "agentNative.host.context",
        requestId: contextRequest.requestId,
        context: { customerId: "cus_1" },
      },
      window,
    );
    await expect(contextPromise).resolves.toEqual({ customerId: "cus_1" });

    const actionPromise = (window as any).agentNative.action("save", {
      value: 7,
    });
    const actionRequest = sent.find(
      (message: any) => message.type === "agentNative.host.runAction",
    ) as any;
    expect(actionRequest).toMatchObject({ name: "save", args: { value: 7 } });
    postHostMessage(
      {
        type: "agentNative.host.actionResult",
        requestId: actionRequest.requestId,
        result: { saved: true },
      },
      window,
    );
    await expect(actionPromise).resolves.toEqual({ saved: true });

    const storagePromise = (window as any).extensionData.get("notes", "n1");
    const storageRequest = sent.find(
      (message: any) =>
        message.type === AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.STORAGE_REQUEST,
    ) as any;
    expect(storageRequest).toMatchObject({
      op: "get",
      collection: "notes",
      id: "n1",
    });
    postHostMessage(
      {
        type: AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.STORAGE_RESPONSE,
        requestId: storageRequest.requestId,
        result: { id: "n1" },
      },
      window,
    );
    await expect(storagePromise).resolves.toEqual({ id: "n1" });
  });

  it("keeps nonce host traffic on the private MessagePort", async () => {
    vi.useFakeTimers();
    const windowPost = vi.spyOn(window, "postMessage");
    const html = executeRuntime("private-link-nonce");
    expect(html).toContain('data-link-nonce="private-link-nonce"');

    postHostMessage(
      {
        type: "agentNative.host.init",
        context: { source: "window" },
      },
      window,
    );
    expect((window as any).agentNative.init).toBeNull();

    const host = createTestPort();
    (window as any).__agentNativeExtensionHostPort = host.port;
    window.dispatchEvent(new Event("agent-native-extension-host-port-ready"));
    expect(host.messages).toContainEqual(
      expect.objectContaining({ type: "agentNative.host.ready" }),
    );
    expect(windowPost).not.toHaveBeenCalled();

    host.dispatch({
      type: "agentNative.host.init",
      context: { source: "port" },
    });
    expect((window as any).agentNative.contextSnapshot).toEqual({
      source: "port",
    });

    const contextPromise = (window as any).agentNative.context();
    const contextRequest = host.messages.find(
      (message: any) => message.type === "agentNative.host.getContext",
    ) as any;
    expect(contextRequest).toBeTruthy();
    host.dispatch({
      type: "agentNative.host.context",
      requestId: contextRequest.requestId,
      context: { customerId: "cus_2" },
    });
    await expect(contextPromise).resolves.toEqual({ customerId: "cus_2" });
    expect(windowPost).not.toHaveBeenCalled();
  });

  it("reattaches nonce host traffic after a BFCache restore", async () => {
    executeRuntime("private-link-nonce");

    const firstHost = createTestPort();
    (window as any).__agentNativeExtensionHostPort = firstHost.port;
    window.dispatchEvent(new Event("agent-native-extension-host-port-ready"));
    expect(firstHost.messages).toContainEqual(
      expect.objectContaining({ type: "agentNative.host.ready" }),
    );

    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    window.dispatchEvent(pagehide);
    window.dispatchEvent(new Event("pageshow"));

    const restoredHost = createTestPort();
    (window as any).__agentNativeExtensionHostPort = restoredHost.port;
    window.dispatchEvent(new Event("agent-native-extension-host-port-ready"));

    const contextPromise = (window as any).agentNative.context();
    const contextRequest = restoredHost.messages.find(
      (message: any) => message.type === "agentNative.host.getContext",
    ) as any;
    expect(contextRequest).toBeTruthy();
    restoredHost.dispatch({
      type: "agentNative.host.context",
      requestId: contextRequest.requestId,
      context: { restored: true },
    });

    await expect(contextPromise).resolves.toEqual({ restored: true });
  });

  it("keeps legacy popups and limits them to the legacy sandbox mode", () => {
    expect(
      normalizeAgentNativeExtensionSandbox(
        "allow-scripts allow-same-origin allow-popups",
      ),
    ).toBe("allow-scripts allow-popups allow-downloads");
    expect(normalizeAgentNativeExtensionSandbox(undefined)).toContain(
      "allow-scripts",
    );
    expect(normalizeAgentNativeExtensionSandbox(undefined)).toBe(
      "allow-scripts allow-forms allow-popups allow-downloads",
    );
    expect(
      normalizeAgentNativeExtensionSandbox(undefined, { mode: "nonce" }),
    ).toBe("allow-scripts allow-forms allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(
        "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-top-navigation-by-user-activation",
        { mode: "nonce" },
      ),
    ).toBe("allow-scripts allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(
        "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
      ),
    ).toBe("allow-scripts allow-popups allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(
        "ALLOW-SCRIPTS ALLOW-POPUPS ALLOW-POPUPS-TO-ESCAPE-SANDBOX",
      ),
    ).toBe("allow-scripts allow-popups allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(
        "ALLOW-SCRIPTS ALLOW-POPUPS ALLOW-POPUPS-TO-ESCAPE-SANDBOX",
        { mode: "nonce" },
      ),
    ).toBe("allow-scripts allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(undefined, { mode: "legacy" }),
    ).toBe("allow-scripts allow-forms allow-popups allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(
        "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
        { mode: "legacy" },
      ),
    ).toBe("allow-scripts allow-popups allow-downloads");
    expect(
      normalizeAgentNativeExtensionSandbox(
        "allow-scripts allow-top-navigation-by-user-activation",
      ),
    ).toBe(
      "allow-scripts allow-top-navigation-by-user-activation allow-downloads",
    );
    expect(normalizeAgentNativeExtensionSandbox("allow-forms")).toContain(
      "allow-downloads",
    );
  });

  it("normalizes manifest aliases and slot allowlists", () => {
    const extension = {
      id: "ext-1",
      name: "Customer panel",
      content: "<div></div>",
      slots: ["crm.customer.sidebar"],
      requestedActions: ["list-customers"],
      manifest: {
        requestedCommands: ["refreshData"],
        storageScopes: ["user"],
      },
    };

    expect(getAgentNativeExtensionManifest(extension)).toMatchObject({
      slots: ["crm.customer.sidebar"],
      requestedActions: ["list-customers"],
      requestedCommands: ["refreshData"],
      storageScopes: ["user"],
    });
    expect(
      isAgentNativeExtensionAllowedInSlot(extension, "crm.customer.sidebar"),
    ).toBe(true);
    expect(
      isAgentNativeExtensionAllowedInSlot(extension, "crm.account.sidebar"),
    ).toBe(false);
  });

  it("persists extension data in localStorage by extension and scope", async () => {
    const storage = createLocalStorageAgentNativeExtensionStorage("spec");
    const context = { extensionId: "ext-1" };

    const saved = await storage.set(
      "notes",
      "note-1",
      { text: "Call soon" },
      { scope: "user" },
      context,
    );

    expect(saved).toMatchObject({
      id: "note-1",
      extensionId: "ext-1",
      collection: "notes",
      data: { text: "Call soon" },
      scope: "user",
    });
    await storage.set(
      "notes",
      "note-2",
      { text: "Org note" },
      { scope: "org" },
      context,
    );

    expect(
      await storage.get("notes", "note-1", { scope: "user" }, context),
    ).toMatchObject({ id: "note-1" });
    expect(await storage.list("notes", { scope: "all" }, context)).toHaveLength(
      2,
    );
    expect(
      await storage.list("notes", { scope: "user" }, { extensionId: "ext-2" }),
    ).toHaveLength(0);

    expect(
      await storage.remove("notes", "note-1", { scope: "user" }, context),
    ).toEqual({ removed: true });
    expect(
      await storage.get("notes", "note-1", { scope: "user" }, context),
    ).toBeNull();
  });

  it("rejects writes to the read-only all scope", async () => {
    const storage = createLocalStorageAgentNativeExtensionStorage("spec");
    expect(() =>
      storage.set(
        "notes",
        "note-1",
        {},
        { scope: "all" },
        { extensionId: "ext-1" },
      ),
    ).toThrow(/scope "all"/);
  });

  it("sends production storage operations to an HTTP adapter", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({
        result: [
          {
            id: "note-1",
            extensionId: "ext-1",
            collection: "notes",
            data: { text: "Saved" },
            scope: "org",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const storage = createHttpAgentNativeExtensionStorage({
      endpoint: "/api/extensions/storage",
      fetch: fetchMock as unknown as typeof fetch,
      headers: () => ({ Authorization: "Bearer token" }),
    });

    await expect(
      storage.list(
        "notes",
        { scope: "org" },
        { extensionId: "ext-1", slotId: "crm.sidebar", userId: "user-1" },
      ),
    ).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/extensions/storage",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.stringContaining('"operation":"list"'),
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get("Authorization")).toBe(
      "Bearer token",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operation: "list",
      extensionId: "ext-1",
      slotId: "crm.sidebar",
      collection: "notes",
      options: { scope: "org" },
      context: {
        extensionId: "ext-1",
        slotId: "crm.sidebar",
        userId: "user-1",
      },
    });
  });
});
