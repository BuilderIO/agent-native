import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ACTION_CONFORMANCE_SURFACES,
  assertActionConformance,
  checkActionConformance,
  type ActionConformanceSurface,
  type ConformanceAdapter,
  type ConformanceResponse,
} from "./action-conformance.js";
import { defineAction } from "./action.js";

const input = z.object({ id: z.string() });
const output = z.object({ id: z.string(), body: z.string() });
const document = { id: "doc-1", body: "The content visible in the editor" };
const focus = {
  route: "/documents/doc-1",
  pane: "reply",
  applicationState: { documentId: "doc-1", pane: "reply" },
};
const action = defineAction({
  description: "Read a document including its body.",
  schema: input,
  outputSchema: output,
  readOnly: true,
  run: () => document,
  link: () => ({ url: "/documents/doc-1", label: "Open document" }),
});

function config(override?: {
  surface: ActionConformanceSurface;
  adapter: Partial<ConformanceAdapter>;
}) {
  const adapters = Object.fromEntries(
    ACTION_CONFORMANCE_SURFACES.map((surface) => [
      surface,
      {
        list: async () => [
          {
            name: "read-document",
            inputSchema: z.toJSONSchema(input, { io: "input" }),
            outputSchema: z.toJSONSchema(output),
          },
        ],
        call: async () => ({ result: await action.run({ id: document.id }) }),
        ...(override?.surface === surface ? override.adapter : {}),
      },
    ]),
  ) as Record<ActionConformanceSurface, ConformanceAdapter>;
  return {
    app: "documents",
    actions: { "read-document": action },
    adapters,
    fixtures: {
      "read-document": {
        args: { id: document.id },
        visibleContent: async () => document.body,
        resultContent: (result: unknown) => output.parse(result).body,
        focus,
        open: async () => focus,
      },
    },
  };
}

describe("action conformance", () => {
  it("tests each action and client and reports no failures for a complete contract", async () => {
    const report = await checkActionConformance(config());
    expect(report).toEqual({
      app: "documents",
      actions: 1,
      calls: 5,
      exemptions: 0,
      failures: [],
    });
    expect(() => assertActionConformance(report)).not.toThrow();
  });

  it.each(ACTION_CONFORMANCE_SURFACES)(
    "names the app, action and %s when its catalog omits the action",
    async (surface) => {
      const report = await checkActionConformance(
        config({ surface, adapter: { list: async () => [] } }),
      );
      expect(report.failures).toContainEqual({
        app: "documents",
        action: "read-document",
        surface,
        check: "exposure",
        message: "Action must be exposed exactly once",
      });
      expect(() => assertActionConformance(report)).toThrow(
        `documents/read-document [${surface}]`,
      );
    },
  );

  it("detects schemas narrowed by a connector", async () => {
    const report = await checkActionConformance(
      config({
        surface: "chatgpt",
        adapter: {
          list: async () => [
            { name: "read-document", inputSchema: {}, outputSchema: {} },
          ],
        },
      }),
    );
    expect(
      report.failures.map((failure) => [failure.surface, failure.check]),
    ).toEqual([["chatgpt", "schema-parity"]]);
  });

  it("rejects catalogs that all agree on a schema different from the declared action", async () => {
    const options = config();
    for (const adapter of Object.values(options.adapters)) {
      adapter.list = async () => [
        { name: "read-document", inputSchema: {}, outputSchema: {} },
      ];
    }
    const report = await checkActionConformance(options);
    expect(
      report.failures.map(({ surface, check }) => [surface, check]),
    ).toEqual(
      ACTION_CONFORMANCE_SURFACES.map((surface) => [surface, "schema-parity"]),
    );
  });

  it.each(["setup", "visibleContent", "cleanup"] as const)(
    "bounds a stalled %s callback and reports unconfirmed teardown",
    async (callback) => {
      const options = config();
      let cleanups = 0;
      const report = await checkActionConformance({
        ...options,
        timeoutMs: 5,
        fixtures: {
          "read-document": {
            ...options.fixtures["read-document"],
            cleanup: async () => {
              cleanups++;
            },
            [callback]: async () => {
              if (callback === "cleanup") cleanups++;
              return new Promise<never>(() => {});
            },
          },
        },
      });
      // oracle-change: teardown waits for owned setup to settle; a live setup leaves an explicit cleanup obligation.
      expect(cleanups).toBe(callback === "setup" ? 0 : 5);
      expect(report.failures.map(({ check }) => check)).toEqual(
        Array(callback === "setup" ? 10 : 5).fill(
          callback === "visibleContent" ? "content" : "fixture",
        ),
      );
    },
  );

  it("uses the agent-facing contract for agent catalogs while retaining the full UI contract", async () => {
    const options = config();
    const fullInput = input.extend({ internal: z.string().optional() });
    options.adapters.ui.list = async () => [
      {
        name: "read-document",
        inputSchema: z.toJSONSchema(fullInput, { io: "input" }),
        outputSchema: z.toJSONSchema(output),
      },
    ];
    const report = await checkActionConformance({
      ...options,
      actions: {
        "read-document": {
          ...action,
          schema: fullInput,
          agentInputSchema: input,
        },
      },
    });
    expect(report.failures).toEqual([]);
  });

  it("rejects fixture arguments that violate the full action schema before dispatch", async () => {
    const options = config();
    const report = await checkActionConformance({
      ...options,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          args: { id: 42 },
        },
      },
    });
    expect(report.calls).toBe(0);
    expect(report.failures.map(({ check }) => check)).toEqual(["input-schema"]);
  });

  it("cleans up a timed-out setup after its owned work eventually settles", async () => {
    const options = config();
    const lateSetup = Promise.withResolvers<void>();
    const owned = new Set<string>();
    let cleanupCount = 0;
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 5,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          setup: async (surface) => {
            if (surface === "chatgpt") await lateSetup.promise;
            owned.add(surface);
          },
          cleanup: async (surface) => {
            cleanupCount++;
            owned.delete(surface);
          },
        },
      },
    });
    expect(
      report.failures.map(({ surface, check }) => [surface, check]),
    ).toEqual([
      ["chatgpt", "fixture"],
      ["chatgpt", "fixture"],
    ]);
    const returned = structuredClone(report);
    expect(returned.failures).toContainEqual(
      expect.objectContaining({
        message: "Owned work did not settle; cleanup remains unconfirmed",
      }),
    );
    lateSetup.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owned.size).toBe(0);
    expect(cleanupCount).toBe(5);
    expect(report).toEqual(returned);
  });

  it("compensates an adapter call that creates its owned record after timing out", async () => {
    const completion = Promise.withResolvers<void>();
    const owned = new Set<string>();
    const options = config({
      surface: "chatgpt",
      adapter: {
        call: async () => {
          await completion.promise;
          owned.add("late-call");
          return { result: document };
        },
      },
    });
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 5,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          cleanup: async () => {
            owned.delete("late-call");
          },
        },
      },
    });
    expect(report.failures).toContainEqual(
      expect.objectContaining({ surface: "chatgpt", check: "latency" }),
    );
    completion.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owned.size).toBe(0);
  });

  it("includes cleanup failure in the returned report when setup settles during bounded recovery", async () => {
    const options = config();
    let created = false;
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 5,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          setup: async (surface, signal) => {
            if (surface === "chatgpt")
              await new Promise<void>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    setTimeout(() => {
                      created = true;
                      resolve();
                    }, 0);
                  },
                  { once: true },
                );
              });
          },
          cleanup: async (surface) => {
            if (surface === "chatgpt" && created)
              throw new Error("Owned cleanup failed");
          },
        },
      },
    });
    expect(structuredClone(report).failures).toContainEqual(
      expect.objectContaining({
        surface: "chatgpt",
        check: "fixture",
        message: "Owned fixture cleanup failed",
      }),
    );
  });

  it("stops a live durable task before cleaning its fixture when polls are exhausted", async () => {
    let live = true;
    const order: string[] = [];
    const pending: ConformanceResponse = {
      result: null,
      pending: {
        handle: "owned-live-task",
        poll: async () => pending,
        cancelAndWait: async () => {
          order.push("cancel");
          live = false;
          return { result: null };
        },
      },
    };
    const options = config({
      surface: "chatgpt",
      adapter: { call: async () => pending },
    });
    const report = await checkActionConformance({
      ...options,
      maxPolls: 2,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          cleanup: async (surface) => {
            if (surface === "chatgpt") {
              expect(live).toBe(false);
              order.push("cleanup");
            }
          },
        },
      },
    });
    expect(live).toBe(false);
    expect(order).toEqual(["cancel", "cleanup"]);
    expect(
      report.failures.map(({ surface, check }) => [surface, check]),
    ).toEqual([["chatgpt", "latency"]]);
  });

  it("cancels a known durable task despite a stalled poll before fixture cleanup", async () => {
    let live = true;
    const order: string[] = [];
    const options = config({
      surface: "chatgpt",
      adapter: {
        call: async () => ({
          result: null,
          pending: {
            handle: "owned-stalled-poll",
            poll: async () => new Promise<ConformanceResponse>(() => {}),
            cancelAndWait: async () => {
              live = false;
              order.push("cancel");
              return { result: null };
            },
          },
        }),
      },
    });
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 20,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          cleanup: async (surface) => {
            if (surface === "chatgpt") {
              expect(live).toBe(false);
              order.push("cleanup");
            }
          },
        },
      },
    });
    expect(order).toEqual(["cancel", "cleanup"]);
    expect(
      report.failures.map(({ surface, check }) => [surface, check]),
    ).toEqual([["chatgpt", "latency"]]);
  });

  it("cancels the current handle after a poll supersedes an expired handle", async () => {
    const order: string[] = [];
    const current: ConformanceResponse = {
      result: null,
      pending: {
        handle: "current-owned-task",
        poll: async () => current,
        cancelAndWait: async () => {
          order.push("cancel-current");
          return { result: null };
        },
      },
    };
    const options = config({
      surface: "chatgpt",
      adapter: {
        call: async () => ({
          result: null,
          pending: {
            handle: "expired-owned-task",
            poll: async () => current,
            cancelAndWait: async () => {
              order.push("cancel-expired");
              throw new Error("Expired handle");
            },
          },
        }),
      },
    });
    const report = await checkActionConformance({
      ...options,
      maxPolls: 1,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          cleanup: async (surface) => {
            if (surface === "chatgpt") order.push("cleanup");
          },
        },
      },
    });
    expect(order).toEqual(["cancel-current", "cleanup"]);
    expect(
      report.failures.map(({ surface, check }) => [surface, check]),
    ).toEqual([["chatgpt", "latency"]]);
  });

  it("settles a pending handle returned by a late call before its eventual fixture cleanup", async () => {
    const completion = Promise.withResolvers<void>();
    let live = false;
    let cancelled = false;
    const options = config({
      surface: "chatgpt",
      adapter: {
        call: async () => {
          await completion.promise;
          live = true;
          return {
            result: null,
            pending: {
              handle: "late-owned-task",
              poll: async () => ({ result: document }),
              cancelAndWait: async () => {
                live = false;
                cancelled = true;
                return { result: null };
              },
            },
          };
        },
      },
    });
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 5,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          cleanup: async (surface) => {
            if (surface === "chatgpt") expect(live).toBe(false);
          },
        },
      },
    });
    const returned = structuredClone(report);
    completion.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
    expect(live).toBe(false);
    expect(report).toEqual(returned);
  });

  it("validates fixture input against each narrower agent contract before client dispatch", async () => {
    const options = config();
    const agentInput = z.object({ id: z.literal("agent-only-id") });
    for (const surface of ACTION_CONFORMANCE_SURFACES) {
      if (surface !== "ui")
        options.adapters[surface].list = async () => [
          {
            name: "read-document",
            inputSchema: z.toJSONSchema(agentInput, { io: "input" }),
            outputSchema: z.toJSONSchema(output),
          },
        ];
    }
    const report = await checkActionConformance({
      ...options,
      actions: { "read-document": { ...action, agentInputSchema: agentInput } },
    });
    expect(report.calls).toBe(1);
    expect(
      report.failures.map(({ surface, check }) => [surface, check]),
    ).toEqual(
      ACTION_CONFORMANCE_SURFACES.filter((surface) => surface !== "ui").map(
        (surface) => [surface, "input-schema"],
      ),
    );
  });

  it("returns a failed report within the whole-run budget instead of stalling through every adapter", async () => {
    const options = config();
    for (const adapter of Object.values(options.adapters))
      adapter.call = async () => new Promise<ConformanceResponse>(() => {});
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 5,
      runTimeoutMs: 20,
    });
    expect(report.calls).toBeLessThan(5);
    expect(report.failures).toContainEqual(
      expect.objectContaining({
        check: "latency",
        message:
          "Conformance run budget exceeded; remaining behavior is unmeasured",
      }),
    );
  });

  it("detects an id-only result even when the schema permits it", async () => {
    const options = config({
      surface: "mcp",
      adapter: { call: async () => ({ result: { id: document.id } }) },
    });
    const report = await checkActionConformance(options);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: "mcp", check: "result" }),
      ]),
    );
  });

  it("detects a valid but stale body against the independently read UI", async () => {
    const report = await checkActionConformance(
      config({
        surface: "claude",
        adapter: {
          call: async () => ({ result: { ...document, body: "Old content" } }),
        },
      }),
    );
    expect(
      report.failures.map((failure) => [failure.surface, failure.check]),
    ).toEqual([["claude", "content"]]);
  });

  it("refuses an id-only UI oracle", async () => {
    const options = config();
    const report = await checkActionConformance({
      ...options,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          visibleContent: async () => ({ id: document.id }),
        },
      },
    });
    expect(report.failures.map((failure) => failure.check)).toEqual(
      Array(5).fill("content"),
    );
  });

  it("accepts numeric UI content, including zero, rather than treating it as id-only", async () => {
    const options = config();
    const report = await checkActionConformance({
      ...options,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          visibleContent: async () => ({ count: 0 }),
          resultContent: () => ({ count: 0 }),
        },
      },
    });
    expect(report.failures).toEqual([]);
  });

  it("detects a pane mismatch even when the link reaches the correct object", async () => {
    const options = config();
    options.fixtures["read-document"].open = async () => ({
      ...focus,
      pane: "details",
    });
    const report = await checkActionConformance(options);
    expect(report.failures.map((failure) => failure.check)).toEqual(
      Array(5).fill("link"),
    );
  });

  it("requires fixtures for every registered action and never executes absent fixtures", async () => {
    const report = await checkActionConformance({ ...config(), fixtures: {} });
    expect(report.calls).toBe(0);
    expect(report.failures.map((failure) => failure.check)).toEqual([
      "fixture",
    ]);
  });

  it("detects missing schema metadata instead of silently shrinking the catalog", async () => {
    const report = await checkActionConformance({
      ...config(),
      actions: { "legacy-action": {} },
      fixtures: {},
    });
    expect(report.failures.map((failure) => failure.check)).toEqual([
      "input-schema",
      "output-schema",
      "fixture",
    ]);
  });

  it("bounds ignored cancellation and retains unconfirmed teardown while the call is live", async () => {
    let aborted = false;
    let cleaned = false;
    const options = config({
      surface: "chatgpt",
      adapter: {
        call: async (_name, _args, signal) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return new Promise<ConformanceResponse>(() => {});
        },
      },
    });
    const report = await checkActionConformance({
      ...options,
      timeoutMs: 5,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          cleanup: async (surface) => {
            if (surface === "chatgpt") cleaned = true;
          },
        },
      },
    });
    expect(aborted).toBe(true);
    // oracle-change: an unresolved owned call must not be torn down while its effects can still arrive.
    expect(cleaned).toBe(false);
    expect(
      report.failures.map((failure) => [failure.surface, failure.check]),
    ).toEqual([
      ["chatgpt", "latency"],
      ["chatgpt", "fixture"],
    ]);
  });

  it("accepts a pending handle and validates the terminal content without repeating the write", async () => {
    let calls = 0;
    let polls = 0;
    const report = await checkActionConformance(
      config({
        surface: "chatgpt",
        adapter: {
          call: async () => {
            calls++;
            return {
              result: null,
              pending: {
                handle: "owned-task",
                poll: async () => {
                  polls++;
                  return { result: document };
                },
              },
            };
          },
        },
      }),
    );
    expect(report.failures).toEqual([]);
    expect({ calls, polls }).toEqual({ calls: 1, polls: 1 });
  });

  it("cannot turn an indefinitely pending task into a pass", async () => {
    let cancelled = false;
    const pending: ConformanceResponse = {
      result: null,
      pending: {
        handle: "owned-task",
        poll: async () => (cancelled ? { result: null } : pending),
        cancelAndWait: async () => {
          cancelled = true;
          return { result: null };
        },
      },
    };
    const report = await checkActionConformance({
      ...config({ surface: "chatgpt", adapter: { call: async () => pending } }),
      maxPolls: 2,
    });
    expect(
      report.failures.map((failure) => [failure.surface, failure.check]),
    ).toEqual([["chatgpt", "latency"]]);
  });

  it("keeps intentional access exclusions explicit and fails if they are accidentally exposed", async () => {
    const options = config();
    const report = await checkActionConformance({
      ...options,
      fixtures: {
        "read-document": {
          ...options.fixtures["read-document"],
          excluded: { a2a: "Requires the signed-in editor" },
        },
      },
    });
    expect(report.exemptions).toBe(1);
    expect(
      report.failures.map((failure) => [failure.surface, failure.check]),
    ).toEqual([["a2a", "exposure"]]);
  });

  it("refuses to relax the hosted-client budget", async () => {
    await expect(
      checkActionConformance({ ...config(), timeoutMs: 60_000 }),
    ).rejects.toThrow(RangeError);
  });
});
