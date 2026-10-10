import { describe, expect, it } from "vitest";

import { uploadedSkillSlug } from "./skill-upload.js";

describe("uploadedSkillSlug", () => {
  it("gives standard SKILL.md uploads stable paths from their declared names", () => {
    expect(
      uploadedSkillSlug("SKILL.md", "---\nname: create-skill\n---\nFirst"),
    ).toBe("create-skill");
    expect(
      uploadedSkillSlug("SKILL.md", "---\nname: review-feedback\n---\nSecond"),
    ).toBe("review-feedback");
    expect(
      uploadedSkillSlug("renamed.md", "---\nname: create-skill\n---\nUpdated"),
    ).toBe("create-skill");
  });

  it("uses the existing frontmatter parser for quoted and folded names", () => {
    expect(
      uploadedSkillSlug("SKILL.md", '---\r\nname: "Release Notes"\r\n---\r\n'),
    ).toBe("release-notes");
    expect(
      uploadedSkillSlug("SKILL.md", "---\nname: >-\n  Release Notes\n---\n"),
    ).toBe("release-notes");
  });

  it("preserves filename fallback for Markdown without a declared name", () => {
    expect(uploadedSkillSlug("Review Feedback.md", "# Notes")).toBe(
      "review-feedback",
    );
    expect(uploadedSkillSlug("SKILL.md", "---\nname: \n---\n# Notes")).toBe(
      "uploaded-skill",
    );
  });
});
