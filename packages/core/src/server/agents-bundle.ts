import {
  DEFAULT_SKILL_SCOPE,
  isRuntimeVisibleScope,
  normalizeSkillScope,
  type SkillScope,
} from "./agent-chat/skill-frontmatter.js";

export {
  DEFAULT_SKILL_SCOPE,
  isRuntimeVisibleScope,
  normalizeSkillScope,
  type SkillScope,
};

export interface SkillMeta {
  name: string;
  description: string;
  scope: SkillScope;
}

export interface Skill {
  meta: SkillMeta;
  content: string;
  dir: string;
  extraFiles: string[];
  files: Record<string, string>;
}

export interface AgentsBundle {
  agentsMd: string;
  runtimeAgentsMd: string;
  developmentAgentsMd: string;
  workspaceAgentsMd?: string;
  skills: Record<string, Skill>;
}

export interface AgentsBundleReadOptions {
  instructions?: AgentNativeInstructionsConfig;
  additionalSkillDirs?: string[];
}

export interface AgentInstructionPaths {
  runtime: string;
  development: string;
}

const DEFAULT_AGENT_INSTRUCTIONS_PATH = "AGENTS.md";

export function resolveAgentInstructionPaths(
  instructions?: AgentNativeInstructionsConfig,
): AgentInstructionPaths {
  return {
    runtime: instructions?.runtime ?? DEFAULT_AGENT_INSTRUCTIONS_PATH,
    development: instructions?.development ?? DEFAULT_AGENT_INSTRUCTIONS_PATH,
  };
}

let cached: AgentsBundle | null = null;

export function parseSkillFrontmatter(
  content: string,
  sourceLabel?: string,
): Partial<SkillMeta> {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: Partial<SkillMeta> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!keyMatch) continue;
    const [, key, valueRaw] = keyMatch;
    const trimmed = valueRaw.trim();

    const isFolded = trimmed === ">" || trimmed === ">-";
    const isLiteral = trimmed === "|" || trimmed === "|-";

    let value: string;
    if (isFolded || isLiteral) {
      const block: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next.length === 0) {
          block.push("");
          j++;
          continue;
        }
        if (!/^\s/.test(next)) break;
        block.push(next.replace(/^\s+/, ""));
        j++;
      }
      while (block.length > 0 && block[block.length - 1] === "") block.pop();
      value = isFolded
        ? block.filter((l) => l !== "").join(" ")
        : block.join("\n");
      i = j - 1;
    } else {
      value = trimmed;
    }

    if (key === "name" && value) result.name = value;
    else if (key === "description" && value) result.description = value;
    else if (key === "scope" && value)
      result.scope = normalizeSkillScope(value, sourceLabel ?? result.name);
  }

  return result;
}

import fs from "node:fs";
import path from "node:path";

import type { AgentNativeInstructionsConfig } from "../config.js";

const TEMPLATE_SKILLS_DIRS = [
  path.join(".agents", "skills"),
  path.join(".agent", "skills"),
] as const;

const READABLE_SUBFILE_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const MAX_SUBFILE_BYTES = 64 * 1024;
const MAX_SKILL_FILES_BYTES = 256 * 1024;

export interface WorkspaceAgentsSource {
  skillsDir: string | null;
  agentsMdPath: string | null;
  rootDir: string;
}

function readInstructionFile(cwd: string, relativePath: string): string {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const root = fs.realpathSync(path.resolve(cwd));
  const absolutePath = path.resolve(root, normalizedPath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Agent instruction path must stay inside the app root: ${relativePath}`,
    );
  }

  if (!fs.existsSync(absolutePath)) return "";
  const realPath = fs.realpathSync(absolutePath);
  if (realPath !== root && !realPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Agent instruction path must stay inside the app root: ${relativePath}`,
    );
  }
  if (!fs.statSync(realPath).isFile()) return "";
  return fs.readFileSync(realPath, "utf-8");
}

function readSkillsDir(
  skillsDir: string,
  rootForRelative: string,
  out: Record<string, Skill>,
  skipExistingNames: boolean,
): void {
  if (!fs.existsSync(skillsDir)) return;
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillDirAbs = path.join(skillsDir, entry.name);
    const skillFile = path.join(skillDirAbs, "SKILL.md");
    try {
      const realSkillFile = fs.realpathSync(skillFile);
      if (!fs.existsSync(realSkillFile)) continue;
      const content = fs.readFileSync(realSkillFile, "utf-8");
      const meta = parseSkillFrontmatter(
        content,
        path.relative(rootForRelative, skillFile).replace(/\\/g, "/"),
      );
      const name = meta.name ?? entry.name;
      if (skipExistingNames && out[name]) continue;

      const extraFiles: string[] = [];
      const files: Record<string, string> = {};
      let skillFilesBytes = 0;
      try {
        const walk = (subdir: string, prefix: string) => {
          for (const e of fs.readdirSync(subdir, { withFileTypes: true })) {
            const abs = path.join(subdir, e.name);
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory() || e.isSymbolicLink()) {
              try {
                const stat = fs.statSync(abs);
                if (stat.isDirectory()) walk(abs, rel);
              } catch {}
            } else if (e.isFile() && e.name !== "SKILL.md") {
              extraFiles.push(rel);
              const ext = path.extname(e.name).toLowerCase();
              if (!READABLE_SUBFILE_EXTENSIONS.has(ext)) continue;
              try {
                const stat = fs.statSync(abs);
                if (stat.size > MAX_SUBFILE_BYTES) continue;
                if (skillFilesBytes + stat.size > MAX_SKILL_FILES_BYTES) {
                  continue;
                }
                files[rel] = fs.readFileSync(abs, "utf-8");
                skillFilesBytes += stat.size;
              } catch {}
            }
          }
        };
        walk(skillDirAbs, "");
      } catch {}
      extraFiles.sort();

      out[name] = {
        meta: {
          name,
          description: meta.description ?? "",
          scope: meta.scope ?? DEFAULT_SKILL_SCOPE,
        },
        content,
        dir: path.relative(rootForRelative, skillDirAbs).replace(/\\/g, "/"),
        extraFiles,
        files,
      };
    } catch {
      // Skip unreadable skills
    }
  }
}

function readNestedSkillsDir(
  skillsDir: string,
  rootForRelative: string,
  out: Record<string, Skill>,
): void {
  if (!fs.existsSync(skillsDir)) return;
  readSkillsDir(skillsDir, rootForRelative, out, true);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "." || entry.name === "..") {
      continue;
    }
    const nestedDir = path.join(skillsDir, entry.name);
    if (fs.existsSync(path.join(nestedDir, "SKILL.md"))) continue;
    readSkillsDir(nestedDir, rootForRelative, out, true);
  }
}

export function readAgentsBundleFromFs(
  cwd: string,
  workspaceSource: WorkspaceAgentsSource | null = null,
  options: AgentsBundleReadOptions = {},
): AgentsBundle {
  const instructionPaths = resolveAgentInstructionPaths(options.instructions);
  const runtimeAgentsMd = readInstructionFile(cwd, instructionPaths.runtime);
  const developmentAgentsMd = readInstructionFile(
    cwd,
    instructionPaths.development,
  );

  let workspaceAgentsMd = "";
  if (workspaceSource?.agentsMdPath) {
    try {
      if (fs.existsSync(workspaceSource.agentsMdPath)) {
        workspaceAgentsMd = fs.readFileSync(
          workspaceSource.agentsMdPath,
          "utf-8",
        );
      }
    } catch {}
  }

  const skills: Record<string, Skill> = {};
  for (const relSkillsDir of TEMPLATE_SKILLS_DIRS) {
    try {
      readNestedSkillsDir(path.join(cwd, relSkillsDir), cwd, skills);
    } catch {}
  }

  if (workspaceSource?.skillsDir) {
    try {
      readSkillsDir(
        workspaceSource.skillsDir,
        workspaceSource.rootDir,
        skills,
        true,
      );
    } catch {}
  }

  for (const skillsDir of options.additionalSkillDirs ?? []) {
    try {
      readNestedSkillsDir(skillsDir, cwd, skills);
    } catch (error) {
      console.warn(
        "[agents-bundle] Failed to load optional host-provided skills",
        { skillsDir, error },
      );
    }
  }

  return {
    agentsMd: runtimeAgentsMd,
    runtimeAgentsMd,
    developmentAgentsMd,
    workspaceAgentsMd,
    skills,
  };
}

export async function loadAgentsBundle(): Promise<AgentsBundle> {
  if (cached) return cached;

  try {
    // @ts-expect-error — virtual module is resolved at build time by our
    // Vite plugin; nothing exists at this path on disk.
    const mod = await import("virtual:agents-bundle");
    if (mod && mod.default) {
      cached = mod.default as AgentsBundle;
      return cached;
    }
  } catch {
    // Virtual module not available — fall through to filesystem.
  }

  let workspaceSource: WorkspaceAgentsSource | null = null;
  try {
    const { getWorkspaceCoreExports } =
      await import("../deploy/workspace-core.js");
    const ws = await getWorkspaceCoreExports(process.cwd());
    if (ws) {
      workspaceSource = {
        skillsDir: ws.skillsDir,
        agentsMdPath: ws.agentsMdPath,
        rootDir: ws.packageDir,
      };
    }
    // coercion-ok: workspace-core discovery is optional in edge runtimes.
  } catch {
    // workspace-core discovery isn't available (e.g. edge runtime).
  }
  const { createAgentNativeConfigContext, loadResolvedAgentNativeConfig } =
    await import("../vite/agent-native-config-loader.js");
  const production = process.env.NODE_ENV === "production";
  const config = await loadResolvedAgentNativeConfig(
    process.cwd(),
    createAgentNativeConfigContext(
      production ? "build" : "serve",
      production ? "production" : "development",
    ),
  );
  cached = readAgentsBundleFromFs(process.cwd(), workspaceSource, {
    instructions: config.instructions,
  });
  return cached;
}

export function getRuntimeSkills(bundle: AgentsBundle): Skill[] {
  return Object.values(bundle.skills).filter((skill) =>
    isRuntimeVisibleScope(skill.meta.scope),
  );
}

export function getDevelopmentSkills(bundle: AgentsBundle): Skill[] {
  return Object.values(bundle.skills).filter(
    (skill) => skill.meta.scope !== "runtime",
  );
}

export function skillDocsSlug(name: string): string {
  return `skill-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function subfileSlugSuffix(relPath: string): string {
  return relPath
    .replace(/\.[^./]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function skillSubfileDocsSlug(
  skillName: string,
  relPath: string,
): string {
  return `${skillDocsSlug(skillName)}--${subfileSlugSuffix(relPath)}`;
}

function generateSkillsPromptBlockForEntries(
  entries: Skill[],
  mode: "runtime" | "development",
): string {
  if (entries.length === 0) return "";

  const lines = entries.map((s) => {
    let extras = "";
    if (s.extraFiles.length > 0) {
      if (mode === "runtime") {
        const readable = s.extraFiles.filter((f) => f in s.files);
        const unreadable = s.extraFiles.filter((f) => !(f in s.files));
        const parts: string[] = [];
        if (readable.length > 0) {
          const refIds = readable.map((f) => subfileSlugSuffix(f)).join(", ");
          parts.push(
            `refs via docs-search --slug "${skillDocsSlug(s.meta.name)}--<ref>": ${refIds}`,
          );
        }
        if (unreadable.length > 0) {
          parts.push(`also contains: ${unreadable.join(", ")}`);
        }
        extras = ` (${parts.join("; ")})`;
      } else {
        extras = ` (also contains: ${s.extraFiles.join(", ")})`;
      }
    }
    const runtimeHint =
      mode === "runtime" ? ` [${skillDocsSlug(s.meta.name)}]` : "";
    return `- \`${s.meta.name}\` at \`${s.dir}/\` — ${s.meta.description || "(no description)"}${extras}${runtimeHint}`;
  });

  const readHint =
    mode === "runtime"
      ? `To read a skill in the in-app runtime agent, before starting a task it applies to:
  \`docs-search --slug "<slug>"\` — each skill's slug is the [bracketed] token ending its line
  \`docs-search --query "<topic>"\` to discover matching docs/skills
Read each relevant page once per turn and reuse it for subsequent steps. Do not repeat an equivalent lookup unless you need a different page or question.`
      : `To read a skill in dev mode (when you have bash access):
  \`bash(command="cat <skill-dir>/SKILL.md")\`
  \`bash(command="ls <skill-dir>/")\` to see all files in the folder`;

  return `<skills>
The following skills live in the repo, usually at \`.agents/skills/<name>/\` (legacy \`.agent/skills/<name>/\` is also supported). Each skill is a folder containing a \`SKILL.md\` entry file and sometimes supporting files. Read a skill BEFORE starting a task it applies to.

${readHint}

Available skills:
${lines.join("\n")}
</skills>`;
}

export function generateSkillsPromptBlock(bundle: AgentsBundle): string {
  return generateSkillsPromptBlockForEntries(
    getRuntimeSkills(bundle),
    "runtime",
  );
}

export function generateDevelopmentSkillsPromptBlock(
  bundle: AgentsBundle,
): string {
  return generateSkillsPromptBlockForEntries(
    getDevelopmentSkills(bundle),
    "development",
  );
}

export function __resetAgentsBundleCache(): void {
  cached = null;
}
