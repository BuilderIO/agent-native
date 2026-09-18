import { describe, expect, it, vi } from "vitest";

const execute = vi.fn(async () => ({ rows: [{ role: "admin" }] }));
const getContext = vi.fn(() => ({
  userEmail: "user@example.com",
  orgId: "org-1",
}));
const factory = vi.fn((options: Record<string, unknown>) => ({
  options,
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: getContext,
}));
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
    expect(execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("org_members"),
      args: ["org-1", "user@example.com"],
    });
  });

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
