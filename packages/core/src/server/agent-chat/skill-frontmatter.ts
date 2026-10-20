import {
  getFrontmatterValue,
  parseFrontmatter,
} from "../../resources/metadata.js";
import {
  isWorkspaceResourceOwner,
  sharedResourceOwner,
  SHARED_OWNER,
  type ResourceMeta,
} from "../../resources/store.js";

export function sortResourceSkills<
  T extends Pick<ResourceMeta, "owner" | "path" | "updatedAt">,
>(resources: T[], options: { owner?: string; orgId?: string | null }): T[] {
  const organizationOwner = sharedResourceOwner(options.orgId);
  const ownerOrder = (owner: string) =>
    owner === options.owner
      ? 0
      : owner === organizationOwner
        ? 1
        : owner === SHARED_OWNER
          ? 2
          : isWorkspaceResourceOwner(owner)
            ? 3
            : 4;

  return [...resources].sort((a, b) => {
    const scopeOrder = ownerOrder(a.owner) - ownerOrder(b.owner);
    if (scopeOrder !== 0) return scopeOrder;
    const updatedOrder = b.updatedAt - a.updatedAt;
    if (updatedOrder !== 0) return updatedOrder;
    return a.path.localeCompare(b.path);
  });
}

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
  requiresLab?: string;
} {
  const frontmatter = parseFrontmatter(content);
  const userInvocable = getFrontmatterValue(frontmatter, "user-invocable");
  const rawScope = getFrontmatterValue(frontmatter, "scope");
  const name = getFrontmatterValue(frontmatter, "name");
  const requiresLab = getFrontmatterValue(frontmatter, "requires-lab")?.trim();
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
    requiresLab: requiresLab || undefined,
  };
}
