// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openMcpAppHostLink } from "../mcp-app-host.js";
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
}: {
  enabled?: boolean;
  popupUrl?: string;
}) {
  const flow = useBuilderConnectFlow({ enabled, popupUrl });
  return (
    <div>
      <button type="button" onClick={() => flow.start()}>
        Connect
      </button>
      <output data-testid="status">
        {flow.configured ? "configured" : "not-configured"}{" "}
        {flow.connecting ? "connecting" : "idle"}
      </output>
      <output>{flow.error ?? ""}</output>
    </div>
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
  return {
    closed: false,
    close: vi.fn(),
    document: doc,
    location: { href: "" },
    opener: window,
  } as unknown as Window;
}

const signedCliAuthUrl =
  "https://builder.io/cli-auth?response_type=code&host=agent-native-browser&client_id=Agent%20Native%20Browser&redirect_url=https%3A%2F%2Fagent-workspace.builder.io%2Fdispatch%2F_agent-native%2Fbuilder%2Fcallback%3F_an_state%3Dsigned&preview_url=https%3A%2F%2Fagent-workspace.builder.io%2Fdispatch&framework=agent-native";
const staleCliAuthUrl = signedCliAuthUrl.replace(
  "_an_state%3Dsigned",
  "_an_state%3Dstale",
);
const refreshedCliAuthUrl = signedCliAuthUrl.replace(
  "_an_state%3Dsigned",
  "_an_state%3Drefreshed",
);

const connectedBuilderStatus = {
  configured: true,
  envManaged: false,
  builderEnabled: true,
  orgName: "Builder space",
  cliAuthUrl: signedCliAuthUrl,
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

    expect(container.textContent).toContain("loaded configured fresh");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("loaded configured stale");
    expect(container.textContent).toContain("Builder status unavailable (404)");
  });
});

describe("useBuilderConnectFlow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let openSpy: ReturnType<typeof vi.fn>;

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
          cliAuthUrl: signedCliAuthUrl,
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

  it("opens a blank web popup and navigates to a freshly fetched cli-auth URL", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    const popup = createPopupStub();
    openSpy.mockReturnValue(popup);

    await act(async () => {
      root.render(<BuilderConnectProbe />);
      await Promise.resolve();
      await Promise.resolve();
    });

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
    expect(popup.location.href).toBe(expectedConnectUrl(signedCliAuthUrl));
    expect(container.textContent).not.toContain("Popup blocked");
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
          cliAuthUrl: signedCliAuthUrl,
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
    expect(popup.location.href).toBe(expectedConnectUrl(signedCliAuthUrl));
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );
  });

  it("does not probe Builder status when disabled", async () => {
    await act(async () => {
      root.render(<BuilderConnectProbe enabled={false} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
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
          cliAuthUrl: refreshedCliAuthUrl,
          connectUrl:
            "http://localhost:3000/_agent-native/builder/connect?_an_connect=signed",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        }),
      );

    await act(async () => {
      root.render(<BuilderConnectProbe popupUrl={staleCliAuthUrl} />);
    });

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
    expect(popup.location.href).toBe(expectedConnectUrl(refreshedCliAuthUrl));

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
    expect(popup.location.href).toBe(expectedConnectUrl(signedConnectUrl));
    expect(container.textContent).not.toContain(
      "Couldn't start Builder connect",
    );

    resolveInitialFetch(jsonResponse({ configured: false }));
  });

  it("refreshes status when a Builder preview callback posts success", async () => {
    setUserAgent("Mozilla/5.0 Chrome/140.0");
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          configured: false,
          envManaged: false,
          builderEnabled: true,
          orgName: null,
          cliAuthUrl: signedCliAuthUrl,
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
          cliAuthUrl: signedCliAuthUrl,
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

    expect(container.textContent).toContain("not-configured");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin:
            "https://940ebc5a83164aa6a37dde445e494f3a-fluid-crack-ctnhvsyb.builderio.xyz",
          data: { type: "builder-connect-success" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("configured");
  });

  it("clears the spinner when the callback succeeds but status never confirms credentials", async () => {
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
        cliAuthUrl: signedCliAuthUrl,
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

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://agent-workspace.builder.io",
          data: { type: "builder-connect-success" },
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain("couldn't confirm");
  });

  it("clears the spinner when the popup closes before status confirms credentials", async () => {
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
        cliAuthUrl: signedCliAuthUrl,
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
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(container.textContent).toContain("not-configured idle");
    expect(container.textContent).toContain("couldn't confirm");
  });

  it("does not replace the desktop webview when Electron reports a handled popup as null", async () => {
    setUserAgent("Mozilla/5.0 Electron/41.2.2 AgentNativeDesktop/0.1.7");

    await act(async () => {
      root.render(<BuilderConnectProbe />);
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(openSpy).toHaveBeenCalledWith(
      expectedConnectUrl(signedCliAuthUrl),
      "_blank",
      "noopener,noreferrer",
    );
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
          cliAuthUrl: signedCliAuthUrl,
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
          cliAuthUrl: refreshedCliAuthUrl,
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
    expect(openMcpAppHostLink).toHaveBeenCalledWith(
      expectedConnectUrl(refreshedCliAuthUrl),
    );
    expect(container.textContent).toContain("not-configured connecting");
    expect(container.textContent).not.toContain("Allow popups");
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
    expect(popup.location.href).toBe(expectedConnectUrl(signedConnectUrl));
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
