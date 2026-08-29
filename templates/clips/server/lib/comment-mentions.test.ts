import { describe, expect, it, vi } from "vitest";

const isOrgMember = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/org", () => ({ isOrgMember }));

import { resolveCommentMentions } from "./comment-mentions";

describe("resolveCommentMentions", () => {
  it("normalizes mentions and keeps only organization members", async () => {
    isOrgMember.mockImplementation(
      async (_organizationId: string, email: string) =>
        email === "member@example.com",
    );

    await expect(
      resolveCommentMentions(
        [
          { email: "Member@Example.com", name: "Member" },
          { email: "outsider@example.com", name: "Outsider" },
        ],
        "org-1",
      ),
    ).resolves.toEqual([{ email: "member@example.com", name: "Member" }]);
  });
});
