import { describe, expect, it, vi } from "vitest";

const readOrgMemberRole = vi.fn(async () => "admin");
const getContext = vi.fn(() => ({
  userEmail: "user@example.com",
  orgId: "org-1",
}));
const factory = vi.fn((options: Record<string, unknown>) => ({
  options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: getContext,
}));
vi.mock("@agent-native/core/server", () => ({ readOrgMemberRole }));
vi.mock(
  "@agent-native/core/provider-api/actions/custom-provider-registration",
  () => ({
    CustomProviderRegistrationSchema: {
      superRefine: (fn: Function) => ({ fn }),
    },
    createCustomProviderRegistrationAction: factory,
  }),
);

describe("Analytics provider-api-register", () => {
  it("uses the shared factory, POST transport, and org role resolver", async () => {
    const action = (await import("./provider-api-register"))["default"] as any;
    expect(action.http).toEqual({ method: "POST" });
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ getContext: getContext }),
    );
    const options = factory.mock.calls[0][0] as any;
    expect(options.resolveOrgRole).toBeTypeOf("function");
    await expect(
      options.resolveOrgRole("org-1", "USER@example.com"),
    ).resolves.toBe("admin");
    expect(readOrgMemberRole).toHaveBeenCalledWith("org-1", "USER@example.com");
  });

  it("uses the effective member role for a delegated organization admin", async () => {
    readOrgMemberRole.mockResolvedValue("member");
    const action = (await import("./provider-api-register"))["default"] as any;
    const options = factory.mock.calls.at(-1)?.[0] as any;

    await expect(
      options.resolveOrgRole("org-1", "admin@example.com"),
    ).resolves.toBe("member");
  });

  it.each([
    { orgId: "org-1", email: "other@example.com" },
    { orgId: "org-2", email: "user@example.com" },
  ])(
    "returns no role for a delegated identity mismatch rejected by the shared resolver: %o",
    async (identity) => {
      readOrgMemberRole.mockResolvedValue(null);
      await import("./provider-api-register");
      const options = factory.mock.calls[0][0] as any;

      await expect(
        options.resolveOrgRole(identity.orgId, identity.email),
      ).resolves.toBeNull();
      expect(readOrgMemberRole).toHaveBeenCalledWith(
        identity.orgId,
        identity.email,
      );
    },
  );

  it("adds the HTTPS-only wrapper validation", async () => {
    await import("./provider-api-register");
    const options = factory.mock.calls[0][0] as any;
    const issues: unknown[] = [];
    options.schema.fn(
      { operation: "upsert", baseUrl: "http://api.example.com" },
      { addIssue: (issue: unknown) => issues.push(issue) },
    );
    expect(issues).toEqual([expect.objectContaining({ path: ["baseUrl"] })]);
  });
});
