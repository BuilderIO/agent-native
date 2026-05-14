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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens the signed Builder cli-auth URL directly", async () => {
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
    });

    expect(openSpy).toHaveBeenCalledWith(
      signedCliAuthUrl,
      "_blank",
      "width=600,height=700",
    );
    expect(popup.location.href).toBe("");
    expect(container.textContent).not.toContain("Popup blocked");
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
      signedCliAuthUrl,
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.location.href).toBe("http://localhost:3000/settings");
    expect(container.textContent).not.toContain("Popup blocked");
  });
});
