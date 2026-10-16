// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ status: "loading" }));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ status: session.status }),
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent: vi.fn() }));

import { useDeckAccessStatus } from "./use-deck-access";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  session.status = "loading";
  vi.unstubAllGlobals();
});

it.each(["authenticated", "unauthenticated"])(
  "waits for confirmed %s identity before reading deck access",
  async (status) => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            exists: true,
            hasAccess: true,
            signedIn: status === "authenticated",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      () => useDeckAccessStatus("deck-example"),
      { wrapper },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
    session.status = "unavailable";
    rerender();
    expect(fetchMock).not.toHaveBeenCalled();
    session.status = status;
    rerender();
    await waitFor(() =>
      expect(result.current.data).toEqual({
        exists: true,
        hasAccess: true,
        signedIn: status === "authenticated",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "get-deck-access-status?deckId=deck-example",
    );
  },
);
