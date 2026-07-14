import {
  getFrontmatterValue,
  parseFrontmatter,
} from "../../resources/metadata.js";

export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  userInvocable?: boolean;
  scope?: "runtime" | "dev" | "both";
} {
  const frontmatter = parseFrontmatter(content);
  const userInvocable = getFrontmatterValue(frontmatter, "user-invocable");
  const scope = normalizeSkillFrontmatterScope(
    getFrontmatterValue(frontmatter, "scope"),
  );
  return {
    name: getFrontmatterValue(frontmatter, "name"),
    description: getFrontmatterValue(frontmatter, "description"),
    scope,
    userInvocable:
      userInvocable === undefined
        ? undefined
        : userInvocable.toLowerCase() === "true",
  };
}

function normalizeSkillFrontmatterScope(
  value: string | undefined,
): "runtime" | "dev" | "both" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "runtime" ||
    normalized === "dev" ||
    normalized === "both"
  ) {
    return normalized;
  }
  return "both";
}
