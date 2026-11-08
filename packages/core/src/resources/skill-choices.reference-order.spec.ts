import { describe, expect, it } from "vitest";

import { sortResourceSkills } from "../server/agent-chat/skill-frontmatter.js";
import { readSkillReference, type ReferencedSkill } from "./skill-choices.js";
import { SHARED_OWNER, sharedResourceOwner, WORKSPACE_OWNER } from "./store.js";

const ORG_ID = "org-1";
const OWN = "skills/release-notes/SKILL.md";
const LEGACY = "skills/release-notes-legacy/SKILL.md";
const DISPATCH = "skills/dispatch-release-notes/SKILL.md";

const files: Record<string, ReferencedSkill> = {
  [OWN]: {
    path: OWN,
    owner: sharedResourceOwner(ORG_ID),
    name: "release-notes",
    content: "The organization's own.",
    updatedAt: 1,
    required: true,
  },
  [LEGACY]: {
    path: LEGACY,
    owner: SHARED_OWNER,
    name: "release-notes",
    content: "Shared before organizations.",
    updatedAt: 9,
    required: true,
  },
  [DISPATCH]: {
    path: DISPATCH,
    owner: WORKSPACE_OWNER,
    name: "release-notes",
    content: "Dispatch's.",
    updatedAt: 20,
    required: true,
  },
};

describe("readSkillReference in the prompt's order", () => {
  it("reads the organization's own Required skill before a newer same-named older-style shared one", async () => {
    const choices = {
      switches: {},
      marks: {
        [`workspace:${DISPATCH}`]: "required" as const,
        [`organization:${LEGACY}`]: "required" as const,
        [`organization:${OWN}`]: "required" as const,
      },
    };
    const promptOrder = (skills: ReferencedSkill[]) =>
      sortResourceSkills(skills, { owner: "ana@example.test", orgId: ORG_ID });

    for (const path of [OWN, LEGACY, DISPATCH]) {
      await expect(
        readSkillReference(
          path,
          choices,
          async (at) => files[at] ?? null,
          promptOrder,
        ),
      ).resolves.toBe("The organization's own.");
    }
  });
});
