// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { useNotebookResults } from "./useNotebookResults";

type Outputs = ReturnType<typeof useNotebookResults>["outputs"];

function attempt(status: "cancelled" | "complete") {
  return {
    attempt: { attemptId: "attempt-1", outputGeneration: 1, runId: "run-1" },
    state:
      status === "cancelled"
        ? { status }
        : { status, resultIds: [], completedAt: "2026-11-21T00:00:00.000Z" },
  };
}

async function readOutputs(status: "cancelled" | "complete") {
  let outputs: Outputs = {};
  function Probe() {
    outputs = useNotebookResults({
      identity: "cancelled-spec",
      projectId: "project-1",
      pythonCellIds: new Set(),
      execution: {
        cells: {
          "cell-1": { stale: true, resultId: null, attempt: attempt(status) },
        },
      } as never,
    }).outputs;
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <Probe />
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => root.unmount());
  host.remove();
  return outputs;
}

it("reports a cancelled SQL run as an interrupted query", async () => {
  expect((await readOutputs("cancelled"))["cell-1"]?.output).toEqual({
    type: "error",
    code: "interrupted",
    message: "Your query was interrupted",
    detail: null,
  });
});

it("does not report a completed run as interrupted", async () => {
  expect((await readOutputs("complete"))["cell-1"]?.output).toBeNull();
});
