import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "manual",
  execute: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async () => ({ mode: mocks.mode }),
}));

import { findUngrantedVaultKeys } from "./vault-grants.js";

describe("findUngrantedVaultKeys", () => {
  beforeEach(() => {
    mocks.mode = "manual";
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue({ rows: [] });
  });

  it("matches keys case-insensitively, including provider aliases", async () => {
    await findUngrantedVaultKeys("org-1", "dispatch", [
      { key: "secret_key" },
      { key: "hubspot_access_token", provider: "hubspot" },
    ]);
    const { sql, args } = mocks.execute.mock.calls[0]![0];
    expect(sql).toContain("UPPER(secrets.credential_key) IN");
    expect(args).toEqual([
      "dispatch",
      "org-1",
      "SECRET_KEY",
      "HUBSPOT_ACCESS_TOKEN",
      "HUBSPOT_PRIVATE_APP_TOKEN",
      "HUBSPOT_SECRET_KEY",
    ]);
  });

  it("returns only keys without an active grant", async () => {
    mocks.execute.mockResolvedValue({
      rows: [
        { credential_key: "A", granted: 1 },
        { credential_key: "B", granted: 0 },
      ],
    });
    await expect(
      findUngrantedVaultKeys("org-1", "dispatch", [{ key: "A" }, { key: "B" }]),
    ).resolves.toEqual(["B"]);
  });

  it("does not query outside manual mode or for user-scoped refs", async () => {
    await findUngrantedVaultKeys("org-1", "dispatch", [
      { key: "A", scope: "user" },
    ]);
    mocks.mode = "all-apps";
    await expect(
      findUngrantedVaultKeys("org-1", "dispatch", [{ key: "A" }]),
    ).resolves.toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("propagates lookup failures instead of treating keys as granted", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    await expect(
      findUngrantedVaultKeys("org-1", "dispatch", [{ key: "A" }]),
    ).rejects.toThrow("db down");
  });
});
