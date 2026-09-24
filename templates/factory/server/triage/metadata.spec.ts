import { describe, expect, it } from "vitest";

import { mergeTriageMetadata } from "./metadata.js";

describe("mergeTriageMetadata", () => {
  it("keeps slack claim markers when a poll envelope refreshes source fields", () => {
    const merged = JSON.parse(
      mergeTriageMetadata(
        JSON.stringify({
          slackReactionName: "robot_face",
          slackReactedAt: "2026-09-09T00:00:00.000Z",
          authorId: "U-old",
        }),
        {
          messageTs: "11.0",
          authorId: "U999",
          author: "U999",
        },
      ),
    ) as Record<string, string>;

    expect(merged.slackReactionName).toBe("robot_face");
    expect(merged.slackReactedAt).toBe("2026-09-09T00:00:00.000Z");
    expect(merged.messageTs).toBe("11.0");
    expect(merged.authorId).toBe("U999");
  });
});
