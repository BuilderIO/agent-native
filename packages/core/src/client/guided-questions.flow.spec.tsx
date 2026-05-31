import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { useGuidedQuestionFlow } from "./guided-questions.js";

// The agent's `ask-question` action writes the guided-questions payload to a
// per-tab application-state key (`guided-questions:<tabId>`) whenever the run
// carries a browser tab id, which it almost always does. The client hook must
// therefore read the scoped key first (falling back to the bare key) and clear
// whichever key actually held the payload. These tests lock that contract so
// the clarifying-question card can't silently stop rendering again.

vi.mock("./agent-chat.js", () => ({
  sendToAgentChat: vi.fn(),
}));

const STATE_PREFIX = "/_agent-native/application-state/";

function keyFromUrl(url: string): string {
  const idx = url.indexOf(STATE_PREFIX);
  return idx >= 0 ? url.slice(idx + STATE_PREFIX.length) : url;
}

const payload = {
  questions: [
    {
      id: "q1",
      type: "text-options" as const,
      question: "Which range?",
      options: [{ label: "7d", value: "7d" }],
    },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe("useGuidedQuestionFlow scoped reads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the tab-scoped key when a browserTabId is provided", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const key = keyFromUrl(url);
        seen.push(key);
        // Only the scoped key holds the payload; the bare key is empty.
        if (key === "guided-questions:tab123") {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );

    const { result } = renderHook(
      () =>
        useGuidedQuestionFlow({
          stateKey: "guided-questions",
          queryKey: ["guided-questions"],
          browserTabId: "tab123",
          refetchInterval: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.questions?.length).toBe(1);
    });
    expect(seen).toContain("guided-questions:tab123");
  });

  it("falls back to the bare key when no tab id is provided", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const key = keyFromUrl(String(input));
        seen.push(key);
        if (key === "guided-questions") {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );

    const { result } = renderHook(
      () =>
        useGuidedQuestionFlow({
          stateKey: "guided-questions",
          queryKey: ["guided-questions"],
          refetchInterval: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.questions?.length).toBe(1);
    });
    expect(seen).toContain("guided-questions");
    expect(seen).not.toContain("guided-questions:undefined");
  });

  it("DELETEs the scoped key on clear so the card does not reappear", async () => {
    const deleted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const key = keyFromUrl(String(input));
        if (init?.method === "DELETE") {
          deleted.push(key);
          return new Response("", { status: 200 });
        }
        if (key === "guided-questions:tab123") {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );

    const { result } = renderHook(
      () =>
        useGuidedQuestionFlow({
          stateKey: "guided-questions",
          queryKey: ["guided-questions"],
          browserTabId: "tab123",
          refetchInterval: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.questions?.length).toBe(1);
    });

    result.current.clear();

    await waitFor(() => {
      expect(deleted).toContain("guided-questions:tab123");
    });
  });
});
