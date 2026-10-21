import type { AgentProfileMetadata } from "../shared/agent-profile.js";
import type { AgentSkill } from "./types.js";

const PROFILE_EXAMPLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with",
]);

const PROFILE_WORD_ALIASES: Record<string, string> = {
  build: "generate",
  create: "generate",
  link: "url",
  make: "generate",
};

const manifestExamples = new WeakMap<AgentSkill, string[] | undefined>();

function profileWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !PROFILE_EXAMPLE_STOP_WORDS.has(word))
      .map((word) => PROFILE_WORD_ALIASES[word] ?? word),
  );
}

/** Add app examples only to the one skill whose own wording clearly matches. */
export function addAgentProfileExamples<T extends AgentSkill>(
  skills: T[],
  profile: AgentProfileMetadata | null,
): T[] {
  if (!skills.length) return skills;
  const manifestSkills = skills.map((skill) => {
    const examples = manifestExamples.get(skill);
    if (examples === undefined && !manifestExamples.has(skill)) return skill;
    const { examples: _derivedExamples, ...rest } = skill;
    return {
      ...rest,
      ...(examples ? { examples } : {}),
    } as T;
  });
  if (!profile?.whenToUse?.length) return manifestSkills;

  const examplesBySkill = new Map<string, string[]>();
  for (const example of profile.whenToUse) {
    const words = profileWords(example);
    let bestSkill: T | undefined;
    let bestScore = 0;
    let runnerUpScore = 0;
    let tied = false;

    for (const skill of manifestSkills) {
      const skillWords = profileWords(
        `${skill.id} ${skill.name} ${skill.description}`,
      );
      let score = 0;
      for (const word of words) if (skillWords.has(word)) score += 1;
      if (score > bestScore) {
        runnerUpScore = bestScore;
        bestSkill = skill;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && score > 1) {
        tied = true;
      } else if (score > runnerUpScore) {
        runnerUpScore = score;
      }
    }

    if (!bestSkill || tied || bestScore - runnerUpScore < 2) continue;
    const examples = examplesBySkill.get(bestSkill.id) ?? [];
    examples.push(example);
    examplesBySkill.set(bestSkill.id, examples);
  }

  return manifestSkills.map((skill) => {
    const examples = examplesBySkill.get(skill.id);
    if (!examples?.length) return skill;
    const updated = {
      ...skill,
      examples: [
        ...(skill.examples ?? []),
        ...examples.filter((example) => !skill.examples?.includes(example)),
      ],
    } as T;
    manifestExamples.set(updated, skill.examples);
    return updated;
  });
}
