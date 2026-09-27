import {
  getFrontmatterValue,
  parseFrontmatter,
} from "../../resources/metadata.js";

/**
 * Where a skill is meant to be used:
 *   - `runtime` — only the in-app agent at runtime.
 *   - `dev`     — only the human's development/coding agent (e.g. Claude Code).
 *                 Hidden from the runtime agent everywhere.
 *   - `both`    — loaded everywhere. The default when `scope` is absent.
 *   - `invalid` — never written by hand: the parse result for a `scope:` nobody
 *                 recognizes. See `normalizeSkillScope`.
 */
export type SkillScope = "runtime" | "dev" | "both" | "invalid";

export const DEFAULT_SKILL_SCOPE: SkillScope = "both";

const warnedBadScopes = new Set<string>();

export function normalizeSkillScope(
  raw: string | undefined,
  sourceLabel?: string,
): SkillScope {
  if (!raw?.trim()) return DEFAULT_SKILL_SCOPE;
  const value = raw.trim().toLowerCase();
  if (value === "runtime" || value === "dev" || value === "both") return value;
  const warnKey = `${sourceLabel ?? ""}\u0000${value}`;
  if (!warnedBadScopes.has(warnKey)) {
    warnedBadScopes.add(warnKey);
    console.error(
      `[skill-frontmatter] Invalid scope "${raw.trim()}" in ${
        sourceLabel ?? "an unidentified SKILL.md"
      } — valid values are runtime, dev, both. Hiding this skill from the runtime agent until it is fixed.`,
    );
  }
  return "invalid";
}

export function isRuntimeVisibleScope(scope: SkillScope | undefined): boolean {
  return scope !== "dev" && scope !== "invalid";
}

export function parseSkillFrontmatter(
  content: string,
  sourceLabel?: string,
): {
  name?: string;
  description?: string;
  userInvocable?: boolean;
  scope?: SkillScope;
} {
  const frontmatter = parseFrontmatter(content);
  const userInvocable = getFrontmatterValue(frontmatter, "user-invocable");
  const rawScope = getFrontmatterValue(frontmatter, "scope");
  const name = getFrontmatterValue(frontmatter, "name");
  return {
    name,
    description: getFrontmatterValue(frontmatter, "description"),
    scope: rawScope
      ? normalizeSkillScope(rawScope, sourceLabel ?? name)
      : undefined,
    userInvocable:
      userInvocable === undefined
        ? undefined
        : userInvocable.toLowerCase() === "true",
  };
}
