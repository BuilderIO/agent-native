import { describe, expect, it } from "vitest";

import { auditEventToOcsf, OCSF_SCHEMA_VERSION } from "./ocsf.js";
import type { AuditEvent } from "./types.js";

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "evt-1",
    createdAt: 1_700_000_000_000,
    action: "delete-recording",
    caller: "http",
    actorKind: "human",
    actorEmail: "alice@example.test",
    orgId: "org-1",
    threadId: null,
    turnId: null,
    targetType: "recording",
    targetId: "rec-1",
    status: "success",
    summary: "Deleted recording rec-1",
    input: '{"secret":"never exported"}',
    errorCode: null,
    ownerEmail: "alice@example.test",
    visibility: "org",
    ...over,
  };
}

describe("auditEventToOcsf", () => {
  it("maps a success to an API Activity with Success status", () => {
    const out = auditEventToOcsf(event({ app: "clips" }));
    expect(out).toMatchObject({
      class_uid: 6003,
      category_uid: 6,
      activity_id: 4,
      type_uid: 600304,
      time: 1_700_000_000_000,
      severity_id: 1,
      status_id: 1,
      status: "Success",
      action_id: 1,
      message: "Deleted recording rec-1",
      metadata: {
        version: OCSF_SCHEMA_VERSION,
        uid: "evt-1",
        tenant_uid: "org-1",
        product: { name: "Agent-Native", uid: "clips" },
      },
      actor: {
        user: { uid: "alice@example.test", type_id: 1, type: "User" },
      },
      api: { operation: "delete-recording", service: { name: "clips" } },
      src_endpoint: { name: "http" },
      resources: [
        {
          type: "recording",
          uid: "rec-1",
          owner: { email_addr: "alice@example.test" },
        },
      ],
    });
    expect(out.status_detail).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("never exported");
  });

  it("maps an error to Failure with the error code", () => {
    const out = auditEventToOcsf(
      event({ status: "error", errorCode: "SqlError", summary: null }),
    );
    expect(out).toMatchObject({
      status_id: 2,
      status: "Failure",
      status_code: "SqlError",
      status_detail: "Failed: SqlError",
      severity_id: 2,
      action_id: 1,
      message: "delete-recording (error)",
    });
  });

  it("maps a refusal to Failure, Denied, and a higher severity", () => {
    const out = auditEventToOcsf(event({ status: "denied" }));
    expect(out).toMatchObject({
      status_id: 2,
      status: "Failure",
      severity_id: 3,
      action_id: 2,
      action: "Denied",
    });
    expect(out.status_detail).toMatch(/^Refused/);
  });

  it("keeps agent run, task, and parent lineage under unmapped", () => {
    const out = auditEventToOcsf(
      event({
        action: "create-note",
        caller: "tool",
        actorKind: "agent",
        threadId: "thread-1",
        turnId: "turn-1",
        runId: "run-1",
        taskId: "task-2",
        parentTaskId: "task-1",
        sourcePlatform: "slack",
        networkProtocol: "a2a",
        networkId: "peer-app",
        networkPeer: "https://peer.example.test",
        app: "mail",
      }),
    );
    expect(out.activity_id).toBe(1);
    expect(out.actor.session).toEqual({ uid: "thread-1" });
    expect(out.src_endpoint).toEqual({
      name: "https://peer.example.test",
      uid: "peer-app",
    });
    expect(out.unmapped).toEqual({
      actor_kind: "agent",
      caller: "tool",
      app: "mail",
      visibility: "org",
      thread_id: "thread-1",
      turn_id: "turn-1",
      run_id: "run-1",
      task_id: "task-2",
      parent_task_id: "task-1",
      source_platform: "slack",
      network_protocol: "a2a",
      network_id: "peer-app",
      network_peer: "https://peer.example.test",
    });
  });

  it("maps a service principal to a Service user, not a mailbox", () => {
    const out = auditEventToOcsf(
      event({
        actorEmail: "svc-ci-bot@service.org-1",
        action: "frobnicate",
      }),
    );
    expect(out.actor.user).toEqual({
      uid: "svc-ci-bot@service.org-1",
      name: "svc-ci-bot",
      type_id: 4,
      type: "Service",
    });
    expect(out.activity_id).toBe(99);
    expect(out.type_uid).toBe(600399);
  });

  it("does not trust a service-shaped email from another org", () => {
    const out = auditEventToOcsf(
      event({ actorEmail: "svc-ci-bot@service.org-2" }),
    );
    expect(out.actor.user.type_id).toBe(1);
  });

  it("maps an actorless event to the System user", () => {
    const out = auditEventToOcsf(
      event({ actorEmail: null, actorKind: "system" }),
    );
    expect(out.actor.user).toEqual({
      name: "system",
      type_id: 3,
      type: "System",
    });
  });
});
