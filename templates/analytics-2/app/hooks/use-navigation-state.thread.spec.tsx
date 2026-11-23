// @vitest-environment happy-dom
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { expect, it, vi } from "vitest";

import { TAB_ID } from "../lib/tab-id";
import { useNavigationState } from "./use-navigation-state";

it("opens the tab's queued project command from a background thread", async () => {
  const state: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const query = url.split("?keys=")[1];
      if (query) {
        const keys = query.split(",").map(decodeURIComponent);
        const values = Object.fromEntries(
          keys.filter((key) => key in state).map((key) => [key, state[key]]),
        );
        return Response.json({
          values,
          missing: keys.filter((key) => !(key in state)),
        });
      }
      if (init?.method === "POST") {
        const { writes } = JSON.parse(String(init.body));
        return Response.json({
          results: writes.map(
            (write: { key: string; value?: unknown; delete?: boolean }) => {
              if (write.delete) delete state[write.key];
              else state[write.key] = write.value;
              return { ok: true, value: write.value ?? { ok: true } };
            },
          ),
        });
      }
      const key = url.split("/_agent-native/application-state/")[1] ?? "";
      if (init?.method === "DELETE") delete state[key];
      if (init?.method === "PUT") state[key] = JSON.parse(String(init.body));
      return Response.json(state[key] ?? null);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  function Page() {
    useNavigationState();
    return <span>{useLocation().pathname}</span>;
  }
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/thread/ask-1"]}>
            <Page />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(
        client.getQueryState(["navigate-command", TAB_ID, "navigate"])?.status,
      ).toBe("success");
    });
    focusManager.setFocused(false);
    state[`navigate:${TAB_ID}`] = {
      path: "/project/prj_target/latest",
      _writeId: "one",
    };
    state["navigate:other-tab"] = { path: "/project/wrong/latest" };
    await vi.waitFor(
      async () => {
        await act(async () => {});
        expect(element.textContent).toBe("/project/prj_target/latest");
      },
      { timeout: 2500 },
    );
    expect(state["navigate:other-tab"]).toBeDefined();
  } finally {
    act(() => root.unmount());
    client.clear();
    focusManager.setFocused(undefined);
    element.remove();
    vi.unstubAllGlobals();
  }
});
