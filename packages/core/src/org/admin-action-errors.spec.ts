import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionCaller } from "../action.js";
import type { AuditEvent } from "../audit/types.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  insertAuditEvent: vi.fn(),
  checkAction: vi.fn(),
}));
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../audit/store.js", () => ({
  insertAuditEvent: mocks.insertAuditEvent,
}));
vi.mock("../authorization/check-action.js", () => ({
  checkAction: mocks.checkAction,
}));
vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (app: unknown) => app,
}));

import { mountActionRoutes } from "../server/action-routes.js";
import { registerErrorCaptureProvider } from "../server/capture-error.js";
import explainAccess from "./actions/explain-access.js";
import setAppMemberRoles from "./actions/set-app-member-roles.js";

const member = { userEmail: "member@example.test", orgId: "org-test" };
const roleArgs = { appId: "forms", email: member.userEmail, roles: ["admin"] };

function lastEvent(): AuditEvent {
  return mocks.insertAuditEvent.mock.calls.at(-1)![0];
}

async function invoke(
  name: string,
  entry: typeof setAppMemberRoles | typeof explainAccess,
  args: unknown,
) {
  const handlers: Array<(event: any) => Promise<unknown>> = [];
  const app = {
    use: (_path: string, handler: (event: any) => Promise<unknown>) =>
      handlers.push(handler),
  };
  mountActionRoutes(
    app,
    { [name]: entry },
    {
      appId: "forms",
      getOwnerFromEvent: async () => member.userEmail,
      resolveOrgId: async () => member.orgId,
    },
  );
  const url = new URL(
    `https://forms.example.test/_agent-native/actions/${name}`,
  );
  const event = {
    method: "POST",
    url,
    path: url.pathname,
    context: {},
    req: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    }),
    res: { status: 200, headers: new Headers() },
  };
  return { body: await handlers[0](event), status: event.res.status };
}

describe("admin-only action errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rows: [{ role: "member" }] });
    mocks.insertAuditEvent.mockResolvedValue(undefined);
    mocks.checkAction.mockResolvedValue({ allowed: true });
  });

  it.each(["frontend", "http", "tool", "mcp"] satisfies ActionCaller[])(
    "records a refused self-promotion as denied for %s",
    async (caller) => {
      await expect(
        setAppMemberRoles.run(roleArgs, {
          ...member,
          caller,
          actionName: "set-app-member-roles",
        }),
      ).rejects.toMatchObject({ statusCode: 403, errorCode: "forbidden" });
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(lastEvent()).toMatchObject({
        action: "set-app-member-roles",
        status: "denied",
        errorCode: "forbidden",
        targetType: "app-member-roles",
        targetId: `forms:${member.userEmail}`,
        visibility: "admins",
        orgId: member.orgId,
      });
    },
  );

  it("returns the admin refusal over HTTP and does not capture it as an internal fault", async () => {
    const capture = vi.fn(() => "test-event");
    const unregister = registerErrorCaptureProvider(
      "org-admin-refusal-test",
      capture,
    );
    try {
      expect(
        await invoke("set-app-member-roles", setAppMemberRoles, roleArgs),
      ).toEqual({
        status: 403,
        body: {
          error: "Organization admin role required.",
          errorCode: "forbidden",
        },
      });
      expect(lastEvent().status).toBe("denied");
      expect(capture).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("returns the same typed 403 for explain-access about another member", async () => {
    expect(
      await invoke("explain-access", explainAccess, {
        appId: "forms",
        email: "other@example.test",
      }),
    ).toEqual({
      status: 403,
      body: {
        error: "Organization admin role required.",
        errorCode: "forbidden",
      },
    });
    expect(mocks.checkAction).not.toHaveBeenCalled();
  });

  it("still lets a member explain their own access", async () => {
    expect(
      await invoke("explain-access", explainAccess, { appId: "forms" }),
    ).toMatchObject({
      status: 200,
      body: { allowed: true, email: member.userEmail },
    });
    expect(mocks.checkAction).toHaveBeenCalledTimes(1);
  });

  it("keeps unexpected lookup failures as internal errors in HTTP and audit", async () => {
    mocks.execute.mockRejectedValue(new Error("database unavailable"));
    expect(
      await invoke("set-app-member-roles", setAppMemberRoles, roleArgs),
    ).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(lastEvent().status).toBe("error");
  });
});
