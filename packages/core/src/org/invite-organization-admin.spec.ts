import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../action.js";
import type { recordActionAudit } from "../audit/record.js";
import type { DbExecQuery } from "../db/client.js";
import type { sendEmail } from "../server/email.js";
import type { RequestContext } from "../server/request-context.js";
import { inviteOrganizationAdmin } from "./index.js";
interface Query extends DbExecQuery {
  args: unknown[];
}

const seam = vi.hoisted(() => ({
  execute:
    vi.fn<(query: Query) => Promise<{ rows: Record<string, unknown>[] }>>(),
  send: vi.fn<typeof sendEmail>(),
  record: vi.fn<typeof recordActionAudit>(),
  role: "owner" as string | null,
  conflict: "" as string,
  failure: null as Error | null,
  attributionInvalid: false,
  request: undefined as RequestContext | undefined,
}));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: seam.execute }),
}));
vi.mock("../server/email.js", () => ({
  isEmailConfigured: async () => true,
  sendEmail: (...args: Parameters<typeof sendEmail>) => seam.send(...args),
}));
vi.mock("../audit/record.js", () => ({
  recordActionAudit: (...args: Parameters<typeof recordActionAudit>) =>
    seam.record(...args),
}));
vi.mock("../audit/attribution.js", async (original) => {
  const real = await original<typeof import("../audit/attribution.js")>();
  return {
    ...real,
    auditAttribution: (...args: Parameters<typeof real.auditAttribution>) =>
      seam.attributionInvalid ? {} : real.auditAttribution(...args),
  };
});
vi.mock("../server/request-context.js", async (original) => ({
  ...(await original<typeof import("../server/request-context.js")>()),
  getRequestContext: () => seam.request,
}));
const actor: ActionRunContext = {
  caller: "frontend",
  userEmail: "owner@example.test",
  orgId: "org-a",
  threadId: "thread-a",
};
const invoke = (args: { email: string }, ctx: ActionRunContext = actor) =>
  inviteOrganizationAdmin(args, ctx);
const input = { email: " New@Example.test " };
const writes = () =>
  seam.execute.mock.calls.filter(([q]) => /INSERT|UPDATE|DELETE/i.test(q.sql));
const effectsAbsent = () => {
  expect(writes()).toHaveLength(0);
  expect(seam.send).not.toHaveBeenCalled();
  expect(seam.record).not.toHaveBeenCalled();
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(seam, {
    role: "owner",
    conflict: "",
    failure: null,
    attributionInvalid: false,
    request: undefined,
  });
  seam.send.mockResolvedValue({ status: "sent", provider: "dev" });
  seam.record.mockResolvedValue(undefined);
  seam.execute.mockImplementation(async ({ sql, args }: Query) => {
    if (/SELECT role FROM org_members/.test(sql))
      return {
        rows:
          args[0] === "org-a" && args[1] === actor.userEmail && seam.role
            ? [{ role: seam.role }]
            : [],
      };
    if (/SELECT name FROM organizations/.test(sql))
      return { rows: args[0] === "org-a" ? [{ name: "Actor workspace" }] : [] };
    if (/SELECT 1 FROM org_members/.test(sql))
      return { rows: seam.conflict === "member" ? [{ one: 1 }] : [] };
    if (/SELECT 1 FROM org_invitations/.test(sql))
      return { rows: seam.conflict === "pending" ? [{ one: 1 }] : [] };
    if (/INSERT INTO org_invitations/.test(sql)) {
      if (seam.failure) throw seam.failure;
      return { rows: [] };
    }
    throw new Error(`Unexpected DB operation: ${sql}`);
  });
});
describe("public authenticated admin invitation", () => {
  it("exports a callable supported helper", () =>
    expect(inviteOrganizationAdmin).toBeTypeOf("function"));
  it("uses actual membership, actor org/name, canonical email and fixed admin with one audit", async () => {
    const result = await invoke(input);
    expect(result).toMatchObject({
      email: "new@example.test",
      role: "admin",
      status: "pending",
      emailSent: true,
    });
    expect(writes()).toHaveLength(1);
    expect(writes().at(0)?.[0].args).toEqual([
      expect.any(String),
      "org-a",
      "new@example.test",
      actor.userEmail,
      expect.any(Number),
      "admin",
      null,
    ]);
    expect(seam.send).toHaveBeenCalledTimes(1);
    expect(seam.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@example.test",
        orgId: "org-a",
        authCritical: true,
        html: expect.stringContaining("Actor workspace"),
      }),
    );
    expect(seam.record).toHaveBeenCalledTimes(1);
    const call = seam.record.mock.calls[0];
    if (!call) throw new Error("Missing audit call");
    const [audit] = call;
    expect(audit.ctx).toMatchObject({
      userEmail: actor.userEmail,
      orgId: "org-a",
    });
    expect(audit.attribution).toMatchObject({
      caller: actor.caller,
      threadId: actor.threadId,
    });
    expect(
      audit.config?.target?.({}, result, {
        status: "success",
        caller: actor.caller,
      }),
    ).toMatchObject({
      type: "org-invitation",
      id: "new@example.test",
      orgId: "org-a",
      visibility: "admins",
    });
  });
  it("rejects client role, org and app-role injection before effects", async () => {
    const hostile = {
      ...input,
      role: "member",
      orgId: "org-b",
      orgName: "Forged",
      appId: "evil",
      appRoles: ["owner"],
    };
    await expect(invoke(hostile)).rejects.toBeDefined();
    effectsAbsent();
  });
  it.each(["admin", "member", null])(
    "denies actual DB role %s despite claimed owner",
    async (role) => {
      seam.role = role;
      const claimed = { ...actor, role: "owner", orgRole: "owner" };
      await expect(invoke(input, claimed)).rejects.toMatchObject({
        statusCode: 403,
      });
      effectsAbsent();
      expect(
        seam.execute.mock.calls.every(([q]) =>
          /SELECT role FROM org_members/.test(q.sql),
        ),
      ).toBe(true);
    },
  );
  it.each([
    { ...actor, userEmail: undefined },
    { ...actor, orgId: undefined },
  ])("denies incomplete identity", async (ctx) => {
    await expect(invoke(input, ctx)).rejects.toMatchObject({ statusCode: 401 });
    effectsAbsent();
    expect(seam.execute).not.toHaveBeenCalled();
  });
  it("denies membership in another active org", async () => {
    await expect(
      invoke(input, { ...actor, orgId: "org-b" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    effectsAbsent();
  });
  it("honors delegated identity downgrade even for a DB owner", async () => {
    seam.request = {
      a2aIdentityAssurance: "org-member",
      userEmail: "owner@example.test",
      orgId: "org-a",
    };
    await expect(invoke(input)).rejects.toMatchObject({ statusCode: 403 });
    effectsAbsent();
  });
  it.each(["", "bad", "a@b", "a b@example.test"])(
    "validates canonical email schema: %s",
    async (email) => {
      await expect(invoke({ email })).rejects.toBeDefined();
      effectsAbsent();
    },
  );
  it.each(["member", "pending"])(
    "preserves %s conflict without retry or audit",
    async (conflict) => {
      seam.conflict = conflict;
      await expect(invoke(input)).rejects.toMatchObject({ statusCode: 409 });
      effectsAbsent();
    },
  );
  it("propagates invitation persistence rejection without sending or success audit", async () => {
    seam.failure = new Error("synthetic insert failure");
    await expect(invoke(input)).rejects.toBe(seam.failure);
    expect(seam.send).not.toHaveBeenCalled();
    expect(seam.record).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(1);
  });
  it("validates branded audit attribution before creating an invitation or sending", async () => {
    seam.attributionInvalid = true;
    await expect(invoke(input)).rejects.toMatchObject({
      name: "AuditAttributionError",
    });
    effectsAbsent();
  });
  it("preserves shared transport failure semantics and audits the created pending invitation once", async () => {
    seam.send.mockRejectedValueOnce(new Error("synthetic SMTP failure"));
    await expect(invoke(input)).resolves.toMatchObject({
      role: "admin",
      status: "pending",
      emailSent: false,
    });
    expect(writes()).toHaveLength(1);
    expect(seam.send).toHaveBeenCalledTimes(1);
    expect(seam.record).toHaveBeenCalledTimes(1);
  });
});
