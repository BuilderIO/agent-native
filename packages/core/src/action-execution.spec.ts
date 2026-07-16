import { describe, expect, it, vi } from "vitest";

import {
  createActionInvocationDescriptor,
  executeActionEntry,
  runActionEntry,
  type ActionExecutionResolver,
} from "./action-execution.js";
import type { ActionEntry } from "./agent/production-agent.js";

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
    const run = vi.fn(async (args) => args);
    const resolver = (label: string): ActionExecutionResolver => ({
      placements: ["trusted_endpoint"],
      resolve: async (request) => {
        await Promise.resolve();
        expect(request.args).toEqual({ label });
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
      result: { label: "left" },
    });
    expect(right).toMatchObject({
      status: "executed",
      result: { label: "right" },
    });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
