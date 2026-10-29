import {
  getReviewableResource,
  type ReviewComment,
} from "@agent-native/core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  migrate: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("./slide-review-migration.js", () => ({
  ensureSlideReviewMigrated: mocks.migrate,
}));

import "./slide-review.js";

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

const DECK = {
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  visibility: "org",
};

beforeEach(() => vi.clearAllMocks());

describe("deck review registration", () => {
  it("sends comment email under the Slides prefs key and template, linking the thread", async () => {
    const options = getReviewableResource("deck")?.commentNotifications;

    expect(options?.preferenceKey).toBe("slides-user-prefs");
    expect(options?.templateId).toBe("slides.deck-comment");
    const url = new URL(
      String(
        await options?.resolveThreadUrl?.({
          resourceId: "deck-1",
          threadId: "thread-7",
        } as ReviewComment),
      ),
    );
    expect(url.pathname).toBe("/deck/deck-1");
    expect(url.searchParams.get("comment")).toBe("thread-7");
    expect(url.searchParams.has("slide")).toBe(false);
  });

  it("copies a deck's legacy comments before granting access", async () => {
    mocks.resolveAccess.mockResolvedValue({ role: "editor", resource: DECK });
    const resolve = present(
      present(getReviewableResource("deck")).resolveAccess,
    );

    await expect(
      resolve("deck-1", { userEmail: "owner@example.com" }),
    ).resolves.toEqual({
      role: "editor",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "org",
    });
    expect(mocks.migrate).toHaveBeenCalledWith("deck-1", DECK);
  });

  it("skips the copy inside a transaction and for a deck the caller cannot open", async () => {
    mocks.resolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: DECK,
    });
    const resolve = present(
      present(getReviewableResource("deck")).resolveAccess,
    );

    await resolve("deck-1", { userEmail: "a@example.com", transaction: {} });
    mocks.resolveAccess.mockResolvedValueOnce(null);
    await expect(
      resolve("deck-2", { userEmail: "a@example.com" }),
    ).resolves.toBeNull();

    expect(mocks.migrate).not.toHaveBeenCalled();
  });
});
