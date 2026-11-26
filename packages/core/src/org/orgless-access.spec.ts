import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ trusted: false }));
const admins = vi.hoisted(() => ({ list: [] as string[] }));

vi.mock("../server/credential-provider.js", () => ({
  isTrustedSelfHostedRuntime: () => runtime.trusted,
}));
vi.mock("./signup-admission.js", () => ({
  isBootstrapAdmin: (email: string) =>
    admins.list.includes(email.trim().toLowerCase()),
}));

const { canManageDeploymentWithoutOrg } = await import("./orgless-access.js");

describe("canManageDeploymentWithoutOrg", () => {
  afterEach(() => {
    runtime.trusted = false;
    admins.list = [];
  });

  it("refuses an ordinary account on a hosted deployment", () => {
    expect(canManageDeploymentWithoutOrg("someone@example.com")).toBe(false);
    expect(canManageDeploymentWithoutOrg(null)).toBe(false);
  });

  it("allows a bootstrap admin on a hosted deployment", () => {
    admins.list = ["admin@example.com"];
    expect(canManageDeploymentWithoutOrg(" admin@example.com ")).toBe(true);
    expect(canManageDeploymentWithoutOrg("someone@example.com")).toBe(false);
  });

  it("allows any signed-in caller on a local self-hosted runtime", () => {
    runtime.trusted = true;
    expect(canManageDeploymentWithoutOrg("someone@example.com")).toBe(true);
  });
});
