// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
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
    act(() => conversations!.click());

    await vi.waitFor(() => {
      expect(container.textContent).toContain("run-prom");
    });

    const row = container.querySelector("tbody tr") as HTMLTableRowElement;
    expect(row).toBeTruthy();
    act(() => row.click());

    await vi.waitFor(() => {
      const promote = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Promote to eval",
      );
      expect(promote).toBeTruthy();
      expect(promote?.disabled).toBe(false);
    });

    const promote = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Promote to eval",
    );
    expect(promote).toBeTruthy();
    act(() => promote!.click());

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Eval dataset ds-99");
      expect(container.textContent).toContain(
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
