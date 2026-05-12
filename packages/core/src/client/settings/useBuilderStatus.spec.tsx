// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderConnectFlow } from "./useBuilderStatus.js";

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

function BuilderConnectProbe() {
  const flow = useBuilderConnectFlow();
  return (
    <div>
      <button type="button" onClick={flow.start}>
        Connect
      </button>
      <output>{flow.error ?? ""}</output>
    </div>
  );
}

describe("useBuilderConnectFlow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
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
      expect.stringContaining("/_agent-native/builder/connect"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.location.href).toBe("http://localhost:3000/settings");
    expect(container.textContent).not.toContain("Popup blocked");
  });
});
