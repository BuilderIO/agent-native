import {
  createActionInvocationDescriptor,
  type ActionEntry,
  type ActionExecutionResolver,
} from "@agent-native/core";
import { describe, expect, it, vi } from "vitest";

import { runInheritedActionEntry } from "./_nested-action.js";

function entry(
  run: ActionEntry["run"],
  protectedResource = false,
): ActionEntry {
  return {
    tool: {
      description: "nested fixture",
      parameters: { type: "object", properties: {} },
    },
    run,
    ...(protectedResource
      ? {
          resourcePrivacy: {
            mode: "protected" as const,
            resourceType: "document",
            placement: "trusted_endpoint" as const,
          },
        }
      : {}),
  };
}

describe("runInheritedActionEntry", () => {
  it("inherits invocation capabilities but will not unwrap a protected nested result", async () => {
    const localRun = vi.fn();
    const invocation = createActionInvocationDescriptor("frontend", [
      "vault:read",
    ]);
    const resolve = vi.fn().mockResolvedValue({
      status: "executed",
      result: { routed: true },
      placement: "trusted_endpoint",
    });
    const resolver: ActionExecutionResolver = {
      placements: ["trusted_endpoint"],
      resolve,
    };

    await expect(
      runInheritedActionEntry({
        entry: entry(localRun, true),
        actionName: "nested-fixture",
        args: { objectId: "object-fixture" },
        parentContext: {
          caller: "frontend",
          actionName: "outer-fixture",
          invocation,
          executionResolver: resolver,
        },
      }),
    ).rejects.toMatchObject({
      name: "ActionExecutionDeniedError",
      code: "nested_protected_result_requires_broker",
    });

    expect(localRun).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "nested-fixture",
        invocation,
        context: expect.objectContaining({
          actionName: "nested-fixture",
          invocation,
          executionResolver: resolver,
        }),
      }),
    );
  });

  it("fails closed when a protected nested action has no resolver", async () => {
    const localRun = vi.fn();
    await expect(
      runInheritedActionEntry({
        entry: entry(localRun, true),
        actionName: "nested-fixture",
        args: {},
        parentContext: { caller: "frontend" },
      }),
    ).rejects.toMatchObject({
      name: "ActionExecutionDeniedError",
      code: "protected_execution_unavailable",
    });
    expect(localRun).not.toHaveBeenCalled();
  });

  it("uses a sealed CLI invocation for context-free legacy calls", async () => {
    const localRun = vi.fn().mockResolvedValue({ ok: true });
    await expect(
      runInheritedActionEntry({
        entry: entry(localRun),
        actionName: "nested-fixture",
        args: {},
      }),
    ).resolves.toEqual({ ok: true });
    expect(localRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        caller: "cli",
        actionName: "nested-fixture",
        invocation: expect.objectContaining({ origin: "cli" }),
      }),
    );
  });

  it("does not let an outer action report success for queued nested work", async () => {
    const resolver: ActionExecutionResolver = {
      placements: ["trusted_endpoint"],
      resolve: vi.fn().mockResolvedValue({
        status: "queued",
        queueId: "queue-fixture",
        placement: "trusted_endpoint",
      }),
    };
    await expect(
      runInheritedActionEntry({
        entry: entry(vi.fn(), true),
        actionName: "nested-fixture",
        args: {},
        parentContext: {
          caller: "frontend",
          executionResolver: resolver,
        },
      }),
    ).rejects.toMatchObject({
      name: "ActionExecutionDeniedError",
      code: "nested_action_queued",
    });
  });
});
