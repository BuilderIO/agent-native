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

vi.mock("@agent-native/core/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/client")>();
  return {
    ...original,
    useT: () => (key: string) => key,
  };
});

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
      const url = String(input);
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

    // No agent-native:editor-chrome-ready message ever arrives (simulating
    // the bridge injecting nothing because it 409'd on the real navigation) —
    // advance past the ready-handshake watchdog window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    const registrationCallsAfterTimeout = registrationCallCount();
    // A second registration POST fired automatically — the silent
    // re-register/reload path — without ever surfacing an error.
    expect(registrationCallsAfterTimeout).toBeGreaterThanOrEqual(2);
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
  });

  it("does NOT tear down the iframe or show an error when /health reports the SAME bridgeInstanceId at the first 4s timeout — it re-arms the watchdog instead (regression coverage)", async () => {
    // /health always confirms the bridge process is the one we registered
    // with — a slow-but-healthy dev server (e.g. a 6-10s cold compile), not a
    // real failure. Before the fix under test, this used to be indistinguishable
    // from a genuine unknown-bridge-key bug and immediately tore the iframe
    // down (setRegisteredLiveEditBridgeKey(null)), flashing "Live editor
    // connection failed" under a load that was still legitimately in flight.
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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

    // Exactly one /health probe fired so far, and NEITHER error card is
    // shown. Crucially, no second registration POST fired either — a
    // same-instance-id "escalate" outcome must never touch
    // registeredLiveEditBridgeKey/reload the frame the way a genuine restart
    // ("reregister") does.
    expect(healthCallCount()).toBe(1);
    expect(registrationCallCount()).toBe(1);
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").not.toContain("Preparing live editor");
    const iframeSrc = container.querySelector("iframe")?.getAttribute("src");
    expect(iframeSrc).toContain("/live-edit");

    // Advance past the re-armed (longer, ~8s) wait: the watchdog must probe
    // /health again on its own rather than giving up after one attempt.
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
      const url = String(input);
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderLiveEditCanvas();

    // Escalation schedule: 4s, +8s, +16s, +16s, +16s (capped) — cumulative
    // wait crosses the ~48s ceiling on the 5th probe, around the 60s mark.
    // Advance in the same per-step chunks the real schedule uses (rather
    // than one huge jump) so each nested setTimeout scheduled from inside the
    // previous probe's async continuation is reliably due before the next
    // advance runs.
    for (const stepMs of [4200, 8200, 16200, 16200, 16200]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(stepMs);
        await flushMicrotasks();
      });
    }

    // The non-destructive card renders (same title copy as the destructive
    // card, since both describe the same user-facing situation), but the
    // live-edit iframe was never torn down: its src still points at the real
    // /live-edit document, not the blank "Preparing..." placeholder.
    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").not.toContain("Preparing live editor");
    const iframeSrc = container.querySelector("iframe")?.getAttribute("src");
    expect(iframeSrc).toContain("/live-edit");
    // No reregistration ever happened — this was a stalled-but-healthy same
    // process the whole time, never a genuine restart.
    expect(registrationCallCount()).toBe(1);

    // A late ready handshake still wins: the still-loading document finally
    // finished, and the error card must clear rather than staying stuck.
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
      const url = String(input);
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

    // /health being unreachable means the dev server process is genuinely
    // down, not just slow — this destructive path (tear down + surface the
    // error) is unchanged and still correct here.
    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").toContain(
      "Is the local dev server still running?",
    );
  });

  it("recovers from a destructive watchdog error when the exact retired live document posts ready late", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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
    expect(container.querySelector("iframe")?.getAttribute("src")).toBeNull();

    // Window identity is part of the recovery token: an otherwise well-formed
    // ready packet from another same-origin window cannot revive the key.
    await act(async () => {
      postReadyHandshake(window);
      await flushMicrotasks();
    });
    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );

    // The live document that the watchdog retired had already queued ready.
    // Its exact WindowProxy + bridge-key generation is allowed to restore the
    // registration, clearing both the error and the pending placeholder.
    await act(async () => {
      postReadyHandshake(retiredLiveWindow!);
      await flushMicrotasks();
    });
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
    expect(container.textContent ?? "").not.toContain("Preparing live editor");
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
      "/live-edit",
    );
  });

  it("does not loop forever when the bridge never confirms (attempt cap)", async () => {
    // /health always reports a fresh, distinct instance id — a pathological
    // bridge that appears to restart on every single probe. The retry budget
    // (MAX_LIVE_EDIT_RESTART_ATTEMPTS) must still cut this off with a visible
    // error rather than polling forever.
    let healthCallCounter = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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

    // Fire the watchdog repeatedly — each cycle re-registers, remounts, and
    // (since ready never arrives) times out again.
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
