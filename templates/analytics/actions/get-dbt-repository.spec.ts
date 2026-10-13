import { beforeEach, describe, expect, it, vi } from "vitest";

const orgSettings = new Map<string, Record<string, unknown>>();
const session = {
  email: "member@example.com" as string | undefined,
  orgId: "org-1" as string | undefined,
};

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => session.orgId,
  getRequestUserEmail: () => session.email,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: vi.fn(
    async (orgId: string, key: string) =>
      orgSettings.get(`${orgId}:${key}`) ?? null,
  ),
  putOrgSetting: vi.fn(),
}));

const { default: getDbtRepository } = await import("./get-dbt-repository");

describe("get-dbt-repository action", () => {
  beforeEach(() => {
    orgSettings.clear();
    session.email = "member@example.com";
    session.orgId = "org-1";
  });

  it("returns null when no dbt repository is saved", async () => {
    await expect(getDbtRepository.run({}, {} as never)).resolves.toBeNull();
  });

  it("returns the saved repository for the active organization", async () => {
    orgSettings.set("org-1:analytics-dbt-repository", {
      owner: "acme",
      repo: "analytics-dbt",
    });

    await expect(getDbtRepository.run({}, {} as never)).resolves.toEqual({
      owner: "acme",
      repo: "analytics-dbt",
    });
  });

  it("does not read another organization's repository", async () => {
    orgSettings.set("org-2:analytics-dbt-repository", {
      owner: "other",
      repo: "secret-dbt",
    });

    await expect(getDbtRepository.run({}, {} as never)).resolves.toBeNull();
  });

  it("fails loudly when the stored value is malformed instead of returning null", async () => {
    orgSettings.set("org-1:analytics-dbt-repository", {
      owner: "acme/evil",
      repo: "dbt",
    });

    await expect(getDbtRepository.run({}, {} as never)).rejects.toThrow(
      /invalid/,
    );
  });

  it("requires a signed-in user", async () => {
    session.email = undefined;

    await expect(getDbtRepository.run({}, {} as never)).rejects.toThrow(
      /Sign in/,
    );
  });

  it("requires an active organization", async () => {
    session.orgId = undefined;

    await expect(getDbtRepository.run({}, {} as never)).rejects.toThrow(
      /organization/,
    );
  });
});
