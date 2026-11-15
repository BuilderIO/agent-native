import { describe, expect, it } from "vitest";

import {
  isSkillMark,
  isSkillOn,
  NO_SKILL_CHOICES,
  SKILL_MARKS,
  skillChoiceKey,
  skillMarkFor,
  type SkillChoices,
  type SkillMark,
} from "./skill-choice-rules.js";

const PATH = "skills/brand-voice/SKILL.md";
const ORG = skillChoiceKey("organization", PATH);

function choices(
  mark: SkillMark | null,
  on: boolean | null,
  key = ORG,
): SkillChoices {
  return {
    switches: on === null ? {} : { [key]: { on, at: 1 } },
    marks: mark === null ? {} : { [key]: mark },
  };
}

describe("skill choice rules", () => {
  it("keys a choice by where the skill lives and its path", () => {
    expect(skillChoiceKey("organization", PATH)).toBe(
      "organization:skills/brand-voice/SKILL.md",
    );
    expect(skillChoiceKey("workspace", PATH)).toBe(
      "workspace:skills/brand-voice/SKILL.md",
    );
    expect(skillChoiceKey("personal", PATH)).toBe(
      "personal:skills/brand-voice/SKILL.md",
    );
  });

  it("offers Recommended, Optional and Required, in that order", () => {
    expect(SKILL_MARKS).toEqual(["recommended", "optional", "required"]);
    for (const mark of SKILL_MARKS) expect(isSkillMark(mark)).toBe(true);
    for (const value of ["Required", "", "on", null, undefined, 1, {}]) {
      expect(isSkillMark(value)).toBe(false);
    }
  });

  it("starts every skill as Recommended and on, with nothing stored", () => {
    expect(NO_SKILL_CHOICES).toEqual({ switches: {}, marks: {} });
    for (const source of ["personal", "organization", "workspace"] as const) {
      expect(skillMarkFor(NO_SKILL_CHOICES, source, PATH)).toBe("recommended");
      expect(isSkillOn(NO_SKILL_CHOICES, source, PATH)).toBe(true);
    }
  });

  it("reads a shared skill's mark for its own place only", () => {
    expect(skillMarkFor(choices("optional", null), "organization", PATH)).toBe(
      "optional",
    );
    expect(skillMarkFor(choices("required", null), "organization", PATH)).toBe(
      "required",
    );
    expect(skillMarkFor(choices("required", null), "workspace", PATH)).toBe(
      "recommended",
    );
    expect(
      skillMarkFor(choices("required", null), "organization", "skills/x.md"),
    ).toBe("recommended");
  });

  it("never marks a personal skill, so only its owner's switch counts", () => {
    const key = skillChoiceKey("personal", PATH);
    expect(skillMarkFor(choices("required", null, key), "personal", PATH)).toBe(
      "recommended",
    );
    expect(isSkillOn(choices("required", false, key), "personal", PATH)).toBe(
      false,
    );
    expect(isSkillOn(choices("optional", null, key), "personal", PATH)).toBe(
      true,
    );
  });

  it("keeps a Recommended skill on unless the person switched it off", () => {
    expect(isSkillOn(choices(null, null), "organization", PATH)).toBe(true);
    expect(isSkillOn(choices(null, true), "organization", PATH)).toBe(true);
    expect(isSkillOn(choices(null, false), "organization", PATH)).toBe(false);
    expect(isSkillOn(choices("recommended", false), "organization", PATH)).toBe(
      false,
    );
  });

  it("keeps an Optional skill off unless the person switched it on", () => {
    expect(isSkillOn(choices("optional", null), "organization", PATH)).toBe(
      false,
    );
    expect(isSkillOn(choices("optional", false), "organization", PATH)).toBe(
      false,
    );
    expect(isSkillOn(choices("optional", true), "organization", PATH)).toBe(
      true,
    );
  });

  it("keeps a Required skill on whatever the person switched", () => {
    expect(isSkillOn(choices("required", null), "organization", PATH)).toBe(
      true,
    );
    expect(isSkillOn(choices("required", false), "organization", PATH)).toBe(
      true,
    );
    const workspace = skillChoiceKey("workspace", PATH);
    expect(
      isSkillOn(choices("required", false, workspace), "workspace", PATH),
    ).toBe(true);
  });

  it("reads a person's switch for that skill only", () => {
    const other = skillChoiceKey("organization", "skills/other/SKILL.md");
    expect(isSkillOn(choices(null, false, other), "organization", PATH)).toBe(
      true,
    );
    expect(
      isSkillOn(
        {
          switches: { [other]: { on: true, at: 1 } },
          marks: { [ORG]: "optional" },
        },
        "organization",
        PATH,
      ),
    ).toBe(false);
  });
});
