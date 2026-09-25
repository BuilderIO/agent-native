// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openMcpAppHostLink } from "../mcp-app-host.js";
import { BuilderConnectPopover } from "./BuilderConnectPopover.js";
import {
  useBuilderStatus,
  useBuilderConnectFlow,
  withBuilderConnectTrackingParams,
} from "./useBuilderStatus.js";

vi.mock("../mcp-app-host.js", () => ({
  openMcpAppHostLink: vi.fn(() => false),
}));

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

// The initial Builder status read is deferred past first paint; the fallback
// timer bounds that wait at 250ms, so settling past it is deterministic.
async function flushAfterPaint() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

function setEmbeddedWindow(embedded: boolean) {
  Object.defineProperty(window, "top", {
    value: embedded ? {} : window,
    configurable: true,
  });
}

function BuilderConnectProbe({
  enabled = true,
  popupUrl,
  provisionAccount = false,
  startProvisionAccount,
}: {
  enabled?: boolean;
  popupUrl?: string;
  provisionAccount?: boolean;
  startProvisionAccount?: boolean;
}) {
  const flow = useBuilderConnectFlow({
    enabled,
    popupUrl,
    provisionAccount,
  });
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          flow.start(
            startProvisionAccount === undefined
              ? undefined
              : { provisionAccount: startProvisionAccount },
          )
        }
      >
        Connect
      </button>
      {flow.connecting ? (
        <button
          type="button"
          data-testid="cancel-connect"
          onClick={flow.cancel}
        >
          Cancel
        </button>
      ) : null}
      <output data-testid="status">
        {flow.configured ? "configured" : "not-configured"}{" "}
        {flow.connecting ? "connecting" : "idle"}{" "}
        {flow.statusResolved ? "resolved" : "unresolved"}{" "}
        {flow.accountExists ? "account-exists" : "no-account-exists"}
      </output>
      <output>{flow.error ?? ""}</output>
    </div>
  );
}

function BuilderConnectPopoverProbe() {
  const flow = useBuilderConnectFlow();
  return (
    <BuilderConnectPopover flow={flow}>
      <button type="button">Connect</button>
    </BuilderConnectPopover>
  );
}

function BuilderStatusProbe() {
  const { status, loading, stale, error } = useBuilderStatus();
  return (
    <div>
      <output data-testid="builder-status">
        {loading ? "loading" : "loaded"}{" "}
        {status?.configured ? "configured" : "not-configured"}{" "}
        {stale ? "stale" : "fresh"}
      </output>
      <output>{error ?? ""}</output>
    </div>
  );
}

function createPopupStub() {
  const doc = document.implementation.createHTMLDocument("popup");
  const listeners = new Map<string, EventListener>();
  const addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.set(type, listener);
    },
  );
  const removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  );
  return {
    closed: false,
    close: vi.fn(),
    document: doc,
    location: { href: "" },
    opener: window,
    addEventListener,
    removeEventListener,
    fireLoad: () => listeners.get("load")?.(new Event("load")),
  } as unknown as Window & { fireLoad: () => void };
}

const signedConnectUrl =
  "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed";
const staleConnectUrl = signedConnectUrl.replace(
  "_an_connect=signed",
  "_an_connect=stale",
);
const refreshedConnectUrl = signedConnectUrl.replace(
  "_an_connect=signed",
  "_an_connect=refreshed",
);
const provisioningToken = "nonce.email.session.1700000000000.mac";

function popupAttemptId(popup: Window): string {
  const attemptId = new URL(popup.location.href).searchParams.get(
    "_an_connect_attempt",
  );
  if (!attemptId) throw new Error("Builder connect attempt ID was not set");
  return attemptId;
}

const connectedBuilderStatus = {
  configured: true,
  envManaged: false,
  builderEnabled: true,
  orgName: "Builder space",
  connectUrl:
    "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
  appHost: "https://builder.io",
  apiHost: "https://api.builder.io",
  publicKeyConfigured: true,
  privateKeyConfigured: true,
};

function expectedConnectUrl(url: string): string {
  return withBuilderConnectTrackingParams(url, {
    source: "builder_connect_flow",
    flow: "connect_llm",
  });
}

function expectedProvisionedConnectUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("_an_mode", "agent-native");
  parsed.searchParams.set("_an_provision", provisioningToken);
  return expectedConnectUrl(parsed.toString());
}

function withoutConnectAttempt(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("_an_connect_attempt");
  return parsed.toString();
}

describe("useBuilderStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setEmbeddedWindow(false);
    window.history.replaceState({}, "", "http://localhost:3000/settings");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("uses the neutral Builder connection-status route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(connectedBuilderStatus));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<BuilderStatusProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/connection-status/builder",
    );
  });

  it("keeps the last good Builder status when a refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(connectedBuilderStatus))
        .mockResolvedValueOnce(new Response("Not found", { status: 404 })),
    );

    await act(async () => {
      root.render(<BuilderStatusProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(container.textContent).toContain("loaded configured fresh");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("loaded configured stale");
    expect(container.textContent).toContain("Builder status unavailable (404)");
  });

  it("focus inside the deferral window consumes the scheduled initial read", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(connectedBuilderStatus));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<BuilderStatusProbe />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    // The focus refresh stays immediate and the scheduled initial read is
    // consumed, not stacked behind it.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flushAfterPaint();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("loaded configured fresh");
  });

  it("ignores an older refresh after a newer status request starts", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingResponses.push(resolve);
          }),
      ),
    );

    await act(async () => {
      root.render(<BuilderStatusProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();
    expect(pendingResponses).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pendingResponses).toHaveLength(2);

    await act(async () => {
      pendingResponses[1]?.(
        jsonResponse({ ...connectedBuilderStatus, configured: false }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("loaded not-configured fresh");

    await act(async () => {
      pendingResponses[0]?.(jsonResponse(connectedBuilderStatus));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("loaded not-configured fresh");
  });
});

describe("useBuilderConnectFlow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let openSpy: ReturnType<typeof vi.fn>;

  it("focus inside the deferral window consumes the scheduled read and supersedes overlapping refreshes", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingResponses.push(resolve);
          }),
      ),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    // One read lands immediately; the scheduled initial read was consumed
    // instead of stacking a duplicate when the window elapses.
    expect(pendingResponses).toHaveLength(1);

    await flushAfterPaint();
    expect(pendingResponses).toHaveLength(1);

    // Overlapping refreshes supersede each other: the newest started wins
    // even when the older response resolves last.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(pendingResponses).toHaveLength(2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(pendingResponses).toHaveLength(3);

    await act(async () => {
      pendingResponses[2]?.(jsonResponse(connectedBuilderStatus));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("configured idle resolved");

    await act(async () => {
      pendingResponses[0]?.(jsonResponse({ configured: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("configured idle resolved");
  });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setEmbeddedWindow(false);
    window.history.replaceState({}, "", "http://localhost:3000/settings");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      ),
    );
    openSpy = vi.fn(() => null);
    vi.stubGlobal("open", openSpy);
    vi.mocked(openMcpAppHostLink).mockReset();
    vi.mocked(openMcpAppHostLink).mockReturnValue(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls the neutral Builder connection-status route", async () => {
    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/_agent-native/connection-status/builder",
    );
  });

  it("opens a top-level blank popup and navigates to a freshly fetched connect URL", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "width=600,height=700",
    );
    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
    expect(container.textContent).not.toContain("Popup blocked");
  });

  it("waits for an embedded waiting popup before navigating to Builder", async () => {
    setEmbeddedWindow(true);
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/oauth/popup?"),
      "_blank",
      "width=600,height=700",
    );
    expect(popup.location.href).toBe("");

    await act(async () => {
      popup.fireLoad();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
  });

  it("cancels an embedded popup wait when the popup closes before loading", async () => {
    vi.useFakeTimers();
    setEmbeddedWindow(true);
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    (popup as unknown as { closed: boolean }).closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(popup.location.href).toBe("");
    expect(container.textContent).toContain(
      "Couldn't navigate the Builder popup",
    );
    expect(popup.removeEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );
  });

  it("cancels an embedded popup wait when the flow unmounts", async () => {
    vi.useFakeTimers();
    setEmbeddedWindow(true);
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => root.unmount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(popup.removeEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );
  });

  it("does not navigate an embedded popup after the connect attempt ends", async () => {
    vi.useFakeTimers();
    setEmbeddedWindow(true);
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    const disconnectedStatus = {
      configured: false,
      envManaged: false,
      builderEnabled: true,
      orgName: null,
      connectUrl: signedConnectUrl,
      appHost: "https://builder.io",
      apiHost: "https://api.builder.io",
      publicKeyConfigured: false,
      privateKeyConfigured: false,
    };
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(disconnectedStatus))
      .mockResolvedValueOnce(jsonResponse(disconnectedStatus))
      .mockResolvedValueOnce(jsonResponse(connectedBuilderStatus));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(container.textContent).toContain("configured idle resolved");

    await act(async () => {
      popup.fireLoad();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(popup.location.href).toBe("");
    expect(popup.close).toHaveBeenCalled();
  });

  it("marks the first-run popup for account provisioning", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        agentNativeProvisioningEnabled: true,
        agentNativeProvisioningToken: provisioningToken,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe provisionAccount />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedProvisionedConnectUrl(signedConnectUrl),
    );
    expect(
      new URL(popup.location.href).searchParams.get("_an_connect_attempt"),
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses the click-time provisioning capability instead of a stale closure", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          agentNativeProvisioningEnabled: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl: signedConnectUrl,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          agentNativeProvisioningEnabled: true,
          agentNativeProvisioningToken: provisioningToken,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl: signedConnectUrl,
        }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe provisionAccount />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedProvisionedConnectUrl(signedConnectUrl),
    );
    expect(
      new URL(popup.location.href).searchParams.get("_an_connect_attempt"),
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps account provisioning dormant when the server does not advertise it", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    await act(async () => {
      root.render(<BuilderConnectProbe provisionAccount />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
  });

  it("allows an existing-account click to bypass provisioning mode", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        agentNativeProvisioningEnabled: true,
        agentNativeProvisioningToken: provisioningToken,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
      }),
    );

    await act(async () => {
      root.render(
        <BuilderConnectProbe provisionAccount startProvisionAccount={false} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
  });

  it("surfaces a provisioning account collision as an existing-account state", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        agentNativeProvisioningEnabled: true,
        agentNativeProvisioningToken: provisioningToken,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
        connectError: {
          message:
            "A Builder account already exists for this email. Log in to connect it.",
          code: "account_exists",
          at: Date.now(),
        },
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe provisionAccount />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(container.textContent).toContain("account-exists");
  });

  it("falls back to the cached signed URL when the click-time status refresh fails", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      )
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "width=600,height=700",
    );
    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );
  });

  it("treats a successful click-time status refresh as authoritative", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("status unavailable"))
      .mockResolvedValueOnce(jsonResponse(connectedBuilderStatus));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(container.textContent).toContain("not-configured idle unresolved");

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("configured connecting resolved");
  });

  it("does not probe Builder status when disabled", async () => {
    await act(async () => {
      root.render(<BuilderConnectProbe enabled={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not treat a failed status request as a resolved disconnection", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("status unavailable"));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(container.textContent).toContain("not-configured idle unresolved");
    // A status we could not read must not render the same as a status we have
    // not asked for yet: the connect CTA stays inert until this resolves, so
    // the failure has to be visible rather than silently held.
    expect(container.textContent).toContain(
      "Couldn't reach Builder to check your account.",
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured idle resolved");
    expect(container.textContent).not.toContain("Couldn't reach Builder");
  });

  it("retries status from a connect trigger without bypassing consent", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("status unavailable"))
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          agentNativeProvisioningEnabled: true,
          agentNativeProvisioningToken: provisioningToken,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl: signedConnectUrl,
        }),
      );

    await act(async () => {
      root.render(<BuilderConnectPopoverProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector("[data-radix-popper-content-wrapper]"),
    ).toBeNull();
  });

  it("honors a connect click made while the first status read is still in flight", async () => {
    // The cold-start shape: the status route is reachable but slow, so the
    // trigger renders as a normal enabled button for seconds. A click there
    // used to be discarded, which is what "Connect Builder.io doesn't work"
    // looked like to a brand-new signup landing on a cold instance.
    const pending: Array<() => void> = [];
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() =>
            resolve(
              jsonResponse({
                configured: false,
                agentNativeProvisioningEnabled: true,
                agentNativeProvisioningToken: provisioningToken,
                envManaged: false,
                builderEnabled: true,
                orgName: null,
                connectUrl: signedConnectUrl,
              }),
            ),
          );
        }),
    );

    await act(async () => {
      root.render(<BuilderConnectPopoverProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("button")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      document.querySelector("[data-radix-popper-content-wrapper]"),
    ).toBeNull();

    await act(async () => {
      for (const release of pending) release();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Provisioning is available, so the queued click surfaces the consent
    // choice rather than silently starting a connect.
    expect(
      document.querySelector("[data-radix-popper-content-wrapper]"),
    ).not.toBeNull();
    expect(
      container.querySelector("button")?.getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("keeps surface callbacks on the legacy connection path", async () => {
    const flow = {
      connecting: false,
      statusResolved: true,
      agentNativeProvisioningEnabled: false,
      retry: vi.fn(),
      start: vi.fn(),
    };
    const onConnect = vi.fn();

    await act(async () => {
      root.render(
        <BuilderConnectPopover flow={flow} onConnect={onConnect}>
          <button type="button">Connect</button>
        </BuilderConnectPopover>,
      );
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(onConnect).toHaveBeenCalledWith(false);
    expect(flow.start).not.toHaveBeenCalled();
  });

  it("refreshes an un-timestamped signed prop URL before navigating web popups", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    let resolveInitialFetch!: (response: Response) => void;
    const initialFetch = new Promise<Response>((resolve) => {
      resolveInitialFetch = resolve;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(initialFetch)
      .mockResolvedValue(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=refreshed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe popupUrl={staleConnectUrl} />);
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "width=600,height=700",
    );
    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(refreshedConnectUrl),
    );

    resolveInitialFetch(jsonResponse({ configured: false }));
  });

  it("falls back to a signed prop URL when status has not loaded and click refresh fails", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    const signedConnectUrl =
      "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed-from-prop";

    let resolveInitialFetch!: (response: Response) => void;
    const initialFetch = new Promise<Response>((resolve) => {
      resolveInitialFetch = resolve;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(initialFetch)
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await act(async () => {
      root.render(<BuilderConnectProbe popupUrl={signedConnectUrl} />);
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "width=600,height=700",
    );
    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );

    resolveInitialFetch(jsonResponse({ configured: false }));
  });

  it("refreshes status when a Builder preview callback posts success", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          configured: true,
          envManaged: false,
          builderEnabled: true,
          orgName: "Builder space",
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: true,
          privateKeyConfigured: true,
        }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await flushAfterPaint();

    expect(container.textContent).toContain("not-configured");

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const attemptId = popupAttemptId(popup);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin:
            "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
          data: { type: "builder-connect-success", attemptId },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("configured");
  });

  it("ignores a success message from another connect attempt", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockResolvedValueOnce(jsonResponse({ configured: false }));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: {
            type: "builder-connect-success",
            attemptId: "stale-attempt",
          },
        }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");
  });

  it("keeps polling when callback confirmation status is unknown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockResolvedValue(new Response("unavailable", { status: 503 }));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const attemptId = popupAttemptId(popup);
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: { type: "builder-connect-success", attemptId },
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );
  });

  it("ignores duplicate callback success messages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockResolvedValueOnce(jsonResponse(connectedBuilderStatus))
      .mockResolvedValueOnce(jsonResponse({ configured: false }));

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const attemptId = popupAttemptId(popup);
      const message = new MessageEvent("message", {
        origin: "https://agent-workspace.builder.io",
        data: { type: "builder-connect-success", attemptId },
      });
      window.dispatchEvent(message);
      window.dispatchEvent(message);
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(container.textContent).toContain("configured idle resolved");
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );
  });

  it("keeps polling when the callback status remains not configured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl:
          "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");

    await act(async () => {
      const attemptId = popupAttemptId(popup);
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: { type: "builder-connect-success", attemptId },
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain("Didn't hear back from Builder");
  });

  it("keeps polling briefly after the popup closes in case status confirmation is slow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl:
          "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");

    (popup as unknown as { closed: boolean }).closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    // Still within the confirmation grace window: a real success can still land.
    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain("couldn't confirm");
  });

  it("resets the button after the popup closes without ever confirming credentials", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl:
          "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");

    (popup as unknown as { closed: boolean }).closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(26_000);
    });

    // No confirmation ever landed, so the button must stop spinning and become
    // clickable again instead of hanging until the 5-minute overall timeout.
    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain(
      "Didn't finish connecting to Builder.io",
    );

    const button = container.querySelector("button");
    expect(button?.disabled).toBe(false);

    // A retry click must work without a page reload.
    openSpy.mockClear();
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openSpy).toHaveBeenCalled();
  });

  it("resets after the desktop OAuth popup closes without a Window handle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 AgentNativeDesktop/1.0");
    let notifyPopupClosed: ((attemptId: string | null) => void) | null = null;
    Object.defineProperty(window, "agentNativeDesktop", {
      configurable: true,
      value: {
        oauth: {
          onPopupClosed: (callback: (attemptId: string | null) => void) => {
            notifyPopupClosed = callback;
            return () => {
              notifyPopupClosed = null;
            };
          },
        },
      },
    });

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");
    expect(openSpy).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(container.textContent).toContain("not-configured connecting");

    const openedUrl = (openSpy.mock.calls[0] as unknown as [string])[0];
    const attemptId = new URL(openedUrl).searchParams.get(
      "_an_connect_attempt",
    );
    expect(attemptId).toBeTruthy();
    await act(async () => {
      notifyPopupClosed?.(attemptId);
      await vi.advanceTimersByTimeAsync(24_000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain(
      "Didn't finish connecting to Builder.io",
    );
  });

  it("keeps a delayed desktop success when its OAuth popup closes itself", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 AgentNativeDesktop/1.0");
    let notifyPopupClosed: ((attemptId: string | null) => void) | null = null;
    Object.defineProperty(window, "agentNativeDesktop", {
      configurable: true,
      value: {
        oauth: {
          onPopupClosed: (callback: (attemptId: string | null) => void) => {
            notifyPopupClosed = callback;
            return () => {
              notifyPopupClosed = null;
            };
          },
        },
      },
    });

    let connectStartedAt = Date.now();
    vi.mocked(fetch).mockImplementation(async () => {
      const configured = Date.now() - connectStartedAt >= 45_000;
      return jsonResponse(
        configured
          ? connectedBuilderStatus
          : {
              configured: false,
              envManaged: false,
              builderEnabled: true,
              orgName: null,
              connectUrl: signedConnectUrl,
              appHost: "https://builder.io",
              apiHost: "https://api.builder.io",
              publicKeyConfigured: false,
              privateKeyConfigured: false,
            },
      );
    });

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      connectStartedAt = Date.now();
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const openedUrl = String(openSpy.mock.calls[0]?.[0]);
    const attemptId = new URL(openedUrl).searchParams.get(
      "_an_connect_attempt",
    );
    expect(attemptId).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: { type: "builder-connect-success", attemptId },
        }),
      );
      notifyPopupClosed?.(attemptId);
      await vi.advanceTimersByTimeAsync(26_000);
    });

    expect(container.textContent).toContain("configured idle resolved");
    expect(container.textContent).not.toContain(
      "Didn't finish connecting to Builder.io",
    );
  });

  it("ends the desktop popup wait when callback confirmation stays unconfigured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 AgentNativeDesktop/1.0");
    let notifyPopupClosed: ((attemptId: string | null) => void) | null = null;
    Object.defineProperty(window, "agentNativeDesktop", {
      configurable: true,
      value: {
        oauth: {
          onPopupClosed: (callback: (attemptId: string | null) => void) => {
            notifyPopupClosed = callback;
            return () => {
              notifyPopupClosed = null;
            };
          },
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const openedUrl = String(openSpy.mock.calls[0]?.[0]);
    const attemptId = new URL(openedUrl).searchParams.get(
      "_an_connect_attempt",
    );
    expect(attemptId).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: { type: "builder-connect-success", attemptId },
        }),
      );
      notifyPopupClosed?.(attemptId);
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(container.textContent).toContain("not-configured connecting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain(
      "Didn't finish connecting to Builder.io",
    );
  });

  it("asks Electron to close the matching OAuth window when cancelled", async () => {
    setUserAgent("Mozilla/5.0 AgentNativeDesktop/1.0");
    const cancelPopup = vi.fn();
    Object.defineProperty(window, "agentNativeDesktop", {
      configurable: true,
      value: {
        oauth: {
          cancelPopup,
          onPopupClosed: () => () => {},
        },
      },
    });

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await flushAfterPaint();
    await act(async () => {
      container.querySelector("button")?.click();
    });

    const openedUrl = String(openSpy.mock.calls[0]?.[0]);
    const attemptId = new URL(openedUrl).searchParams.get(
      "_an_connect_attempt",
    );
    expect(attemptId).toBeTruthy();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
    });
    expect(cancelPopup).toHaveBeenCalledWith(attemptId);
  });

  it("refreshes status but keeps waiting when system-browser focus returns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 AgentNativeDesktop/1.0");
    let notifySystemBrowserReturned:
      | ((attemptId: string | null) => void)
      | null = null;
    Object.defineProperty(window, "agentNativeDesktop", {
      configurable: true,
      value: {
        oauth: {
          onSystemBrowserReturned: (
            callback: (attemptId: string | null) => void,
          ) => {
            notifySystemBrowserReturned = callback;
            return () => {
              notifySystemBrowserReturned = null;
            };
          },
          onPopupClosed: () => () => {},
        },
      },
    });

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");
    const openedUrl = (openSpy.mock.calls[0] as unknown as [string])[0];
    const attemptId = new URL(openedUrl).searchParams.get(
      "_an_connect_attempt",
    );
    expect(attemptId).toBeTruthy();
    const fetchCountBeforeReturn = vi.mocked(fetch).mock.calls.length;

    await act(async () => {
      notifySystemBrowserReturned?.(attemptId);
      await vi.advanceTimersByTimeAsync(26_000);
    });

    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(
      fetchCountBeforeReturn,
    );
    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain("Didn't finish connecting");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
      await vi.advanceTimersByTimeAsync(24_000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain(
      "Didn't finish connecting to Builder.io",
    );
  });

  it("keeps a real success during the explicit cancel grace window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    const startedAt = Date.now();
    // Past the 20s popup-close grace window, but well within the
    // callback-success handler's own ~5s retry budget once the success
    // message lands at t=20s below.
    const configuredAfterMs = 24_200;
    vi.mocked(fetch).mockImplementation(async () => {
      const isConfigured = Date.now() - startedAt >= configuredAfterMs;
      return jsonResponse(
        isConfigured
          ? connectedBuilderStatus
          : {
              configured: false,
              envManaged: false,
              builderEnabled: true,
              orgName: null,
              connectUrl: signedConnectUrl,
              appHost: "https://builder.io",
              apiHost: "https://api.builder.io",
              publicKeyConfigured: false,
              privateKeyConfigured: false,
            },
      );
    });

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("not-configured connecting");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
    });
    expect(popup.close).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // removed debug

    // The success message lands right as the popup-close grace window would
    // otherwise be about to fire the cancellation.
    await act(async () => {
      const attemptId = popupAttemptId(popup);
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: { type: "builder-connect-success", attemptId },
        }),
      );
      await vi.advanceTimersByTimeAsync(6000);
    });
    // removed debug

    // The real connection must resolve, not get discarded by the popup-close
    // branch racing ahead of the callback-success retry loop.
    expect(container.textContent).toContain("configured idle resolved");
    expect(container.textContent).not.toContain("Didn't finish connecting");
  });

  it("allows cancellation after success confirmation retries exhaust", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: {
            type: "builder-connect-success",
            attemptId: popupAttemptId(popup),
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(container.textContent).toContain("not-configured connecting");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
      await vi.advanceTimersByTimeAsync(22_000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain(
      "Didn't finish connecting to Builder.io",
    );
  });

  it("releases the cancellation grace while callback status confirmation is stalled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    let stallNextStatus = false;
    let releaseStalledStatus: (() => void) | null = null;
    let callbackStatusSignal: AbortSignal | null = null;
    vi.mocked(fetch).mockImplementation((_input, init) => {
      if (stallNextStatus) {
        stallNextStatus = false;
        callbackStatusSignal = init?.signal ?? null;
        return new Promise<Response>((resolve) => {
          releaseStalledStatus = () =>
            resolve(
              jsonResponse({
                configured: false,
                envManaged: false,
                builderEnabled: true,
                orgName: null,
                connectUrl: signedConnectUrl,
                appHost: "https://builder.io",
                apiHost: "https://api.builder.io",
                publicKeyConfigured: false,
                privateKeyConfigured: false,
              }),
            );
        });
      }
      return Promise.resolve(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl: signedConnectUrl,
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      );
    });

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    stallNextStatus = true;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: {
            type: "builder-connect-success",
            attemptId: popupAttemptId(popup),
          },
        }),
      );
      await Promise.resolve();
    });
    expect(callbackStatusSignal).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
      await Promise.resolve();
    });
    expect(callbackStatusSignal?.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(22_000);
    });
    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain(
      "Didn't finish connecting to Builder.io",
    );
    releaseStalledStatus?.();
  });

  it("does not replace the desktop webview when Electron reports a handled popup as null", async () => {
    setUserAgent("Mozilla/5.0 Electron/41.2.2 AgentNativeDesktop/0.1.7");

    await act(async () => {
      root.render(<BuilderConnectProbe />);
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
    });

    const openedUrl = String(openSpy.mock.calls[0]?.[0]);
    expect(withoutConnectAttempt(openedUrl)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
    expect(new URL(openedUrl).searchParams.get("_an_connect_attempt")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(openSpy.mock.calls[0]?.slice(1)).toEqual([
      "_blank",
      "noopener,noreferrer",
    ]);
    expect(window.location.href).toBe("http://localhost:3000/settings");
    expect(container.textContent).not.toContain("Popup blocked");
  });

  it("asks the MCP host to open Builder when an embedded chat sandbox blocks popups", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    setEmbeddedWindow(true);
    vi.mocked(openMcpAppHostLink).mockResolvedValueOnce(true);
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=refreshed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/oauth/popup?"),
      "_blank",
      "width=600,height=700",
    );
    const hostUrl = String(vi.mocked(openMcpAppHostLink).mock.calls[0]?.[0]);
    expect(withoutConnectAttempt(hostUrl)).toBe(
      expectedConnectUrl(refreshedConnectUrl),
    );
    expect(new URL(hostUrl).searchParams.get("_an_connect_attempt")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain("Allow popups");
  });

  it("does not open the MCP host after cancelling a pending embedded startup", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    setEmbeddedWindow(true);
    let releaseStartupStatus: ((response: Response) => void) | undefined;
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseStartupStatus = resolve;
          }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    expect(releaseStartupStatus).toBeTypeOf("function");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
      releaseStartupStatus?.(jsonResponse({ configured: false }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openMcpAppHostLink).not.toHaveBeenCalled();
  });

  it("does not continue a browser popup startup after cancel", async () => {
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    let releaseStartupStatus: ((response: Response) => void) | undefined;
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ configured: false }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseStartupStatus = resolve;
          }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });
    await flushAfterPaint();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    expect(releaseStartupStatus).toBeTypeOf("function");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='cancel-connect']")
        ?.click();
      releaseStartupStatus?.(
        jsonResponse({ configured: false, connectUrl: signedConnectUrl }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("");
    expect(container.textContent).not.toContain(
      "Couldn't navigate the Builder popup",
    );
  });

  it("does not abort a reconnect popup because the old credential was rejected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    const signedConnectUrl =
      "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed";
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: true,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
        authError: {
          message: "Private key does not match spaceId",
          at: Date.now() - 60_000,
        },
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(container.textContent).toContain(
      "Private key does not match spaceId",
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "width=600,height=700",
    );
    expect(withoutConnectAttempt(popup.location.href)).toBe(
      expectedConnectUrl(signedConnectUrl),
    );
    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain(
      "Private key does not match spaceId",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain(
      "Private key does not match spaceId",
    );
  });

  it("ignores stale connect callback errors after starting a fresh reconnect", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);
    const signedConnectUrl =
      "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed";
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({
        configured: false,
        envManaged: false,
        builderEnabled: true,
        orgName: null,
        connectUrl: signedConnectUrl,
        appHost: "https://builder.io",
        apiHost: "https://api.builder.io",
        publicKeyConfigured: false,
        privateKeyConfigured: false,
        connectError: {
          message: "No active connect flow found",
          at: Date.now() - 60_000,
        },
      }),
    );

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(container.textContent).toContain("No active connect flow found");

    await act(async () => {
      container.querySelector("button")?.click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain("No active connect flow found");
  });
});
