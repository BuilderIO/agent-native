import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "./types.js";

const insertAuditEvent = vi.fn<(e: AuditEvent) => Promise<void>>();
const getIntegrationRequestContext = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  insertAuditEvent: (e: AuditEvent) => insertAuditEvent(e),
}));
vi.mock("../server/request-context.js", () => ({
  getIntegrationRequestContext,
}));

const { recordActionAudit } = await import("./record.js");

function lastEvent(): AuditEvent {
  return insertAuditEvent.mock.calls.at(-1)![0];
}

beforeEach(() => {
  insertAuditEvent.mockReset();
  insertAuditEvent.mockResolvedValue(undefined);
  getIntegrationRequestContext.mockReset();
  delete process.env.AGENT_NATIVE_AUDIT_ENABLED;
});

afterEach(() => {
  delete process.env.AGENT_NATIVE_AUDIT_ENABLED;
});

describe("recordActionAudit gating", () => {
  it("skips when there is no action name in context", async () => {
    await recordActionAudit({
      config: undefined,
      args: { a: 1 },
      ctx: { caller: "tool" },
      status: "success",
    });
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it("skips high-frequency denylisted actions", async () => {
    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: { actionName: "context-pin", caller: "tool" },
      status: "success",
    });
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it("records a denylisted action when explicitly enabled", async () => {
    await recordActionAudit({
      config: { enabled: true },
      args: {},
      ctx: { actionName: "context-pin", caller: "tool" },
      status: "success",
    });
    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("respects the global kill switch", async () => {
    process.env.AGENT_NATIVE_AUDIT_ENABLED = "false";
    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: { actionName: "delete-thing", caller: "tool" },
      status: "success",
    });
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });
});

describe("recordActionAudit attribution", () => {
  it("marks agent calls and keeps the human actor email", async () => {
    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: {
        actionName: "delete-thing",
        caller: "tool",
        userEmail: "alice@x.com",
        threadId: "th-1",
        turnId: "tn-1",
      },
      status: "success",
    });
    const ev = lastEvent();
    expect(ev.actorKind).toBe("agent");
    expect(ev.actorEmail).toBe("alice@x.com");
    expect(ev.threadId).toBe("th-1");
    expect(ev.turnId).toBe("tn-1");
    expect(ev.ownerEmail).toBe("alice@x.com");
  });

  it("marks frontend calls as human and system calls with no identity", async () => {
    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: { actionName: "x", caller: "frontend", userEmail: "u@x.com" },
      status: "success",
    });
    expect(lastEvent().actorKind).toBe("human");

    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: { actionName: "x", caller: "cli" },
      status: "success",
    });
    expect(lastEvent().actorKind).toBe("system");
  });

  it("uses the declared target + owner for scoping", async () => {
    await recordActionAudit({
      config: {
        target: () => ({
          type: "doc",
          id: "d1",
          ownerEmail: "owner@x.com",
          visibility: "org",
          orgId: "org-1",
        }),
        summary: () => "Edited doc d1",
      },
      args: {},
      ctx: {
        actionName: "edit-doc",
        caller: "tool",
        userEmail: "editor@x.com",
      },
      status: "success",
    });
    const ev = lastEvent();
    expect(ev.targetType).toBe("doc");
    expect(ev.targetId).toBe("d1");
    expect(ev.ownerEmail).toBe("owner@x.com");
    expect(ev.visibility).toBe("org");
    expect(ev.orgId).toBe("org-1");
    expect(ev.summary).toBe("Edited doc d1");
  });

  it("preserves explicit private visibility for integration actions", async () => {
    getIntegrationRequestContext.mockReturnValue({
      taskId: "task-1",
      incoming: { platform: "slack" },
    });
    await recordActionAudit({
      config: {
        target: () => ({
          type: "destination",
          id: "private-destination",
          visibility: "private",
        }),
      },
      args: {},
      ctx: {
        actionName: "send-platform-message",
        caller: "tool",
        userEmail: "service@example.com",
        orgId: "org-1",
      },
      status: "success",
    });

    expect(lastEvent().visibility).toBe("private");
  });

  it("uses org visibility for integration actions without an explicit target policy", async () => {
    getIntegrationRequestContext.mockReturnValue({
      taskId: "task-1",
      incoming: { platform: "slack" },
    });
    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: {
        actionName: "update-doc",
        caller: "tool",
        userEmail: "service@example.com",
        orgId: "org-1",
      },
      status: "success",
    });

    expect(lastEvent().visibility).toBe("org");
  });

  it("captures redacted inputs by default and skips them when disabled", async () => {
    await recordActionAudit({
      config: undefined,
      args: { title: "hi", apiKey: "secret" },
      ctx: { actionName: "create-doc", caller: "tool" },
      status: "success",
    });
    const withInputs = JSON.parse(lastEvent().input!);
    expect(withInputs.title).toBe("hi");
    expect(withInputs.apiKey).toBe("[redacted]");

    await recordActionAudit({
      config: { recordInputs: false },
      args: { title: "hi" },
      ctx: { actionName: "create-doc", caller: "tool" },
      status: "success",
    });
    expect(lastEvent().input).toBeNull();
  });

  it("records an error code on failure", async () => {
    const err = Object.assign(new Error("boom"), { errorCode: "DOC_LOCKED" });
    await recordActionAudit({
      config: undefined,
      args: {},
      ctx: { actionName: "edit-doc", caller: "tool" },
      status: "error",
      error: err,
    });
    const ev = lastEvent();
    expect(ev.status).toBe("error");
    expect(ev.errorCode).toBe("DOC_LOCKED");
  });

  it("records an agent action blocked by approval as denied", async () => {
    await recordActionAudit({
      config: undefined,
      args: { to: "ceo@x.com" },
      ctx: { actionName: "send-email", caller: "tool", turnId: "tn-7" },
      status: "denied",
    });
    const ev = lastEvent();
    expect(ev.status).toBe("denied");
    expect(ev.action).toBe("send-email");
    expect(ev.actorKind).toBe("agent");
    expect(ev.turnId).toBe("tn-7");
    expect(ev.errorCode).toBeNull();
  });

  it("never throws when the insert fails", async () => {
    insertAuditEvent.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordActionAudit({
        config: undefined,
        args: {},
        ctx: { actionName: "delete-thing", caller: "tool" },
        status: "success",
      }),
    ).resolves.toBeUndefined();
  });
});
