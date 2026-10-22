import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  defineAction,
  type ActionAutomationContext,
  type ActionRunContext,
} from "../action.js";
import type { AuditEvent } from "../audit/types.js";

const auditRows = vi.hoisted(() => [] as unknown[]);
vi.mock("../audit/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../audit/store.js")>()),
  insertAuditEvent: vi.fn(async (event: unknown) => {
    auditRows.push(event);
  }),
}));

import { executeAgentToolCall, type ActionEntry } from "./production-agent.js";

const seen: ActionRunContext[] = [];

const postMessage = defineAction({
  description: "Post a message to a channel.",
  schema: z.object({ channel: z.string() }),
  http: false,
  audit: {
    target: (args: { channel: string }) => ({
      type: "workflow-message",
      id: args.channel,
      visibility: "org",
    }),
  },
  run: async (args, ctx) => {
    seen.push(ctx);
    return { posted: args.channel };
  },
}) as unknown as ActionEntry;

const automation: ActionAutomationContext = {
  triggerId: "resource-1",
  triggerName: "factories/f1/workflow",
};

function lastAuditEvent(): AuditEvent {
  return auditRows.at(-1) as AuditEvent;
}

function execute(extra: {
  automation?: ActionAutomationContext;
  runId?: string;
}) {
  return executeAgentToolCall({
    actions: { "post-message": postMessage },
    name: "post-message",
    input: { channel: "C1" },
    callId: "call-1",
    caller: "automation",
    ownerEmail: "owner@example.com",
    orgId: "org_1",
    appId: "factory",
    ...extra,
  });
}

describe("executeAgentToolCall automation lineage", () => {
  beforeEach(() => {
    seen.length = 0;
    auditRows.length = 0;
  });

  it("hands the action the automation lineage and run id it was given", async () => {
    const result = await execute({ automation, runId: "run-1" });

    expect(result.status).toBe("completed");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      caller: "automation",
      automation,
      runId: "run-1",
    });
  });

  it("records the run id on the audit event", async () => {
    await execute({ automation, runId: "run-1" });

    expect(auditRows).toHaveLength(1);
    expect(lastAuditEvent()).toMatchObject({
      action: "post-message",
      caller: "automation",
      runId: "run-1",
    });
  });

  it("leaves the lineage and run id unset when the caller gives neither", async () => {
    const result = await execute({});

    expect(result.status).toBe("completed");
    expect(seen[0]?.caller).toBe("automation");
    expect(seen[0]?.automation).toBeUndefined();
    expect(seen[0]).not.toHaveProperty("runId");
    expect(lastAuditEvent().runId).toBeNull();
  });
});
