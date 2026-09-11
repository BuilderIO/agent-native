import { describe, expect, it, vi } from "vitest";

const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());
const readTriageConfigRowMock = vi.hoisted(() => vi.fn());

vi.mock("./factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingFactoryAutomationMock,
}));

vi.mock("./factory-scope.js", () => ({
  readTriageConfigRow: readTriageConfigRowMock,
}));

const db = {} as never;
const identity = { userEmail: "owner@example.com", orgId: "org-1" };

describe("factoryRepositoryFromSources", () => {
  it("prefers the automation repository over the config row", async () => {
    const { factoryRepositoryFromSources } =
      await import("./factory-repository-scope.js");
    expect(factoryRepositoryFromSources("acme/automation", "acme/row")).toBe(
      "acme/automation",
    );
  });

  it("falls back to the config row when the automation has none", async () => {
    const { factoryRepositoryFromSources } =
      await import("./factory-repository-scope.js");
    expect(factoryRepositoryFromSources("   ", "acme/row")).toBe("acme/row");
    expect(factoryRepositoryFromSources(null, "acme/row")).toBe("acme/row");
  });

  it("reports no repository rather than an empty string", async () => {
    const { factoryRepositoryFromSources } =
      await import("./factory-repository-scope.js");
    expect(factoryRepositoryFromSources(null, "  ")).toBeNull();
  });
});

describe("resolveFactoryRepository", () => {
  it("accepts the calling automation's repository when the row is empty", async () => {
    const { resolveFactoryRepository } =
      await import("./factory-repository-scope.js");
    readCallingFactoryAutomationMock.mockResolvedValue({
      config: { repository: "acme/automation" },
    });
    readTriageConfigRowMock.mockResolvedValue({ repository: null });

    await expect(
      resolveFactoryRepository(db, undefined, identity, "testingfactory"),
    ).resolves.toBe("acme/automation");
    expect(readTriageConfigRowMock).not.toHaveBeenCalled();
  });

  it("reads the config row when there is no calling automation", async () => {
    const { resolveFactoryRepository } =
      await import("./factory-repository-scope.js");
    readCallingFactoryAutomationMock.mockResolvedValue(null);
    readTriageConfigRowMock.mockResolvedValue({ repository: "acme/row" });

    await expect(
      resolveFactoryRepository(db, undefined, identity, "testingfactory"),
    ).resolves.toBe("acme/row");
  });

  it("returns null when neither source configures one", async () => {
    const { resolveFactoryRepository } =
      await import("./factory-repository-scope.js");
    readCallingFactoryAutomationMock.mockResolvedValue(null);
    readTriageConfigRowMock.mockResolvedValue(null);

    await expect(
      resolveFactoryRepository(db, undefined, identity, "testingfactory"),
    ).resolves.toBeNull();
  });
});
