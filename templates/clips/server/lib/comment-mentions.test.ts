import { describe, expect, it, vi } from "vitest";

const isOrgMember = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/org", () => ({ isOrgMember }));

import {
  displayCommentMentions,
  mentionsForCommentText,
} from "../../shared/comment-mentions";
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

describe("comment mention display and matching", () => {
  it("returns display names without recipient emails", () => {
    expect(
      displayCommentMentions([{ email: "member@example.com", name: "Member" }]),
    ).toEqual([{ name: "Member" }]);
  });

  it("does not match a shorter name inside a longer mention", () => {
    const mention = { email: "alex@example.com", name: "Alex" };
    expect(mentionsForCommentText("Thanks @Alexander", [mention])).toEqual([]);
    expect(mentionsForCommentText("Thanks @Alex!", [mention])).toEqual([
      mention,
    ]);
  });
});
