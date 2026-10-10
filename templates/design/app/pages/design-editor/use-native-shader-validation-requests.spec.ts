import type { NativeShaderValidationState } from "@shared/native-shader-validation";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runNativeShaderValidationRequest } from "./use-native-shader-validation-requests";

const item = {
  caseId: "grain-square",
  instanceId: "instance-1",
  nodeId: "hero",
  definitionId: "grain",
  definitionVersion: 2,
  executionHash: "a".repeat(64),
  timeSeconds: 0,
};

const pending: NativeShaderValidationState = {
  schemaVersion: 1,
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  designId: "design-1",
  fileId: "screen-1",
  tabId: "tab-1",
  expectedVersionHash: "v1",
  cases: [item],
  status: "pending",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 90_000,
};

afterEach(() => vi.unstubAllGlobals());

describe("foreground GPU validation request", () => {
  it("reports validation-complete only after the exact claimed case finishes", async () => {
    vi.stubGlobal("window", {
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    const claimed: NativeShaderValidationState = {
      ...pending,
      status: "running",
      expiresAt: Date.now() + 45_000,
    };
    const invoke = vi.fn(async (name: string) =>
      name === "claim-native-shader-validation"
        ? claimed
        : { status: "validation-complete" },
    );
    await runNativeShaderValidationRequest({
      request: pending,
      designId: "design-1",
      tabId: "tab-1",
      signal: new AbortController().signal,
      validate: async () => [
        {
          caseId: item.caseId,
          definitionId: item.definitionId,
          definitionVersion: item.definitionVersion,
          executionHash: item.executionHash,
          backend: "webgpu",
          status: "ready",
          frames: 1,
          sourceCaptures: 0,
          estimatedResourceBytes: 1024,
        },
      ],
      invoke,
      readState: async () => claimed,
    });
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "finish-native-shader-validation",
      {
        designId: "design-1",
        requestId: pending.requestId,
        result: {
          status: "validation-complete",
          results: [
            expect.objectContaining({
              caseId: "grain-square",
              status: "ready",
            }),
          ],
        },
      },
    );
  });

  it("does not report validation-complete when a case is omitted", async () => {
    vi.stubGlobal("window", {
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    const claimed = {
      ...pending,
      status: "running" as const,
      expiresAt: Date.now() + 45_000,
    };
    const invoke = vi.fn(async (name: string) =>
      name === "claim-native-shader-validation"
        ? claimed
        : { status: "failed" },
    );
    await expect(
      runNativeShaderValidationRequest({
        request: pending,
        designId: "design-1",
        tabId: "tab-1",
        signal: new AbortController().signal,
        validate: async () => [],
        invoke,
        readState: async () => claimed,
      }),
    ).rejects.toThrow("every requested case");
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "finish-native-shader-validation",
      {
        designId: "design-1",
        requestId: pending.requestId,
        result: expect.objectContaining({ status: "failed" }),
      },
    );
  });

  it("preserves a reviewed fault code while ordinary failures stay generic", async () => {
    vi.stubGlobal("window", {
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    const faultItem = {
      ...item,
      presentationFault: "simulated-gpu-validation" as const,
    };
    for (const [cases, expectedCode] of [
      [[faultItem], "presentation-fault-mirror-unavailable"],
      [[item], "render-failed"],
    ] as const) {
      const request = { ...pending, cases: [...cases] };
      const claimed: NativeShaderValidationState = {
        ...request,
        status: "running",
        expiresAt: Date.now() + 45_000,
      };
      const invoke = vi.fn(async (name: string) =>
        name === "claim-native-shader-validation"
          ? claimed
          : { status: "failed" },
      );
      const failure = Object.assign(
        new Error("The reviewed mirror is missing."),
        { code: "presentation-fault-mirror-unavailable" },
      );
      await expect(
        runNativeShaderValidationRequest({
          request,
          designId: "design-1",
          tabId: "tab-1",
          signal: new AbortController().signal,
          validate: async () => {
            throw failure;
          },
          invoke,
          readState: async () => claimed,
        }),
      ).rejects.toBe(failure);
      expect(invoke).toHaveBeenNthCalledWith(
        2,
        "finish-native-shader-validation",
        {
          designId: "design-1",
          requestId: pending.requestId,
          result: {
            status: "failed",
            failure: {
              code: expectedCode,
              message: "The reviewed mirror is missing.",
            },
          },
        },
      );
    }
  });
});
