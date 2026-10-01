// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObservabilityDashboard } from "./ObservabilityDashboard.js";

const TRACE = {
  runId: "run-promote-1",
  threadId: "thread-1",
  totalSpans: 2,
  llmCalls: 1,
  toolCalls: 1,
  successfulTools: 1,
  failedTools: 0,
  totalDurationMs: 1200,
  totalCostCentsX100: 10,
  totalInputTokens: 8,
  totalOutputTokens: 4,
  model: "test-model",
  createdAt: Date.now(),
};

const RUN = {
  runId: TRACE.runId,
  threadId: TRACE.threadId,
  createdAt: TRACE.createdAt,
  ownerEmail: "owner@example.com",
  label: "chat",
  model: TRACE.model,
  prompt: "Say hello",
  status: "success",
  tokens: {
    inputTokens: 8,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  cost: {
    cacheReadCents: 0,
    cacheWriteCents: 0,
    uncachedInputCents: 0.05,
    outputCents: 0.05,
    totalCents: 0.1,
    estimatedCents: 0.1,
    noCacheCents: 0.1,
  },
  modelCalls: 1,
  tools: [{ name: "search-docs", calls: 1, failed: 0, error: null }],
  restarts: {
    count: 0,
    cents: 0,
    byCause: {
      "tool-lookup": { count: 0, cents: 0 },
      "prefix-changed": { count: 0, cents: 0 },
    },
  },
  parallel: { calls: 0, savedMs: 0 },
  recoveredErrors: 0,
  durationMs: TRACE.totalDurationMs,
  feedback: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/_agent-native/actions/get-usage-insights")) {
        return Promise.resolve(
          jsonResponse({
            sinceDays: 7,
            current: { runs: 1, tokens: RUN.tokens, cost: RUN.cost },
            previous: { runs: 0, tokens: RUN.tokens, cost: RUN.cost },
            runs: [RUN],
          }),
        );
      }
      if (url.includes("/_agent-native/actions/get-usage-run")) {
        return Promise.resolve(
          jsonResponse({ ...RUN, reply: "hello", turns: [], scores: [] }),
        );
      }
      if (url.includes("/traces/run-promote-1/promote") && method === "POST") {
        return Promise.resolve(
          jsonResponse({
            sourceRunId: "run-promote-1",
            dataset: { id: "ds-99", name: "from-trace:run-promote-1" },
            eval: {
              name: "from-trace:run-prom",
              input: { prompt: "hello" },
              threshold: 0.5,
            },
          }),
        );
      }
      if (url.includes("/traces/run-promote-1") && method === "GET") {
        return Promise.resolve(
          jsonResponse({
            summary: TRACE,
            spans: [
              {
                id: "span-1",
                runId: TRACE.runId,
                threadId: TRACE.threadId,
                parentSpanId: null,
                spanType: "tool_call",
                name: "search-docs",
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costCentsX100: 0,
                durationMs: 40,
                status: "success",
                errorMessage: null,
                metadata: null,
                createdAt: TRACE.createdAt,
              },
            ],
          }),
        );
      }
      if (url.includes("/traces?") && method === "GET") {
        return Promise.resolve(jsonResponse([TRACE]));
      }
      if (url.includes("/evals/stats")) {
        return Promise.resolve(
          jsonResponse({ totalEvals: 0, avgScore: 0, byCriteria: [] }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          totalRuns: 1,
          totalCostCents: 0.1,
          avgDurationMs: 10,
          toolSuccessRate: 1,
          avgFrustrationScore: 0,
          thumbsUpRate: 1,
          avgEvalScore: 0.9,
        }),
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  queryClient.clear();
});

function bodyButton(text: string) {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith(text),
  );
}

function renderDashboard() {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ObservabilityDashboard />
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    );
  });
}

describe("ObservabilityDashboard promote control", () => {
  it("promotes the selected trace and shows the dataset id plus CLI hint", async () => {
    renderDashboard();

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Conversations");
    });

    const conversations = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Conversations"),
    );
    expect(conversations).toBeTruthy();
    act(() =>
      conversations!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Say hello");
    });

    const promptRow = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.startsWith("Say hello"),
    );
    act(() => promptRow!.click());

    await vi.waitFor(() => {
      expect(bodyButton("Raw trace")).toBeTruthy();
    });
    act(() => bodyButton("Raw trace")!.click());

    await vi.waitFor(() => {
      const promote = bodyButton("Promote to eval");
      expect(promote).toBeTruthy();
      expect(promote?.disabled).toBe(false);
    });

    const promote = bodyButton("Promote to eval");
    const mustContain = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Text to check for in the promoted eval reply"]',
    );
    expect(mustContain?.placeholder).toBe(
      "Optional text to check for in the reply…",
    );
    act(() => promote!.click());

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Eval dataset ds-99");
      expect(document.body.textContent).toContain(
        "agent-native eval promote run-promote-1 --write evals/from-trace.eval.ts",
      );
    });

    const promoteCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/traces/run-promote-1/promote") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(promoteCall).toBeTruthy();
  });
});
