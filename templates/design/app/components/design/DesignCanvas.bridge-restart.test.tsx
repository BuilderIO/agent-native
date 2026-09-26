// @vitest-environment happy-dom
//
// Behavioral coverage for the live-edit bridge auto-reconnect decision logic
// (see the classifyLiveEditHealthProbe doc comment in DesignCanvas.tsx). The
// authenticated live-edit iframe is a real cross-origin navigation, so this
// component can never read a 409 "unknown-bridge-key" response body directly
// — it instead watches for the missing agent-native:editor-chrome-ready
// handshake and probes /health to compare bridgeInstanceId. These tests drive
// that flow end-to-end through mocked fetch responses rather than importing
// the (intentionally unexported, see DesignCanvas.refreshBoundary.test.ts)
// pure decision function directly.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const BRIDGE_URL = "http://127.0.0.1:7331";
const PREVIEW_TOKEN = "preview-token";
const PREVIEW_URL = "http://localhost:5173/forms";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

async function flushMicrotasks(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("DesignCanvas live-edit bridge restart detection", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderLiveEditCanvas() {
    await act(async () => {
      root.render(
        <DesignCanvas
          content={PREVIEW_URL}
          contentKey="screen-a"
          screenId="screen-a"
          sourceType="localhost"
          bridgeUrl={BRIDGE_URL}
          previewToken={PREVIEW_TOKEN}
          liveEditCapability="bridge-restart-live-capability"
          liveEditRegistrationCapability="bridge-restart-registration-capability"
          zoom={100}
          deviceFrame="none"
          interactMode={false}
          editMode
          readOnly={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });
  }

  function healthCallCount() {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith(`${BRIDGE_URL}/health`),
    ).length;
  }

  function registrationCallCount() {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith(`${BRIDGE_URL}/live-edit-bridge`),
    ).length;
  }

  function postReadyHandshake(source?: Window) {
    const iframeWindow =
      source ?? container.querySelector("iframe")?.contentWindow;
    if (!iframeWindow) {
      throw new Error("expected a live-edit iframe window");
    }
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "agent-native:editor-chrome-ready" },
        origin: BRIDGE_URL,
        source: iframeWindow,
      }),
    );
  }

  it("silently re-registers and reloads the frame when /health reports a different bridgeInstanceId (bridge process restarted)", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-2" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();

    const registrationCallsBeforeTimeout = registrationCallCount();
    expect(registrationCallsBeforeTimeout).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    const registrationCallsAfterTimeout = registrationCallCount();
    expect(registrationCallsAfterTimeout).toBeGreaterThanOrEqual(2);
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
  });

  it("does NOT tear down the iframe or show an error when /health reports the SAME bridgeInstanceId at the first 4s timeout — it re-arms the watchdog instead (regression coverage)", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();
    expect(registrationCallCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    expect(healthCallCount()).toBe(1);
    expect(registrationCallCount()).toBe(1);
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").toContain("Preparing live editor");
    const iframeSrc = container.querySelector("iframe")?.getAttribute("src");
    expect(iframeSrc).toContain("/live-edit");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8200);
      await flushMicrotasks();
    });
    expect(healthCallCount()).toBeGreaterThanOrEqual(2);
    expect(registrationCallCount()).toBe(1);
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
  });

  it("surfaces a NON-destructive error once the same-instance-id escalation ceiling is exceeded, without nulling registeredLiveEditBridgeKey — and a late ready handshake still clears it", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();

    for (const stepMs of [4200, 8200, 16200, 16200, 16200]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(stepMs);
        await flushMicrotasks();
      });
    }

    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").not.toContain("Preparing live editor");
    const iframeSrc = container.querySelector("iframe")?.getAttribute("src");
    expect(iframeSrc).toContain("/live-edit");
    expect(registrationCallCount()).toBe(1);

    await act(async () => {
      postReadyHandshake();
      await flushMicrotasks();
    });
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
  });

  it("tears down the iframe and surfaces the destructive error when /health itself is unreachable (dev server actually down)", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        return Promise.reject(new Error("network error probing /health"));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").toContain(
      "Is the local dev server still running?",
    );
  });

  it("recovers from a destructive watchdog error when the exact retired live document posts ready late", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        return Promise.reject(new Error("temporary health probe failure"));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();
    const liveIframe = container.querySelector("iframe");
    const retiredLiveWindow = liveIframe?.contentWindow;
    expect(retiredLiveWindow).toBeTruthy();
    expect(liveIframe?.getAttribute("src")).toContain("/live-edit");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
    expect(container.querySelector("iframe")).toBeNull();

    // Window identity is part of the recovery token: an otherwise well-formed
    // ready packet from another same-origin window cannot revive the key.
    await act(async () => {
      postReadyHandshake(window);
      await flushMicrotasks();
    });
    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );

    await act(async () => {
      postReadyHandshake(retiredLiveWindow!);
      await flushMicrotasks();
    });
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").toContain("Preparing live editor");
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
      "/live-edit",
    );
  });

  it("does not loop forever when the bridge never confirms (attempt cap)", async () => {
    let healthCallCounter = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        healthCallCounter += 1;
        return jsonResponse({
          ok: true,
          bridgeInstanceId: `instance-restart-${healthCallCounter}`,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();

    for (let cycle = 0; cycle < 6; cycle += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
        await flushMicrotasks();
      });
    }

    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
  });
});
