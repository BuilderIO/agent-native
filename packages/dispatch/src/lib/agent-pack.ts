import {
  parseFrontmatter,
  parseSkillMetadata,
} from "@agent-native/core/resources/metadata";

import {
  buildSimpleAgentContent,
  normalizeImportedAgent,
  slugifyAgentName,
  type ImportedAgentProfile,
} from "./simple-agent-profile.js";

export const AGENT_PACK_MAX_FILES = 80;
export const AGENT_PACK_MAX_FILE_BYTES = 200_000;
export const AGENT_PACK_MAX_TOTAL_BYTES = 2_000_000;

const IGNORED_PACK_FILES = new Set([
  ".ds_store",
  ".git",
  ".gitignore",
  ".env",
  ".env.local",
  "node_modules",
]);

export interface AgentPackFileInput {
  path: string;
  content: string;
}

export interface NormalizedAgentPackFile {
  path: string;
  content: string;
  name: string;
  description?: string;
  kind: "agent-file" | "skill";
}

export interface NormalizedAgentPack {
  profile: ImportedAgentProfile;
  profileFile: AgentPackFileInput;
  files: NormalizedAgentPackFile[];
  warnings: string[];
  totalBytes: number;
}

function normalizePackPath(value: string): string {
  const normalized = value
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/")
    .trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Invalid agent pack path: ${value}`);
  }
  if (normalized.length > 240) {
    throw new Error(`Agent pack path is too long: ${value}`);
  }
  return normalized;
}

function shouldIgnorePackPath(path: string): boolean {
  return path.split("/").some((part) => IGNORED_PACK_FILES.has(part.toLowerCase()));
}

function commonRoot(paths: string[]): string {
  const firstParts = paths.map((path) => path.split("/")[0]);
  if (firstParts.length < 2 || !firstParts.every((part) => part === firstParts[0])) {
    return "";
  }
  const root = firstParts[0];
  if (!root || ["skills", "context", "references", "files", "scripts"].includes(root)) {
    return "";
  }
  return root;
}

function stripCommonRoot(files: AgentPackFileInput[]): AgentPackFileInput[] {
  const root = commonRoot(files.map((file) => normalizePackPath(file.path)));
  if (!root) return files;
  return files.map((file) => ({
    ...file,
    path: normalizePackPath(file.path).slice(root.length + 1),
  }));
}

function profileScore(file: AgentPackFileInput): number {
  const name = file.path.split("/").pop()?.toLowerCase() || "";
  if (["agent.md", "agent.json", "profile.md"].includes(name)) return 100;
  if (["agents.md", "claude.md", "instructions.md"].includes(name)) return 90;
  if (name.endsWith(".md")) return 50;
  if (name.endsWith(".json")) return 40;
  return 0;
}

function fileDescription(file: AgentPackFileInput): string | undefined {
  const frontmatter = parseFrontmatter(file.content);
  const description = frontmatter?.fields.find(
    (field) => field.key === "description",
  )?.value;
  if (description?.trim()) return description.trim();
  const heading = file.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || undefined;
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function isSkillFile(path: string): boolean {
  return (
    path.startsWith("skills/") &&
    path.endsWith(".md") &&
    (path.endsWith("/SKILL.md") || !path.slice("skills/".length).includes("/"))
  );
}

export function normalizeAgentPack(
  inputFiles: AgentPackFileInput[],
): NormalizedAgentPack {
  if (inputFiles.length === 0) {
    throw new Error("Choose an agent file or folder with at least one file.");
  }
  if (inputFiles.length > AGENT_PACK_MAX_FILES) {
    throw new Error(`Agent packs can contain at most ${AGENT_PACK_MAX_FILES} files.`);
  }

  const files = stripCommonRoot(
    inputFiles.map((file) => {
      const path = normalizePackPath(file.path);
      if (shouldIgnorePackPath(path)) {
        throw new Error(`Remove ignored or private path from the pack: ${path}`);
      }
      if (typeof file.content !== "string") {
        throw new Error(`Agent pack file is not text: ${path}`);
      }
      const size = Buffer.byteLength(file.content, "utf8");
      if (size > AGENT_PACK_MAX_FILE_BYTES) {
        throw new Error(
          `${path} is too large. Keep text files under ${Math.round(AGENT_PACK_MAX_FILE_BYTES / 1024)} KB.`,
        );
      }
      return { path, content: file.content };
    }),
  );

  const totalBytes = files.reduce(
    (total, file) => total + Buffer.byteLength(file.content, "utf8"),
    0,
  );
  if (totalBytes > AGENT_PACK_MAX_TOTAL_BYTES) {
    throw new Error(
      `Agent packs can contain at most ${Math.round(AGENT_PACK_MAX_TOTAL_BYTES / 1_000_000)} MB of text.`,
    );
  }

  const profileFile = [...files]
    .filter((file) => profileScore(file) > 0)
    .sort((a, b) => profileScore(b) - profileScore(a) || a.path.localeCompare(b.path))[0];
  if (!profileFile) {
    throw new Error("An agent pack needs an agent.md, CLAUDE.md, or Markdown profile file.");
  }

  const profile = normalizeImportedAgent(profileFile.content, profileFile.path);
  const warnings: string[] = [...profile.warnings];
  const packFiles = files
    .filter((file) => file !== profileFile)
    .map((file): NormalizedAgentPackFile => {
      const skill = isSkillFile(file.path)
        ? parseSkillMetadata(file.content, file.path)
        : null;
      return {
        path: file.path,
        content: file.content,
        name: skill?.name || fileName(file.path),
        description: skill?.description || fileDescription(file),
        kind: skill ? "skill" : "agent-file",
      };
    });

  if (packFiles.length === 0) {
    warnings.push("This pack contains only the profile; add files under context/ or skills/ when needed.");
  }

  return { profile, profileFile, files: packFiles, warnings, totalBytes };
}

export function agentPackProfileContent(input: {
  profile: ImportedAgentProfile;
  tools?: string;
  sourceHash?: string;
  importedAt?: string;
}): string {
  return buildSimpleAgentContent({
    ...input.profile,
    tools: input.tools,
    source: input.profile.source,
    sourcePath: input.profile.sourcePath,
    sourceHash: input.sourceHash,
    importedAt: input.importedAt,
  });
}

export function agentPackRoot(agentNameOrSlug: string): string {
  return `agents/${slugifyAgentName(agentNameOrSlug)}`;
}

