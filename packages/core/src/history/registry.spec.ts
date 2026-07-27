import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sharing/access.js", () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ForbiddenError";
    }
  },
  resolveAccess: vi.fn(),
}));

vi.mock("../sharing/registry.js", () => ({
  getShareableResource: vi.fn(),
}));

const { resolveAccess } = await import("../sharing/access.js");
const { getShareableResource } = await import("../sharing/registry.js");
const {
  __resetVersionedResourcesForTests,
  assertVersionedResourceAccess,
  registerVersionedResource,
  resolveVersionedResourceAccess,
} = await import("./registry.js");

beforeEach(() => {
  __resetVersionedResourcesForTests();
  vi.mocked(resolveAccess).mockReset();
  vi.mocked(getShareableResource).mockReset();
  vi.mocked(getShareableResource).mockReturnValue(undefined);
});

afterEach(() => {
  __resetVersionedResourcesForTests();
  vi.clearAllMocks();
});

describe("versioned resource registry", () => {
  it("fails closed for unregistered resource types", async () => {
    await expect(
      resolveVersionedResourceAccess("mystery", "abc", {
        userEmail: "bob@example.com",
      }),
    ).resolves.toBeNull();

    await expect(
      assertVersionedResourceAccess(
        "mystery",
        "abc",
        { userEmail: "bob@example.com" },
        "viewer",
      ),
    ).rejects.toThrow(/Not allowed/);
  });

  it("fails closed for registered types without an access resolver or shareable binding", async () => {
    registerVersionedResource({ type: "doc" });
    await expect(
      resolveVersionedResourceAccess("doc", "d1", {
        userEmail: "alice@example.com",
      }),
    ).resolves.toBeNull();
  });

  it("uses custom resolveAccess when registered", async () => {
    registerVersionedResource({
      type: "doc",
      resolveAccess: async () => ({
        role: "editor",
        ownerEmail: "alice@example.com",
        visibility: "private",
      }),
    });

    await expect(
      resolveVersionedResourceAccess("doc", "d1", {
        userEmail: "bob@example.com",
      }),
    ).resolves.toMatchObject({
      role: "editor",
      ownerEmail: "alice@example.com",
    });
  });

  it("passes action context into shareable resolveAccess", async () => {
    vi.mocked(getShareableResource).mockReturnValue({ type: "doc" } as never);
    vi.mocked(resolveAccess).mockResolvedValue({
      role: "viewer",
      resource: {
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        visibility: "org",
      },
    } as never);

    const access = await resolveVersionedResourceAccess("doc", "d1", {
      userEmail: "bob@example.com",
      orgId: "org-1",
    });

    expect(resolveAccess).toHaveBeenCalledWith("doc", "d1", {
      userEmail: "bob@example.com",
      orgId: "org-1",
    });
    expect(access).toMatchObject({
      role: "viewer",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      visibility: "org",
    });
  });
});
