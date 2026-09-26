import { afterEach, describe, expect, it, vi } from "vitest";

describe("validateProviderBaseUrl fake-ip DNS", () => {
  afterEach(() => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("rejects a public hostname whose DNS answer is in 198.18.0.0/15", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "198.18.0.12", family: 4 }],
    }));
    vi.resetModules();
    const { validateProviderBaseUrl } =
      await import("./provider-endpoint-validation.js");

    await expect(
      validateProviderBaseUrl("https://cloud.google.com/v1"),
    ).rejects.toThrow(/private\/internal address/);
  });

  it("still rejects a literal benchmark address and a real private DNS answer", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "10.0.0.1", family: 4 }],
    }));
    vi.resetModules();
    const { validateProviderBaseUrl } =
      await import("./provider-endpoint-validation.js");

    await expect(validateProviderBaseUrl("http://198.18.0.1/")).rejects.toThrow(
      /private\/internal address/,
    );
    await expect(
      validateProviderBaseUrl("https://internal.example/v1"),
    ).rejects.toThrow(/private\/internal address/);
  });
});
