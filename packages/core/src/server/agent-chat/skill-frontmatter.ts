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

/**
 * An unrecognized `scope:` can neither throw nor fall back to `both`.
 * Throwing would be swallowed: every caller parses inside a `catch` that skips
 * the skill (`readSkillsDir`) or falls back to a permissive default, so at
 * production cold start the skill would vanish with no log — the same
 * invisible failure pointed the other way. Falling back to `both` ships a
 * dev-only skill's body to the deployed agent, which is the bug this sentinel
 * exists to prevent. So `invalid` stays distinguishable from an absent scope,
 * is loud once per file+value, and is excluded from the runtime agent's view
 * while the development agent still sees the skill and the mistake.
 */
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

/**
 * The one runtime-visibility gate. A skill whose scope could not be read is
 * withheld alongside `dev`, so a typo fails closed instead of leaking the body
 * into the deployed agent's prompt and docs-search.
 */
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
