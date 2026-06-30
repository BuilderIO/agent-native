// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  askUserQuestion,
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
} from "./guided-questions.js";

// The agent's `ask-question` action writes the guided-questions payload to a
// per-tab application-state key (`guided-questions:<tabId>`) whenever the run
// carries a browser tab id, which it almost always does. The client hook must
// therefore read the scoped key first (falling back to the bare key) and clear
// whichever key actually held the payload. These tests lock that contract so
// the clarifying-question card cannot silently stop rendering again.

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

type HookResult = ReturnType<typeof useGuidedQuestionFlow>;

describe("useGuidedQuestionFlow scoped reads", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }

  async function renderFlow(
    options: Parameters<typeof useGuidedQuestionFlow>[0],
  ): Promise<{ current: () => HookResult }> {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let latest: HookResult | null = null;
    function Harness() {
      latest = useGuidedQuestionFlow(options);
      return null;
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    // The query resolves asynchronously and then `setPayload` triggers a
    // re-render; pump microtasks/timers until the hook reports its questions.
    for (let i = 0; i < 20 && !latest?.questions; i += 1) {
      await flush();
    }
    return { current: () => latest as HookResult };
  }

  it("reads the tab-scoped key first when a browserTabId is provided", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const key = keyFromUrl(String(input));
        seen.push(key);
        // Only the scoped key holds the payload; the bare key is empty.
        if (key === "guided-questions:tab123") {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);
    expect(seen).toContain("guided-questions:tab123");
  });

  it("reads the bare key (no `:undefined` suffix) when no tab id is provided", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const key = keyFromUrl(String(input));
      seen.push(key);
      if (key === "guided-questions") {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });

    // The question renders from the bare key, and the hook must never probe a
    // malformed `guided-questions:undefined` key when there is no tab id.
    expect(result.current().questions?.length).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    const requestedKeys = fetchMock.mock.calls.map((call) =>
      keyFromUrl(String(call[0])),
    );
    expect(requestedKeys).toContain("guided-questions");
    expect(requestedKeys).not.toContain("guided-questions:undefined");
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

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().clear();
      await Promise.resolve();
    });
    await flush();

    expect(deleted).toContain("guided-questions:tab123");
  });

  // askUserQuestion() is the client-side twin of the agent's `ask-question`
  // tool: it writes a payload carrying a `clientResolveId`, and the mounted
  // hook resolves the caller's promise with the answer instead of forwarding
  // it to the agent chat. These lock that round-trip.
  function appStateFetchMock(store: Map<string, string>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = keyFromUrl(String(input));
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        store.set(key, String(init?.body ?? ""));
        return new Response("", { status: 200 });
      }
      if (method === "DELETE") {
        store.delete(key);
        return new Response("", { status: 200 });
      }
      return new Response(store.get(key) ?? "", { status: 200 });
    });
  }

  it("resolves with the selected value when the user submits", async () => {
    vi.stubGlobal("fetch", appStateFetchMock(new Map<string, string>()));

    const answer = askUserQuestion({
      question: "How long should this deck be?",
      options: [
        { label: "Short", value: "short" },
        { label: "Medium", value: "medium" },
      ],
      allowFreeText: false,
    });
    await flush(); // let the PUT land in the store

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });
    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().handleSubmit({ q1: "medium" });
      await Promise.resolve();
    });

    await expect(answer).resolves.toBe("medium");
  });

  it("resolves null when the user skips", async () => {
    vi.stubGlobal("fetch", appStateFetchMock(new Map<string, string>()));

    const answer = askUserQuestion({
      question: "How long should this deck be?",
      options: [
        { label: "Short", value: "short" },
        { label: "Medium", value: "medium" },
      ],
      allowFreeText: false,
    });
    await flush();

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });
    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().handleSkip();
      await Promise.resolve();
    });

    await expect(answer).resolves.toBeNull();
  });

  it("submits a single-select answer immediately when requested", async () => {
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <GuidedQuestionFlow
          title="Pick a direction"
          questions={[
            {
              id: "variant",
              type: "text-options",
              question: "Which screen should I keep?",
              required: true,
              allowOther: false,
              includeExplore: false,
              includeDecide: false,
              submitOnSelect: true,
              options: [
                { label: "Pure White", value: "pure-white" },
                { label: "Soft Cards", value: "soft-cards" },
              ],
            },
          ]}
          onSubmit={onSubmit}
          onSkip={vi.fn()}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Soft Cards"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({ variant: "soft-cards" });
  });
});
