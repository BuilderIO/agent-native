/**
 * Who uses which skill. Each person switches skills on or off for themselves,
 * and an organization admin marks each shared skill with how it starts for
 * people. Every skill starts as Recommended, so nothing changes until someone
 * acts. Pure, so Settings and the server read choices the same way.
 */

/** Where a skill comes from, as Settings groups it. */
export type SkillSource = "personal" | "organization" | "workspace";

/**
 * How a shared skill starts for each person. Recommended is on unless they
 * switch it off; Optional is off unless they switch it on; Required is on for
 * everyone, and wins over a same-named skill of their own.
 */
export type SkillMark = "recommended" | "optional" | "required";

export const SKILL_MARKS = [
  "recommended",
  "optional",
  "required",
] as const satisfies readonly SkillMark[];

/** One person's switch on one skill, and when they flipped it. */
export interface SkillSwitch {
  on: boolean;
  at: number;
}

export interface SkillChoices {
  /** The person's own switches, by `skillChoiceKey`. Absent: never touched. */
  switches: Readonly<Record<string, SkillSwitch>>;
  /** Marks other than Recommended, by `skillChoiceKey`. */
  marks: Readonly<Record<string, SkillMark>>;
}

/** How many people in the organization chose each way. Never who. */
export interface SkillChoiceCount {
  /** People who switched it off. */
  off: number;
  /** People who switched it on. */
  on: number;
  /** People with a personal skill at the same path. */
  ownVersions: number;
}

export interface SkillChoiceCounts {
  members: number;
  /** By `skillChoiceKey`; organization and Dispatch skills only. */
  counts: Record<string, SkillChoiceCount>;
}

export const NO_SKILL_CHOICES: SkillChoices = { switches: {}, marks: {} };

export function skillChoiceKey(source: SkillSource, path: string): string {
  return `${source}:${path}`;
}

export function isSkillMark(value: unknown): value is SkillMark {
  return (SKILL_MARKS as readonly unknown[]).includes(value);
}

/** A personal skill has no mark: only its owner decides. */
export function skillMarkFor(
  choices: SkillChoices,
  source: SkillSource,
  path: string,
): SkillMark {
  if (source === "personal") return "recommended";
  return choices.marks[skillChoiceKey(source, path)] ?? "recommended";
}

export function isSkillOn(
  choices: SkillChoices,
  source: SkillSource,
  path: string,
): boolean {
  const mark = skillMarkFor(choices, source, path);
  if (mark === "required") return true;
  const choice = choices.switches[skillChoiceKey(source, path)];
  return mark === "optional" ? choice?.on === true : choice?.on !== false;
}
