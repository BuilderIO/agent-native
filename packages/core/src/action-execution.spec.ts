import { describe, expect, it, vi } from "vitest";

import {
  createActionInvocationDescriptor,
  dispatchActionEntry,
  executeActionEntry,
  runActionEntry,
  type ActionExecutionResolver,
} from "./action-execution.js";
import type { ActionEntry } from "./agent/production-agent.js";
import {
  authorizeProtectedDeliveryAdapter,
  getProtectedExecutionContext,
  PROTECTED_DELIVERY_CAPABILITY,
} from "./protected-execution-context.js";

const tool = { description: "fixture", parameters: { type: "object" } };

function entry(
  run: ActionEntry["run"],
  protectedPlacement?: "trusted_endpoint" | "enrolled_broker",
): ActionEntry {
  return {
    tool,
    run,
    ...(protectedPlacement
      ? {
          resourcePrivacy: {
            mode: "protected" as const,
            resourceType: "fixture",
            placement: protectedPlacement,
          },
        }
      : {}),
  };
}

describe("action execution resolver", () => {
  it("preserves local results, errors, and legacy context by default", async () => {
    const run = vi.fn(async (args, ctx) => ({ args, ctx }));
    await expect(
      runActionEntry({
        entry: entry(run),
        actionName: "fixture",
        args: { value: 1 },
        context: { caller: "frontend", userEmail: "user@example.test" },
      }),
    ).resolves.toMatchObject({
      args: { value: 1 },
      ctx: {
        caller: "frontend",
        userEmail: "user@example.test",
        invocation: { version: 1, origin: "frontend", capabilities: [] },
      },
    });
    expect(run).toHaveBeenCalledTimes(1);

    const failure = new Error("fixture failure");
    await expect(
      runActionEntry({
        entry: entry(async () => {
          throw failure;
        }),
        actionName: "fixture",
        args: {},
        context: { caller: "http" },
      }),
    ).rejects.toBe(failure);
  });

  it.each(["http", "frontend", "a2a", "cli", "mcp"] as const)(
    "stamps a strict %s invocation descriptor",
    async (origin) => {
      const outcome = await executeActionEntry({
        entry: entry(async (_args, ctx) => ctx?.invocation),
        actionName: "fixture",
        args: {},
        context: { caller: origin },
        invocation: createActionInvocationDescriptor(origin, [
          "write",
          "read",
          "read",
        ]),
      });
      expect(outcome).toEqual({
        status: "executed",
        placement: "local",
        result: { version: 1, origin, capabilities: ["read", "write"] },
      });
    },
  );

  it("rejects mismatched invocation origins before resolving or running", async () => {
    const run = vi.fn();
    const resolve = vi.fn();
    await expect(
      executeActionEntry({
        entry: entry(run),
        actionName: "fixture",
        args: { private: true },
        context: { caller: "http" },
        invocation: createActionInvocationDescriptor("a2a", ["write"]),
        resolver: { placements: [], resolve },
      }),
    ).resolves.toMatchObject({
      status: "denied",
      code: "invalid_invocation_descriptor",
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("fails protected execution closed without an eligible resolver", async () => {
    const run = vi.fn();
    await expect(
      executeActionEntry({
        entry: entry(run, "enrolled_broker"),
        actionName: "protected-fixture",
        args: { protected: "never forwarded locally" },
        context: { caller: "http" },
      }),
    ).resolves.toMatchObject({
      status: "denied",
      code: "protected_execution_unavailable",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("requires metadata-preserving dispatch for legacy protected calls", async () => {
    const run = vi.fn();
    const resolve = vi.fn();
    await expect(
      runActionEntry({
        entry: entry(run, "enrolled_broker"),
        actionName: "protected-fixture",
        args: { protected: "must not reach a sink" },
        context: { caller: "http" },
        resolver: { placements: ["enrolled_broker"], resolve },
      }),
    ).rejects.toMatchObject({ code: "protected_sink_context_required" });
    expect(resolve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("fails malformed privacy policies closed before resolving or running", async () => {
    const run = vi.fn();
    const resolve = vi.fn();
    const malformed = entry(run) as ActionEntry & {
      resourcePrivacy: unknown;
    };
    malformed.resourcePrivacy = {
      mode: "protected",
      resourceType: "document",
      placement: "hosted_plaintext",
    };
    await expect(
      executeActionEntry({
        entry: malformed,
        actionName: "protected-fixture",
        args: {},
        context: { caller: "http" },
        resolver: { placements: ["enrolled_broker"], resolve },
      }),
    ).resolves.toMatchObject({
      status: "denied",
      code: "invalid_resource_privacy_policy",
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps malformed non-null privacy policies in the protected lane", async () => {
    const canary = "MALFORMED-POLICY-PRIVATE-CANARY";
    const malformed = entry(vi.fn()) as ActionEntry & {
      resourcePrivacy: unknown;
    };
    malformed.resourcePrivacy = {
      mode: "protected",
      resourceType: { plaintext: canary },
      placement: "hosted_plaintext",
    };

    const dispatched = await dispatchActionEntry({
      entry: malformed,
      actionName: "malformed-policy-action",
      args: { plaintext: canary },
      context: { caller: "http" },
    });

    expect(dispatched).toMatchObject({
      privacy: "protected",
      receipt: {
        actionName: "malformed-policy-action",
        resourceType: "invalid-resource-policy",
        placement: "enrolled_broker",
        status: "denied",
      },
      outcome: {
        status: "denied",
        code: "invalid_resource_privacy_policy",
      },
    });
    expect(JSON.stringify(dispatched)).not.toContain(canary);
  });

  it("rejects operator-only actions before a resolver can observe arguments", async () => {
    const resolve = vi.fn();
    const operatorEntry = entry(vi.fn(), "enrolled_broker");
    operatorEntry.operatorOnly = {
      tokenEnv: "FIXTURE_TOKEN",
      adminEmailsEnv: "FIXTURE_ADMINS",
    };
    await expect(
      executeActionEntry({
        entry: operatorEntry,
        actionName: "operator-fixture",
        args: { protected: "not visible to resolver" },
        context: { caller: "mcp" },
        resolver: { placements: ["enrolled_broker"], resolve },
      }),
    ).resolves.toMatchObject({
      status: "denied",
      code: "operator_authorization_required",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns typed executed and queued outcomes before local execution", async () => {
    const run = vi.fn();
    const remote: ActionExecutionResolver = {
      placements: ["enrolled_broker"],
      resolve: async () => ({
        status: "executed",
        placement: "enrolled_broker",
        result: { ok: true },
      }),
    };
    await expect(
      executeActionEntry({
        entry: entry(run, "enrolled_broker"),
        actionName: "protected-fixture",
        args: {},
        context: { caller: "mcp" },
        resolver: remote,
      }),
    ).resolves.toEqual({
      status: "executed",
      placement: "enrolled_broker",
      result: { ok: true },
    });
    expect(run).not.toHaveBeenCalled();

    await expect(
      executeActionEntry({
        entry: entry(run, "enrolled_broker"),
        actionName: "protected-fixture",
        args: {},
        context: { caller: "mcp" },
        resolver: {
          placements: ["enrolled_broker"],
          resolve: async () => ({
            status: "queued",
            placement: "enrolled_broker",
            queueId: "queue:fixture-01",
          }),
        },
      }),
    ).resolves.toEqual({
      status: "queued",
      placement: "enrolled_broker",
      queueId: "queue:fixture-01",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("retains protected policy and keeps results nonserializing until authorized delivery", async () => {
    const canary = "PRIVATE-PLAINTEXT-CANARY";
    const dispatched = await dispatchActionEntry({
      entry: entry(vi.fn(), "enrolled_broker"),
      actionName: "protected-fixture",
      args: { objectId: "object:fixture-01" },
      context: { caller: "mcp" },
      resolver: {
        placements: ["enrolled_broker"],
        resolve: async () => ({
          status: "executed",
          placement: "enrolled_broker",
          result: { plaintext: canary },
        }),
      },
    });

    expect(dispatched).toMatchObject({
      privacy: "protected",
      receipt: {
        version: 1,
        actionName: "protected-fixture",
        resourceType: "fixture",
        placement: "enrolled_broker",
        status: "executed",
      },
      outcome: { status: "executed", placement: "enrolled_broker" },
    });
    const serialized = JSON.stringify(dispatched);
    expect(serialized).not.toContain(canary);
    expect(serialized).toContain('"protected":true');

    if (
      dispatched.privacy !== "protected" ||
      dispatched.outcome.status !== "executed"
    ) {
      throw new Error("Expected protected executed fixture");
    }
    expect(() =>
      dispatched.outcome.result.deliver({} as never, (value) => value),
    ).toThrow("Authorized protected delivery adapter is required");
    const authorization = authorizeProtectedDeliveryAdapter({
      adapterId: "fixture-adapter",
      capabilities: [PROTECTED_DELIVERY_CAPABILITY],
    });
    expect(
      dispatched.outcome.result.deliver(authorization, (value) => value),
    ).toEqual({ plaintext: canary });
  });

  it("fails an invalid protected receipt closed", async () => {
    const dispatched = await dispatchActionEntry({
      entry: entry(vi.fn(), "enrolled_broker"),
      actionName: "protected-fixture",
      args: {},
      context: { caller: "mcp" },
      resolver: {
        placements: ["enrolled_broker"],
        resolve: async () => ({
          status: "queued",
          placement: "enrolled_broker",
          queueId: "x",
        }),
      },
    });
    expect(dispatched).toMatchObject({
      privacy: "protected",
      receipt: { status: "denied" },
      outcome: {
        status: "denied",
        code: "invalid_protected_execution_receipt",
      },
    });
  });

  it("replaces resolver denial detail with a stable content-free message", async () => {
    const canary = "RESOLVER-DENIAL-PRIVATE-CANARY";
    const dispatched = await dispatchActionEntry({
      entry: entry(vi.fn(), "enrolled_broker"),
      actionName: "protected-fixture",
      args: {},
      context: { caller: "mcp" },
      resolver: {
        placements: ["enrolled_broker"],
        resolve: async () => ({
          status: "denied",
          code: "grant-denied",
          message: `The private document said ${canary}`,
        }),
      },
    });

    expect(dispatched).toMatchObject({
      privacy: "protected",
      receipt: { status: "denied" },
      outcome: {
        status: "denied",
        code: "grant-denied",
        message:
          "Protected action 'protected-fixture' was denied (grant-denied).",
      },
    });
    expect(JSON.stringify(dispatched)).not.toContain(canary);
  });

  it("collapses thrown protected errors before they leave the dispatcher", async () => {
    const canary = "THROWN-PROTECTED-ERROR-CANARY";
    const dispatched = await dispatchActionEntry({
      entry: entry(vi.fn(), "enrolled_broker"),
      actionName: "protected-fixture",
      args: { plaintext: canary },
      context: { caller: "mcp" },
      resolver: {
        placements: ["enrolled_broker"],
        resolve: async () => {
          throw Object.assign(new Error(`resolver saw ${canary}`), {
            cause: { plaintext: canary },
          });
        },
      },
    });

    expect(dispatched).toMatchObject({
      privacy: "protected",
      receipt: { status: "denied" },
      outcome: {
        status: "denied",
        code: "protected_execution_failed",
        message:
          "Protected action 'protected-fixture' was denied (protected_execution_failed).",
      },
    });
    expect(JSON.stringify(dispatched)).not.toContain(canary);
  });

  it("rejects malformed or placement-confused resolver decisions", async () => {
    const run = vi.fn();
    for (const decision of [
      {
        status: "executed",
        placement: "trusted_endpoint",
        result: { leaked: true },
      },
      { status: "queued", placement: "enrolled_broker", queueId: "" },
      { status: "surprise" },
    ]) {
      await expect(
        executeActionEntry({
          entry: entry(run, "enrolled_broker"),
          actionName: "protected-fixture",
          args: {},
          context: { caller: "mcp" },
          resolver: {
            placements: ["enrolled_broker"],
            resolve: async () => decision as never,
          },
        }),
      ).resolves.toMatchObject({
        status: "denied",
        code: "invalid_execution_decision",
      });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("isolates concurrent request-scoped resolvers and executes locally once", async () => {
    const run = vi.fn(async (args) => ({
      args,
      contextAction: getProtectedExecutionContext()?.receipt.actionName,
    }));
    const resolver = (label: string): ActionExecutionResolver => ({
      placements: ["trusted_endpoint"],
      resolve: async (request) => {
        await Promise.resolve();
        expect(request.args).toEqual({ label });
        expect(getProtectedExecutionContext()?.receipt).toMatchObject({
          actionName: "protected-fixture",
          placement: "trusted_endpoint",
        });
        return { status: "execute-local" };
      },
    });
    const [left, right] = await Promise.all(
      ["left", "right"].map((label) =>
        executeActionEntry({
          entry: entry(run, "trusted_endpoint"),
          actionName: "protected-fixture",
          args: { label },
          context: { caller: "frontend" },
          resolver: resolver(label),
        }),
      ),
    );
    expect(left).toMatchObject({
      status: "executed",
      result: {
        args: { label: "left" },
        contextAction: "protected-fixture",
      },
    });
    expect(right).toMatchObject({
      status: "executed",
      result: {
        args: { label: "right" },
        contextAction: "protected-fixture",
      },
    });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
