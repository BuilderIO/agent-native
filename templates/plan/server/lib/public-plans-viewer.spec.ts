import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adversarial coverage for the public-viewer identity in public-plans.ts.
 *
 * GUEST MODE + CLAIM contract: a guest who publishes a public plan and then
 * claims an account must NOT have the anonymous public reviewer link collapse
 * into their now-real account. The public-viewer cookie + identity is a SEPARATE
 * namespace (`public-*@agent-native.local`) from the guest-author identity
 * (`guest-*@agent-native.guest`). This file pins that disjointness and the
 * "private plans are not readable as an anonymous viewer" gate.
 *
 * Kept in its own file so the `vi.mock` registrations for public-plans's deps do
 * not collide with the claim-middleware mocks in guest-claim-adversarial.spec.ts.
 */

const cookieStore = new Map<string, string>();
const selectMock = vi.fn();

vi.mock("h3", () => ({
  getCookie: (_e: unknown, name: string) => cookieStore.get(name),
  setCookie: (_e: unknown, name: string, value: string) =>
    cookieStore.set(name, value),
  deleteCookie: (_e: unknown, name: string) => cookieStore.delete(name),
  getHeader: (_e: unknown, name: string) =>
    name === "host" ? "example.com" : undefined,
}));

vi.mock("drizzle-orm", () => ({ eq: (c: unknown, v: unknown) => ({ c, v }) }));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selectMock() }),
      }),
    }),
  }),
  schema: { plans: { id: "plans.id", visibility: "plans.visibility" } },
}));

vi.mock("./guest-abuse.js", () => ({
  GuestAbuseLimitError: class extends Error {},
  tryConsumeGuestMint: async () => true,
}));

const {
  resolvePublicPlanViewerOwner,
  readGuestAuthorEmail,
  isGuestAuthorIdentity,
  GUEST_AUTHOR_COOKIE,
} = await import("./public-plans.js");

function eventForPlan(id: string) {
  return { node: { req: { url: `/plans/${id}` } } } as never;
}

describe("public-viewer stays anonymous & disjoint from the guest identity", () => {
  beforeEach(() => {
    cookieStore.clear();
    selectMock.mockReset();
  });

  afterEach(() => {
    cookieStore.clear();
  });

  it("a public reviewer of a guest's published plan gets a public-* identity, NOT the guest identity", async () => {
    selectMock.mockResolvedValue([{ id: "pub1", visibility: "public" }]);
    const viewerOwner = await resolvePublicPlanViewerOwner(
      eventForPlan("pub1"),
    );
    expect(viewerOwner).toMatch(/^public-[0-9a-f-]{36}@agent-native\.local$/);
    // It is NOT a guest identity, so claiming an account never collapses the
    // anonymous reviewer link into the author's now-real account.
    expect(isGuestAuthorIdentity(viewerOwner!)).toBe(false);
  });

  it("the public-viewer cookie and the guest-author cookie are independent namespaces", async () => {
    cookieStore.set(
      GUEST_AUTHOR_COOKIE,
      "abcdef12-3456-7890-abcd-ef1234567890",
    );
    selectMock.mockResolvedValue([{ id: "pub1", visibility: "public" }]);
    const viewerOwner = await resolvePublicPlanViewerOwner(
      eventForPlan("pub1"),
    );
    const guestEmail = readGuestAuthorEmail(eventForPlan("pub1"));

    expect(guestEmail).toBe(
      "guest-abcdef12-3456-7890-abcd-ef1234567890@agent-native.guest",
    );
    // The public viewer id is freshly minted and unrelated to the guest uuid.
    expect(viewerOwner).not.toContain("abcdef12-3456-7890-abcd-ef1234567890");
    expect(viewerOwner).toMatch(/^public-/);
  });

  it("reuses an existing public-viewer cookie rather than re-minting per request", async () => {
    selectMock.mockResolvedValue([{ id: "pub1", visibility: "public" }]);
    const first = await resolvePublicPlanViewerOwner(eventForPlan("pub1"));
    const second = await resolvePublicPlanViewerOwner(eventForPlan("pub1"));
    expect(first).toBe(second);
  });

  it("returns null (no anonymous owner) when the targeted plan is private — guests cannot read others' private plans as a viewer", async () => {
    selectMock.mockResolvedValue([{ id: "priv1", visibility: "private" }]);
    const owner = await resolvePublicPlanViewerOwner(eventForPlan("priv1"));
    expect(owner).toBeNull();
  });

  it("returns null when the plan does not exist", async () => {
    selectMock.mockResolvedValue([]);
    const owner = await resolvePublicPlanViewerOwner(eventForPlan("ghost"));
    expect(owner).toBeNull();
  });
});
