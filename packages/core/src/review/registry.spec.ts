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
  __resetReviewableResourcesForTests,
  assertReviewableResourceAccess,
  registerReviewableResource,
  resolveReviewableResourceAccess,
} = await import("./registry.js");

beforeEach(() => {
  __resetReviewableResourcesForTests();
  vi.mocked(resolveAccess).mockReset();
  vi.mocked(getShareableResource).mockReset();
  vi.mocked(getShareableResource).mockReturnValue(undefined);
});

afterEach(() => {
  __resetReviewableResourcesForTests();
  vi.clearAllMocks();
});

describe("reviewable resource registry", () => {
  it("fails closed for unregistered resource types", async () => {
    await expect(
      resolveReviewableResourceAccess("mystery", "abc", {
        userEmail: "bob@example.com",
      }),
    ).resolves.toBeNull();

    await expect(
      assertReviewableResourceAccess(
        "mystery",
        "abc",
        { userEmail: "bob@example.com" },
        "viewer",
      ),
    ).rejects.toThrow(/Not allowed/);
  });

  it("fails closed for registered types without an access resolver or shareable binding", async () => {
    registerReviewableResource({ type: "doc" });
    await expect(
      resolveReviewableResourceAccess("doc", "d1", {
        userEmail: "alice@example.com",
      }),
    ).resolves.toBeNull();
  });

  it("passes action context into shareable resolveAccess", async () => {
    vi.mocked(getShareableResource).mockReturnValue({ type: "doc" } as never);
    vi.mocked(resolveAccess).mockResolvedValue({
      role: "editor",
      resource: {
        ownerEmail: "alice@example.com",
        orgId: null,
        visibility: "private",
      },
    } as never);

    const access = await resolveReviewableResourceAccess("doc", "d1", {
      userEmail: "bob@example.com",
    });

    expect(resolveAccess).toHaveBeenCalledWith("doc", "d1", {
      userEmail: "bob@example.com",
      orgId: undefined,
    });
    expect(access).toMatchObject({
      role: "editor",
      ownerEmail: "alice@example.com",
    });
  });
});
