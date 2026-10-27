// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useOnboardingChecklist,
  type UseOnboardingChecklistResult,
} from "./use-onboarding-checklist.js";

const appState = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("../application-state.js", () => ({
  readClientAppState: appState.read,
  writeClientAppState: appState.write,
}));

const summary = {
  steps: [
    { id: "a", title: "A", complete: true, order: 1, required: false },
    { id: "b", title: "B", complete: false, order: 2, required: false },
  ],
  dismissed: false,
};

describe("useOnboardingChecklist", () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: UseOnboardingChecklistResult;
  const fetchMock = vi.fn();

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  async function mount() {
    function Probe() {
      latest = useOnboardingChecklist("getting-started");
      return null;
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await settle();
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockReset();
    appState.read.mockReset().mockResolvedValue(null);
    appState.write.mockReset().mockResolvedValue({});
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("reads the named checklist and counts completed steps", async () => {
    fetchMock.mockResolvedValue(Response.json(summary));
    await mount();

    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "/_agent-native/onboarding/summary?checklist=getting-started",
    );
    expect(latest.status).toBe("ready");
    expect(latest.completeCount).toBe(1);
    expect(latest.totalCount).toBe(2);
    expect(latest.collapsed).toBe(false);
  });

  it("reports an error instead of an empty checklist when the read fails", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await mount();

    expect(latest.status).toBe("error");
    expect(latest.totalCount).toBe(0);
  });

  it("hides on dismiss and shows the checklist again when the write fails", async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Response("{}", { status: 500 })
        : Response.json(summary),
    );
    await mount();

    await act(async () => {
      await latest.dismiss().catch(() => undefined);
    });
    await settle();

    expect(latest.dismissed).toBe(false);
  });

  it("keeps dismissal once the write succeeds", async () => {
    let dismissed = false;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        dismissed = true;
        return Response.json({ ok: true });
      }
      return Response.json({ ...summary, dismissed });
    });
    await mount();

    await act(async () => {
      await latest.dismiss();
    });
    await settle();

    expect(latest.dismissed).toBe(true);
  });

  it("restores the collapsed state when saving it fails", async () => {
    fetchMock.mockResolvedValue(Response.json(summary));
    appState.write.mockRejectedValue(new Error("offline"));
    await mount();

    await act(async () => {
      await latest.setCollapsed(true).catch(() => undefined);
    });

    expect(latest.collapsed).toBe(false);
  });
});
