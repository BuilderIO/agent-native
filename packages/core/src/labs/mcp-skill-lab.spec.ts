import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: state.execute }),
}));

import { runWithRequestContext } from "../server/request-context.js";
import { getMcpSkillLabEnabled } from "./mcp-skill-lab.js";
import { _resetLabRegistryForTests, registerLabs } from "./registry.js";
import { registerHostLabOverrides } from "./store.js";

const identity = {
  userEmail: "alice@example.test",
  identityAssurance: "user" as const,
  orgId: "org-a",
};
const context = { userEmail: identity.userEmail, orgId: identity.orgId };

beforeEach(() => {
  _resetLabRegistryForTests();
  registerHostLabOverrides(null);
  registerLabs([{ key: "test.skill", legacyFlagKeys: ["test.flag"] }]);
  state.execute.mockReset();
  state.execute.mockImplementation(
    async ({ sql, args }: { sql: string; args: string[] }) => {
      if (!/^SELECT\b/i.test(sql))
        throw new Error("write or schema initialization");
      if (args[0] === "o:org-a:feature-flag:test.flag")
        return {
          rows: [{ value: JSON.stringify({ mode: "on" }) }],
          rowsAffected: 0,
        };
      return { rows: [], rowsAffected: 0 };
    },
  );
});

describe("read-only MCP skill labs", () => {
  it("uses the existing lab resolver with current org rules and SELECT only", async () => {
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).resolves.toBe(true);
    expect(
      state.execute.mock.calls.some(
        ([query]) => query.args[0] === "o:org-a:feature-flag:test.flag",
      ),
    ).toBe(true);
    expect(
      state.execute.mock.calls.some(
        ([query]) => query.args[0] === "feature-flag:test.flag",
      ),
    ).toBe(true);
    expect(
      state.execute.mock.calls.every(([query]) => /^SELECT\b/i.test(query.sql)),
    ).toBe(true);
  });
  it("honors host overrides and fails closed for unverified or mismatched caller", async () => {
    registerHostLabOverrides(() => true);
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).resolves.toBe(true);
    state.execute.mockClear();
    await expect(
      runWithRequestContext(
        { ...context, userEmail: "other@example.test" },
        () => getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled(
          { ...identity, identityAssurance: "organization" },
          "test.skill",
        ),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext({ ...context, orgId: "org-b" }, () =>
        getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).rejects.toThrow();
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("requires an explicit nonblank organization binding or explicit personal scope", async () => {
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled({ ...identity, orgId: undefined }, "test.skill"),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext({ ...context, orgId: "" }, () =>
        getMcpSkillLabEnabled({ ...identity, orgId: "" }, "test.skill"),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext({ ...context, orgId: " " }, () =>
        getMcpSkillLabEnabled({ ...identity, orgId: " " }, "test.skill"),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled({ ...identity, orgId: null }, "test.skill"),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext({ ...context, orgScope: "personal" }, () =>
        getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).rejects.toThrow();
    expect(state.execute).not.toHaveBeenCalled();
    await expect(
      runWithRequestContext(
        { userEmail: identity.userEmail, orgScope: "personal" },
        () => getMcpSkillLabEnabled({ ...identity, orgId: null }, "test.skill"),
      ),
    ).resolves.toBe(false);
    expect(
      state.execute.mock.calls.some(([query]) =>
        query.args[0]?.startsWith("o:"),
      ),
    ).toBe(false);
  });
  it("fails closed for malformed settings, unknown lab and database errors", async () => {
    state.execute.mockImplementationOnce(async () => ({
      rows: [{ value: JSON.stringify({ "test.skill": "yes" }) }],
      rowsAffected: 0,
    }));
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).rejects.toThrow(/Invalid saved lab choice/);
    state.execute.mockRejectedValue(new Error("unavailable"));
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled(identity, "test.skill"),
      ),
    ).rejects.toThrow();
    await expect(
      runWithRequestContext(context, () =>
        getMcpSkillLabEnabled(identity, "unknown"),
      ),
    ).rejects.toThrow();
  });
});
