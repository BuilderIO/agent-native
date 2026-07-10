// @vitest-environment happy-dom
//
// Behavioral coverage for the live-edit bridge auto-reconnect decision logic
// (see the shouldReregisterBridge doc comment in DesignCanvas.tsx). The
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

    const registrationCallsBeforeTimeout = fetchMock.mock.calls.filter(
      ([input]) => String(input).startsWith(`${BRIDGE_URL}/live-edit-bridge`),
    ).length;
    expect(registrationCallsBeforeTimeout).toBe(1);

    // No agent-native:editor-chrome-ready message ever arrives (simulating
    // the bridge injecting nothing because it 409'd on the real navigation) —
    // advance past the ready-handshake watchdog window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    const registrationCallsAfterTimeout = fetchMock.mock.calls.filter(
      ([input]) => String(input).startsWith(`${BRIDGE_URL}/live-edit-bridge`),
    ).length;
    // A second registration POST fired automatically — the silent
    // re-register/reload path — without ever surfacing an error.
    expect(registrationCallsAfterTimeout).toBeGreaterThanOrEqual(2);
    expect(container.textContent ?? "").not.toContain(
      "Live editor connection failed",
    );
  });

  it("surfaces the error/Retry UI when /health reports the SAME bridgeInstanceId (real bug, not a restart)", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
      await flushMicrotasks();
    });

    expect(container.textContent ?? "").toContain(
      "Live editor connection failed",
    );
  });

  it("does not loop forever when the bridge never confirms (attempt cap)", async () => {
    // /health always reports a fresh, distinct instance id — a pathological
    // bridge that appears to restart on every single probe. The retry budget
    // (MAX_LIVE_EDIT_RESTART_ATTEMPTS) must still cut this off with a visible
    // error rather than polling forever.
    let healthCallCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(`${BRIDGE_URL}/live-edit-bridge`)) {
        return jsonResponse({ ok: true, bridgeInstanceId: "instance-1" });
      }
      if (url.startsWith(`${BRIDGE_URL}/health`)) {
        healthCallCount += 1;
        return jsonResponse({
          ok: true,
          bridgeInstanceId: `instance-restart-${healthCallCount}`,
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
