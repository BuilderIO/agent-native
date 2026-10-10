import { nativeDraftForegroundStateSchema } from "@shared/native-shader-draft-foreground";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCanceledNativeShaderDraft,
  previewNativeShaderDraftInEditor,
} from "./native-shader-draft-foreground-client";
import { runNativeShaderDraftForeground } from "./use-native-shader-draft-foreground";

vi.mock("./native-shader-draft-foreground-client", () => ({
  previewNativeShaderDraftInEditor: vi.fn(),
  clearCanceledNativeShaderDraft: vi.fn(),
}));

const request = nativeDraftForegroundStateSchema.parse({
  schemaVersion: 1,
  requestId: "f7619969-b6d9-4a10-9aa7-c7d30739df53",
  designId: "design-owned",
  fileId: "screen-owned",
  nodeId: "node-owned",
  instanceId: "instance-owned",
  tabId: "tab-owned",
  expectedVersionHash: "100:abc",
  baseExecutionHash: "a".repeat(64),
  draftExecutionHash: "b".repeat(64),
  command: "preview",
  seed: 77,
  time: 1,
  status: "pending",
  issuedAt: 100,
  expiresAt: Date.now() + 30_000,
});

beforeEach(() => {
  vi.stubGlobal("window", {
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 2,
    clearTimeout: () => undefined,
  });
  vi.clearAllMocks();
});

describe("Agent-Native draft foreground delivery", () => {
  it("claims once and reports the located GPU result once, without source in the result", async () => {
    vi.mocked(previewNativeShaderDraftInEditor).mockResolvedValue({
      status: "last-good",
      displayed: "draft-last-good",
      diagnostics: [
        {
          code: "wgsl",
          message: "compile-failed",
          severity: "error",
          passId: "blur",
          line: 2,
          column: 61,
        },
      ],
    });
    const calls: Array<Record<string, unknown>> = [];
    await runNativeShaderDraftForeground({
      state: { ...request, expiresAt: Date.now() + 30_000 },
      designId: request.designId,
      tabId: request.tabId,
      signal: new AbortController().signal,
      readState: async () => ({ ...request, status: "running" }),
      invoke: async (input) => {
        calls.push(input);
        if (input.kind === "claim")
          return {
            ...request,
            status: "running",
            expiresAt: Date.now() + 30_000,
          };
        if (input.kind === "open")
          return {
            state: { ...request, status: "running" },
            payload: { definition: {}, params: {}, seed: 77, time: 1 },
          };
        return { ...request, status: "completed" };
      },
    });
    expect(calls.map((call) => call.kind)).toEqual(["claim", "open", "finish"]);
    expect(calls[2].result).toMatchObject({
      status: "last-good",
      diagnostics: [{ passId: "blur", line: 2, column: 61 }],
    });
  });

  it("reports a failed preview exactly once rather than retrying a successful finish", async () => {
    vi.mocked(previewNativeShaderDraftInEditor).mockRejectedValue(
      new Error("compile-failed"),
    );
    const calls: Array<Record<string, unknown>> = [];
    await expect(
      runNativeShaderDraftForeground({
        state: { ...request, expiresAt: Date.now() + 30_000 },
        designId: request.designId,
        tabId: request.tabId,
        signal: new AbortController().signal,
        readState: async () => ({ ...request, status: "running" }),
        invoke: async (input) => {
          calls.push(input);
          if (input.kind === "claim")
            return {
              ...request,
              status: "running",
              expiresAt: Date.now() + 30_000,
            };
          if (input.kind === "open")
            return {
              state: { ...request, status: "running" },
              payload: { definition: {}, params: {}, seed: 77, time: 1 },
            };
          return { ...request, status: "failed" };
        },
      }),
    ).rejects.toThrow("compile-failed");
    expect(calls.filter((call) => call.kind === "finish")).toHaveLength(1);
    expect(calls[2].result).toMatchObject({
      status: "error",
      displayed: "none",
    });
  });

  it("fences an aborted GPU draft with a fresh clear acknowledgement before marking it canceled", async () => {
    const controller = new AbortController();
    vi.mocked(previewNativeShaderDraftInEditor).mockImplementation(async () => {
      controller.abort();
      throw new Error("preview-aborted");
    });
    vi.mocked(clearCanceledNativeShaderDraft).mockResolvedValue();
    const calls: Array<Record<string, unknown>> = [];
    await expect(
      runNativeShaderDraftForeground({
        state: { ...request, expiresAt: Date.now() + 30_000 },
        designId: request.designId,
        tabId: request.tabId,
        signal: controller.signal,
        readState: async () => ({ ...request, status: "running" }),
        invoke: async (input) => {
          calls.push(input);
          if (input.kind === "claim")
            return {
              ...request,
              status: "running",
              expiresAt: Date.now() + 30_000,
            };
          if (input.kind === "open")
            return {
              state: { ...request, status: "running" },
              payload: { definition: {}, params: {}, seed: 77, time: 1 },
            };
          return {
            ...request,
            status: input.kind === "cancel" ? "cancel-requested" : "canceled",
          };
        },
      }),
    ).rejects.toThrow("preview-aborted");
    expect(calls.map((call) => call.kind)).toEqual([
      "claim",
      "open",
      "cancel",
      "cancel-complete",
    ]);
    expect(clearCanceledNativeShaderDraft).toHaveBeenCalledOnce();
  });

  it("does not report canceled when the runtime cannot acknowledge clear", async () => {
    const controller = new AbortController();
    vi.mocked(previewNativeShaderDraftInEditor).mockImplementation(async () => {
      controller.abort();
      throw new Error("preview-aborted");
    });
    vi.mocked(clearCanceledNativeShaderDraft).mockRejectedValue(
      new Error("clear-unavailable"),
    );
    const calls: string[] = [];
    await expect(
      runNativeShaderDraftForeground({
        state: { ...request, expiresAt: Date.now() + 30_000 },
        designId: request.designId,
        tabId: request.tabId,
        signal: controller.signal,
        readState: async () => ({ ...request, status: "running" }),
        invoke: async (input) => {
          calls.push(String(input.kind));
          if (input.kind === "claim")
            return {
              ...request,
              status: "running",
              expiresAt: Date.now() + 30_000,
            };
          if (input.kind === "open")
            return {
              state: { ...request, status: "running" },
              payload: { definition: {}, params: {}, seed: 77, time: 1 },
            };
          return { ...request, status: "cancel-requested" };
        },
      }),
    ).rejects.toThrow("clear-unavailable");
    expect(calls).toEqual(["claim", "open", "cancel"]);
  });
});
