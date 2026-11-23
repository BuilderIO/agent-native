import type { Browser, Page } from "@playwright/test";
import { expect, it, vi } from "vitest";

import { FlowContext } from "../e2e/phase1/runtime.js";
import { Evidence } from "../e2e/phase1/verdict.js";

function runner() {
  const evidence = new Evidence();
  const flow = new FlowContext({
    evidence,
    page: {} as Page,
    browser: {} as Browser,
    baseUrl: "http://localhost:4400",
    expectedSha: "a".repeat(40),
    evidenceDir: "unused",
    flowId: "12-graph-run-modes",
    states: {},
    ownerInitialState: { cookies: [], origins: [] },
  });
  return { evidence, flow, action: vi.spyOn(flow, "action") };
}

it("releases its resident draft kernel before the next flow needs the slot", async () => {
  const { evidence, flow, action } = runner();
  action
    .mockResolvedValueOnce({ id: "owned-project" })
    .mockResolvedValueOnce({ id: "no-kernel-project" })
    .mockResolvedValueOnce({
      status: "found",
      generation: "17",
      state: "idle",
    })
    .mockResolvedValueOnce({
      status: "found",
      generation: "0",
      state: "absent",
    })
    .mockImplementationOnce(async (_, input) => ({
      requestId: Reflect.get(input ?? {}, "requestId"),
      generation: "18",
      state: "stopped",
    }));
  await flow.createNotebookWithKernelCleanup("First flow's notebook");
  await flow.createNotebookWithKernelCleanup(
    "Second notebook without a kernel",
  );
  await expect(flow.releaseOwnedDraftKernels()).resolves.toBe(true);
  expect(action.mock.calls.slice(2)).toEqual([
    [
      "get-notebook-kernel-session",
      { scope: { kind: "draft", projectId: "owned-project" } },
    ],
    [
      "get-notebook-kernel-session",
      { scope: { kind: "draft", projectId: "no-kernel-project" } },
    ],
    [
      "control-notebook-kernel",
      {
        scope: { kind: "draft", projectId: "owned-project" },
        operation: "stop",
        expectedGeneration: "17",
        requestId: expect.any(String),
      },
    ],
  ]);
  expect(evidence.steps.map(({ status }) => status)).toEqual([
    "passed",
    "passed",
  ]);
  await expect(flow.releaseOwnedDraftKernels()).resolves.toBe(true);
  expect(action).toHaveBeenCalledTimes(5);
});

it("records an unknown kernel-close outcome as failed cleanup", async () => {
  const { evidence, flow, action } = runner();
  action
    .mockResolvedValueOnce({ id: "owned-project" })
    .mockResolvedValueOnce({
      status: "found",
      generation: "7",
      state: "busy",
    })
    .mockImplementationOnce(async (_, input) => ({
      requestId: Reflect.get(input ?? {}, "requestId"),
      generation: "8",
      state: "unknown",
    }));
  await flow.createNotebookWithKernelCleanup("Failed flow's notebook");
  await expect(flow.releaseOwnedDraftKernels()).resolves.toBe(false);
  expect(evidence.steps).toEqual([
    expect.objectContaining({
      label: "Release QA draft kernel",
      status: "failed",
    }),
  ]);
});
