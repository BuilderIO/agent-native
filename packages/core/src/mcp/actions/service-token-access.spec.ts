import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

import { runWithRequestContext } from "../../server/request-context.js";
import {
  requireServiceTokenCaller,
  ServiceTokenError,
} from "./service-token-access.js";

beforeEach(() => {
  executeMock.mockReset().mockResolvedValue({ rows: [{ role: "owner" }] });
});

describe("org service-token access", () => {
  it("caps a delegated owner at member and denies service-token management", async () => {
    await expect(
      runWithRequestContext(
        {
          a2aIdentityAssurance: "org-member",
          userEmail: "owner@example.test",
          orgId: "org-1",
        },
        () =>
          requireServiceTokenCaller({
            userEmail: "owner@example.test",
            orgId: "org-1",
            level: "manage",
          }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Only org owners or admins can create or revoke service tokens.",
    });
    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls[0]?.[0].args).toEqual([
      "org-1",
      "owner@example.test",
    ]);
  });

  it("rejects mismatched delegated org scope without querying another org", async () => {
    await expect(
      runWithRequestContext(
        {
          a2aIdentityAssurance: "org-member",
          userEmail: "owner@example.test",
          orgId: "org-1",
        },
        () =>
          requireServiceTokenCaller({
            userEmail: "owner@example.test",
            orgId: "org-2",
            level: "read",
          }),
      ),
    ).rejects.toBeInstanceOf(ServiceTokenError);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("uses only the asserted org when a delegated caller omits an explicit scope", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ role: "member" }] });

    await expect(
      runWithRequestContext(
        {
          a2aIdentityAssurance: "org-member",
          userEmail: "member@example.test",
          orgId: "org-1",
        },
        () =>
          requireServiceTokenCaller({
            userEmail: "member@example.test",
            orgId: null,
            level: "read",
          }),
      ),
    ).resolves.toEqual({
      email: "member@example.test",
      orgId: "org-1",
      role: "member",
    });
    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls[0]?.[0].sql).toContain("SELECT role");
  });
});
