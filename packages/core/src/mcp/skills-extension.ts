import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

import { AN_SKILL_MD } from "../cli/skills-content/an-skill.js";

/** MCP Skills extension (SEP-2640): skills are files served as `skill://` resources. */
export const MCP_SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";

interface ServedFile {
  uri: string;
  text: string;
  mimeType: string;
}

interface SkillEntry {
  uri: string;
  frontmatter: Record<string, unknown>;
  resources: { uri: string; digest: string; size: number }[];
}

function buildSkill(name: string, skillMd: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  const frontmatter = match ? parseYaml(match[1] ?? "") : null;
  if (
    !frontmatter ||
    typeof frontmatter !== "object" ||
    frontmatter.name !== name ||
    typeof frontmatter.description !== "string"
  ) {
    throw new Error(
      `Skill ${name} needs frontmatter with its name and description`,
    );
  }
  const files: ServedFile[] = [
    {
      uri: `skill://${name}/SKILL.md`,
      text: skillMd,
      mimeType: "text/markdown",
    },
  ];
  const entry: SkillEntry = {
    uri: files[0]!.uri,
    frontmatter,
    resources: files.map((file) => {
      const bytes = Buffer.from(file.text, "utf8");
      return {
        uri: file.uri,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length,
      };
    }),
  };
  return { entry, files };
}

let cached: ReturnType<typeof buildSkill> | undefined;
function anSkill() {
  return (cached ??= buildSkill("an", AN_SKILL_MD));
}

const FRESHNESS = {
  resultType: "complete",
  ttlMs: 0,
  cacheScope: "private",
} as const;

export function listMcpSkills() {
  return { ...FRESHNESS, skills: [anSkill().entry] };
}

/** The entry for a skill's `SKILL.md` uri, or null when this server does not serve it. */
export function getMcpSkill(uri: unknown) {
  const { entry } = anSkill();
  return uri === entry.uri ? { ...FRESHNESS, skill: entry } : null;
}

/** The contents of a served skill file, or null for any other uri. */
export function readMcpSkillFile(uri: unknown) {
  const file = anSkill().files.find((candidate) => candidate.uri === uri);
  return file
    ? {
        contents: [{ uri: file.uri, mimeType: file.mimeType, text: file.text }],
      }
    : null;
}
