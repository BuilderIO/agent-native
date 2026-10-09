// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentNativeEmbeddedBrowserSession } from "./AgentNativeEmbedded.js";

const embeddedSession = { id: "embedded-session" };

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness({
  fetch,
  onError,
  onReady,
}: {
  fetch: typeof fetch;
  onError: (error: unknown, source: "heartbeat" | "poll") => void;
  onReady: () => void;
}) {
  useAgentNativeEmbeddedBrowserSession({
    screen: false,
    session: embeddedSession,
    browserSession: {
      sessionId: "embedded-session",
      heartbeatMs: 20,
      pollMs: 20,
      fetch,
      onError,
      onReady,
    },
  });
  return null;
}

describe("useAgentNativeEmbeddedBrowserSession", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
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

  it("updates the error callback without restarting the browser session", async () => {
    let failRequests = false;
    let deleteRequests = 0;
    const fetchMock = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        if (init?.method === "DELETE") {
          deleteRequests++;
          return response({ ok: true });
        }
        if (failRequests) {
          return {
            ok: false,
            status: 503,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          } as Response;
        }
        if (url.endsWith("/requests/claim")) {
          return response({ ok: true, request: null });
        }
        return response({
          ok: true,
          session: { sessionId: "embedded-session", active: true },
        });
      },
    );
    const firstErrorHandler = vi.fn();
    const nextErrorHandler = vi.fn();
    const onReady = vi.fn();
    const sharedProps = {
      fetch: fetchMock as unknown as typeof fetch,
      onReady,
    };

    await act(async () => {
      root.render(<Harness {...sharedProps} onError={firstErrorHandler} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => {
      root.render(<Harness {...sharedProps} onError={nextErrorHandler} />);
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(deleteRequests).toBe(0);

    failRequests = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(nextErrorHandler).toHaveBeenCalled();
    expect(firstErrorHandler).not.toHaveBeenCalled();
    expect(deleteRequests).toBe(0);
  });
});
