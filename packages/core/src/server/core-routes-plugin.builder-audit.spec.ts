import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordActionAuditInput } from "../audit/record.js";

const recordActionAuditMock = vi.hoisted(() =>
  vi.fn(async (_input: RecordActionAuditInput) => undefined),
);

vi.mock("../audit/record.js", () => ({
  recordActionAudit: recordActionAuditMock,
}));

import {
  builderDisconnectAuditScope,
  recordBuilderConnectionAudit,
} from "./core-routes-plugin.js";

function recordedEvent() {
  expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
  const input = recordActionAuditMock.mock.calls[0]![0];
  const meta = { status: input.status, caller: input.ctx.caller };
  return {
    action: input.ctx.actionName,
    orgId: input.ctx.orgId,
    userEmail: input.ctx.userEmail,
    status: input.status,
    args: input.args,
    target: input.config.target?.(input.args, undefined, meta),
    summary: input.config.summary?.(input.args, undefined, meta),
  };
}

beforeEach(() => {
  recordActionAuditMock.mockClear();
});

describe("recordBuilderConnectionAudit", () => {
  it("puts an org connect in the admin trail", async () => {
    await recordBuilderConnectionAudit({
      connected: true,
      ownerEmail: "admin@example.com",
      orgId: "org-123",
      scope: "org",
    });

    expect(recordedEvent()).toEqual({
      action: "builder-connect",
      orgId: "org-123",
      userEmail: "admin@example.com",
      status: "success",
      args: { scope: "org" },
      target: {
        type: "builder-connection",
        id: "org-123",
        orgId: "org-123",
        visibility: "admins",
      },
      summary: "Connected Builder.io for the organization",
    });
  });

  it("keeps a member's personal connect private inside the org", async () => {
    await recordBuilderConnectionAudit({
      connected: true,
      ownerEmail: "member@example.com",
      orgId: "org-123",
      scope: "user",
    });

    expect(recordedEvent()).toMatchObject({
      action: "builder-connect",
      orgId: "org-123",
      target: {
        type: "builder-connection",
        id: "member@example.com",
        orgId: "org-123",
        visibility: "private",
      },
      summary: "Connected a personal Builder.io account",
    });
  });

  it("puts an org disconnect in the admin trail", async () => {
    await recordBuilderConnectionAudit({
      connected: false,
      ownerEmail: "admin@example.com",
      orgId: "org-123",
      scope: "org",
    });

    expect(recordedEvent()).toMatchObject({
      action: "builder-disconnect",
      target: { id: "org-123", visibility: "admins" },
      summary: "Disconnected the organization's Builder.io",
    });
  });

  it("keeps a personal disconnect private", async () => {
    await recordBuilderConnectionAudit({
      connected: false,
      ownerEmail: "member@example.com",
      orgId: "org-123",
      scope: "user",
    });

    expect(recordedEvent()).toMatchObject({
      action: "builder-disconnect",
      target: { id: "member@example.com", visibility: "private" },
      summary: "Disconnected a personal Builder.io account",
    });
  });

  it("keeps a connect with no org private to the actor", async () => {
    await recordBuilderConnectionAudit({
      connected: true,
      ownerEmail: "solo@example.com",
      orgId: null,
      scope: "user",
    });

    expect(recordedEvent()).toMatchObject({
      orgId: null,
      target: { orgId: null, visibility: "private" },
    });
  });
});

describe("builderDisconnectAuditScope", () => {
  it("uses the stored OAuth grant's scope", () => {
    expect(builderDisconnectAuditScope("org", undefined)).toBe("org");
    expect(builderDisconnectAuditScope("user", undefined)).toBe("user");
  });

  it("reads org-scoped legacy keys from the delete options", () => {
    expect(
      builderDisconnectAuditScope(null, { orgId: "org-123", role: "admin" }),
    ).toBe("org");
  });

  it("treats legacy keys deleted without options as personal", () => {
    expect(builderDisconnectAuditScope(null, undefined)).toBe("user");
  });
});
