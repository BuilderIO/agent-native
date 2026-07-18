import { describe, expect, it, vi } from "vitest";

const handlePrivateVaultBrokerRoute = vi.hoisted(() => vi.fn());
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
}));
vi.mock("../../../../../lib/private-vault-broker-routes.js", () => ({
  handlePrivateVaultBrokerRoute: (...args: unknown[]) =>
    handlePrivateVaultBrokerRoute(...args),
}));

import handler from "./claim.post";

describe("Private Vault broker claim route", () => {
  it("delegates only to the fixed signed broker claim surface", async () => {
    const event = {} as never;
    handlePrivateVaultBrokerRoute.mockResolvedValue(Uint8Array.of(1));
    await expect(handler(event)).resolves.toEqual(Uint8Array.of(1));
    expect(handlePrivateVaultBrokerRoute).toHaveBeenCalledWith(event, "claim");
  });
});
