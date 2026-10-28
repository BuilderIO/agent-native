import { describe, expect, it, vi } from "vitest";

import {
  ensurePreviewDevOrgMembership,
  shouldJoinPreviewDevOrg,
} from "./preview-dev-membership.js";

const dev = { productionLike: false, productionBuild: false };
const okEnv = {
  NODE_ENV: "development",
  AUTH_DISABLED: "1",
  WORKSPACE_PREVIEW_JOIN_ORG: "1",
} as NodeJS.ProcessEnv;

describe("shouldJoinPreviewDevOrg", () => {
  it("requires development, AUTH_DISABLED and the opt-in", () => {
    expect(shouldJoinPreviewDevOrg(okEnv, dev)).toBe(true);
    expect(
      shouldJoinPreviewDevOrg(
        { ...okEnv, WORKSPACE_PREVIEW_JOIN_ORG: "" },
        dev,
      ),
    ).toBe(false);
    expect(shouldJoinPreviewDevOrg({ ...okEnv, AUTH_DISABLED: "" }, dev)).toBe(
      false,
    );
    expect(shouldJoinPreviewDevOrg({ ...okEnv, NODE_ENV: "test" }, dev)).toBe(
      false,
    );
  });

  it("never fires in a production runtime", () => {
    expect(
      shouldJoinPreviewDevOrg(okEnv, {
        productionLike: true,
        productionBuild: false,
      }),
    ).toBe(false);
    expect(
      shouldJoinPreviewDevOrg(okEnv, {
        productionLike: false,
        productionBuild: true,
      }),
    ).toBe(false);
    expect(
      shouldJoinPreviewDevOrg({ ...okEnv, NODE_ENV: "production" }, dev),
    ).toBe(false);
  });
});

describe("ensurePreviewDevOrgMembership", () => {
  function exec(orgs: string[], members: boolean) {
    return {
      execute: vi.fn(async ({ sql }: { sql: string }) => {
        if (sql.includes("FROM organizations"))
          return { rows: orgs.map((id) => ({ id })), rowsAffected: 0 };
        if (sql.includes("FROM org_members"))
          return { rows: members ? [{}] : [], rowsAffected: 0 };
        return { rows: [], rowsAffected: 1 };
      }),
    };
  }

  it("does nothing when the guard fails", async () => {
    const e = exec(["o1"], false);
    const r = await ensurePreviewDevOrgMembership({
      env: {} as NodeJS.ProcessEnv,
      exec: e,
    });
    expect(r).toEqual({ status: "skipped" });
    expect(e.execute).not.toHaveBeenCalled();
  });

  it("joins the single org once and is idempotent", async () => {
    const e = exec(["o1"], false);
    const r = await ensurePreviewDevOrgMembership({ env: okEnv, exec: e });
    expect(r).toEqual({ status: "joined", orgId: "o1" });
    expect(
      e.execute.mock.calls.some(([q]) =>
        q.sql.includes("INSERT INTO org_members"),
      ),
    ).toBe(true);
    const again = exec(["o1"], true);
    expect(
      await ensurePreviewDevOrgMembership({ env: okEnv, exec: again }),
    ).toEqual({
      status: "already-member",
      orgId: "o1",
    });
    expect(
      again.execute.mock.calls.some(([q]) => q.sql.includes("INSERT")),
    ).toBe(false);
  });

  it("does not guess among multiple orgs or with none", async () => {
    expect(
      (
        await ensurePreviewDevOrgMembership({
          env: okEnv,
          exec: exec([], false),
        })
      ).status,
    ).toBe("no-org");
    expect(
      (
        await ensurePreviewDevOrgMembership({
          env: okEnv,
          exec: exec(["a", "b"], false),
        })
      ).status,
    ).toBe("ambiguous-org");
  });
});
