import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const putOrgSetting = vi.hoisted(() => vi.fn());

vi.mock("../server/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/auth.js")>()),
  getSession: session,
}));
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute }),
}));
vi.mock("../settings/user-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/user-settings.js")>()),
  getUserSetting: vi.fn(async () => null),
}));
vi.mock("../settings/org-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/org-settings.js")>()),
  putOrgSetting,
}));

import { SessionResolutionUnavailableError } from "../server/session-resolution-errors.js";
import { getOrgContext } from "./context.js";
import { setWorkspaceAppDefaultVisibilityHandler } from "./handlers.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";

function event() {
  return mockEvent(
    new Request("http://example.test/_agent-native/org/app-defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "org" }),
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  invalidateMemberOrgCaches();
  session.mockResolvedValue({
    email: "owner@example.test",
    orgId: "acme",
    orgRole: "owner",
  });
  putOrgSetting.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("organization mutation authority", () => {
  it.each(["owner", "admin"])(
    "refuses a cached %s role when membership cannot be read",
    async (orgRole) => {
      session.mockResolvedValue({
        email: "owner@example.test",
        orgId: "acme",
        orgRole,
      });
      const cause = Object.assign(
        new Error("fake private membership failure"),
        {
          code: "57014",
        },
      );
      execute.mockRejectedValue(cause);

      const error = await setWorkspaceAppDefaultVisibilityHandler(event()).then(
        () => undefined,
        (failure: unknown) => failure,
      );

      expect(error).toBeInstanceOf(SessionResolutionUnavailableError);
      expect(error).toMatchObject({
        statusCode: 503,
        headers: { "Retry-After": "5" },
        cause,
      });
      expect(putOrgSetting).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "admin", "member"])(
    "uses verified membership rather than the claimed owner role (%s)",
    async (role) => {
      execute.mockResolvedValue({
        rows: [{ orgId: "acme", orgName: "Example", role }],
      });
      if (role === "member") {
        await expect(
          setWorkspaceAppDefaultVisibilityHandler(event()),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(putOrgSetting).not.toHaveBeenCalled();
      } else {
        await expect(
          setWorkspaceAppDefaultVisibilityHandler(event()),
        ).resolves.toEqual({ visibility: "org" });
        expect(putOrgSetting).toHaveBeenCalledExactlyOnceWith(
          "acme",
          "workspace-app-default-visibility",
          { visibility: "org" },
        );
      }
    },
  );

  it("does not return an unverified role to concurrent context readers", async () => {
    const cause = Object.assign(new Error("fake temporary lookup failure"), {
      code: "57014",
    });
    execute.mockRejectedValue(cause);
    const request = event();

    const results = await Promise.allSettled([
      getOrgContext(request),
      getOrgContext(request),
    ]);

    expect(results).toEqual([
      {
        status: "rejected",
        reason: expect.any(SessionResolutionUnavailableError),
      },
      {
        status: "rejected",
        reason: expect.any(SessionResolutionUnavailableError),
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
