import { beforeEach, describe, expect, it, vi } from "vitest";

const readRoleMock = vi.hoisted(() => vi.fn());
vi.mock("./personal-provider-key-policy.js", () => ({
  readOrgMemberRole: readRoleMock,
}));

import {
  orderCredentialScopes,
  readsOrgCredentialFirst,
} from "./credential-read-order.js";
import { runWithRequestContext } from "./request-context.js";

const refs = [
  { scope: "user", scopeId: "a@b.com" },
  { scope: "org", scopeId: "org-1" },
  { scope: "workspace", scopeId: "org-1" },
  { scope: "workspace", scopeId: "solo:a@b.com" },
];

beforeEach(() => readRoleMock.mockReset());

describe("credential read order", () => {
  it("puts the org's rows first for owners and admins only", async () => {
    for (const [role, first] of [
      ["owner", "org"],
      ["admin", "org"],
      ["member", "user"],
      [null, "user"],
    ] as const) {
      readRoleMock.mockResolvedValue(role);
      const ordered = await orderCredentialScopes(refs, "org-1", "a@b.com");
      expect(ordered[0].scope).toBe(first);
      if (first === "org") {
        expect(ordered.map((r) => r.scopeId)).toEqual([
          "org-1",
          "org-1",
          "a@b.com",
          "solo:a@b.com",
        ]);
      }
    }
  });

  it("reads no role without an org or without both kinds of rows", async () => {
    await expect(readsOrgCredentialFirst(null, "a@b.com")).resolves.toBe(false);
    await orderCredentialScopes(refs.slice(0, 1), "org-1", "a@b.com");
    await orderCredentialScopes(refs.slice(1, 3), "org-1", "a@b.com");
    expect(readRoleMock).not.toHaveBeenCalled();
  });

  it("throws on an unreadable role and treats missing org tables as no managers", async () => {
    readRoleMock.mockRejectedValueOnce(new Error("db query timed out"));
    await expect(readsOrgCredentialFirst("org-1", "a@b.com")).rejects.toThrow(
      "db query timed out",
    );
    readRoleMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "42P01" }),
    );
    await expect(readsOrgCredentialFirst("org-1", "a@b.com")).resolves.toBe(
      false,
    );
  });

  it("reads the role once per request, and retries a failed read", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      readRoleMock.mockRejectedValueOnce(new Error("blip"));
      await expect(readsOrgCredentialFirst("org-1", "A@b.com")).rejects.toThrow(
        "blip",
      );
      readRoleMock.mockResolvedValue("admin");
      await expect(readsOrgCredentialFirst("org-1", "a@b.com")).resolves.toBe(
        true,
      );
      await expect(readsOrgCredentialFirst("org-1", "a@b.com")).resolves.toBe(
        true,
      );
    });
    expect(readRoleMock).toHaveBeenCalledTimes(2);
  });
});
