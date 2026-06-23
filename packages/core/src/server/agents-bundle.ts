/**
 * Agents bundle — loads AGENTS.md and .agents/skills/ from the template.
 * The legacy singular .agent/skills/ directory is also accepted as an alias.
 *
 * This is the single source of truth the framework's agent uses to mirror what
 * Claude Code / Codex / any other agent would see when running locally in the
 * repo. The filesystem is the canonical source; this module is just a loader
 * that works both in dev (direct fs read) and production (content bundled at
 * build time via the `virtual:agents-bundle` Vite plugin).
 *
 * Resolution order inside `loadAgentsBundle()`:
 *   1. Virtual module (`virtual:agents-bundle`) — inlined at build time by the
 *      framework's Vite plugin. This is the ONLY path that works on edge
 *      runtimes (Cloudflare Workers) where `readFileSync` doesn't exist.
 *   2. Filesystem fallback — `process.cwd()/AGENTS.md` +
 *      `process.cwd()/.agents/skills/` (or legacy `.agent/skills/`). Only reliable in local dev and Node
 *      production (`agent-native start`); not on Netlify/Vercel/CF at runtime.
 *   3. Empty bundle — everything silently returns empty strings.
 *
 * Result is cached in module scope so it's only computed once per cold start.
 */

/**
 * Where a skill is meant to be used:
 *   - `runtime` — only the in-app agent at runtime (not the human's coding agent).
 *   - `dev`     — only the human's development/coding agent (e.g. Claude Code).
 *                 EXCLUDED from the runtime agent's prompt block and docs-search.
 *   - `both`    — loaded everywhere. This is the default when `scope` is absent
 *                 or set to an unrecognized value (fully backward compatible).
 */
export type SkillScope = "runtime" | "dev" | "both";

export const DEFAULT_SKILL_SCOPE: SkillScope = "both";

export interface SkillMeta {
  name: string;
  description: string;
  /**
   * Audience for the skill. Defaults to `both` when the SKILL.md frontmatter
   * omits `scope` or specifies an unknown value. `dev`-scoped skills are hidden
   * from the runtime agent everywhere (prompt block + docs-search).
   */
  scope: SkillScope;
}

export interface Skill {
  meta: SkillMeta;
  /** Contents of SKILL.md (the entry file of the skill). */
  content: string;
  /**
   * Filesystem path to the skill directory, relative to the template root
   * (e.g. `.agents/skills/create-deck`). The agent can read any file here via
   * bash in dev — skills are folders, not single files, and may contain
   * supporting assets, scripts, or additional markdown.
   */
  dir: string;
  /**
   * Files inside the skill directory (relative to the skill dir), excluding
   * `SKILL.md`. Lets the agent know what else is available without a separate
   * `ls` call. Empty array if the skill is single-file.
   */
  extraFiles: string[];
}

export interface AgentsBundle {
  /** Contents of the template's AGENTS.md (empty string if missing). */
  agentsMd: string;
  /**
   * Contents of the workspace core's AGENTS.md, if the app is inside an
   * enterprise monorepo with a `workspaceCore` configured. Empty string
   * otherwise. Sits between the framework system prompt and the template's
   * AGENTS.md in the instruction stack.
   */
  workspaceAgentsMd?: string;
  /**
   * Map from skill name → skill content. Contains skills merged from the
   * workspace core layer (if present) and the template layer. On name
   * collision, the template's version wins so apps can override a shared
   * enterprise skill by dropping a same-named file under
   * `.agents/skills/<name>/`.
   */
  skills: Record<string, Skill>;
}

const EMPTY: AgentsBundle = { agentsMd: "", workspaceAgentsMd: "", skills: {} };

let cached: AgentsBundle | null = null;

/**
 * Coerce a raw frontmatter `scope` value into a known `SkillScope`. Unknown,
 * empty, or malformed values fall back to the default (`both`) so a typo never
 * silently hides a skill from the runtime agent. Optionally warns once per
 * distinct bad value to aid debugging without spamming logs.
 */
const warnedBadScopes = new Set<string>();
export function normalizeSkillScope(raw: string | undefined): SkillScope {
  if (!raw) return DEFAULT_SKILL_SCOPE;
  const value = raw.trim().toLowerCase();
  if (value === "runtime" || value === "dev" || value === "both") {
    return value;
  }
  if (value && !warnedBadScopes.has(value)) {
    warnedBadScopes.add(value);
    console.warn(
      `[agents-bundle] Unknown skill scope "${raw}" — treating as "${DEFAULT_SKILL_SCOPE}". Valid values: runtime, dev, both.`,
    );
  }
  return DEFAULT_SKILL_SCOPE;
}

/**
 * Parse the YAML frontmatter at the top of a skill file.
 * Only pulls out `name`, `description`, and `scope` — deliberately simple, no
 * YAML lib.
 * Handles:
 *   - Inline: `description: Some text`
 *   - Folded scalar: `description: >-\n  multi\n  line` → "multi line"
 *   - Literal scalar: `description: |\n  multi\n  line` → "multi\nline"
 */
export function parseSkillFrontmatter(content: string): Partial<SkillMeta> {
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
      // Collect subsequent indented lines (at least one leading space).
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
      // Trim trailing blank lines
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
      result.scope = normalizeSkillScope(value);
  }

  return result;
}

import fs from "node:fs";
import path from "node:path";

const TEMPLATE_SKILLS_DIRS = [
  path.join(".agents", "skills"),
  path.join(".agent", "skills"),
] as const;

/**
 * Paths to a workspace-core's agent resources, for merging into a template's
 * bundle. All fields optional — pass null for any missing piece.
 */
export interface WorkspaceAgentsSource {
  /** Absolute path to the workspace core's skills/ directory. */
  skillsDir: string | null;
  /** Absolute path to the workspace core's AGENTS.md. */
  agentsMdPath: string | null;
  /** Root dir (used to compute `dir` paths for workspace-core skills). */
  rootDir: string;
}

/**
 * Read one skills directory into a `Record<string, Skill>`. Extracted so
 * both the template and workspace-core paths can reuse it. `dirPrefix` is
 * the display path that will be reported to the agent (e.g.
 * `.agents/skills/<name>` for templates, or
 * `<workspace-shared-package>/.agents/skills/<name>` for the workspace layer).
 */
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
      const meta = parseSkillFrontmatter(content);
      const name = meta.name ?? entry.name;
      if (skipExistingNames && out[name]) continue; // Template wins

      const extraFiles: string[] = [];
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
      };
    } catch {
      // Skip unreadable skills
    }
  }
}

/**
 * Read AGENTS.md + all skills directly from the filesystem rooted at `cwd`.
 * Optionally also reads a workspace-core's AGENTS.md and skills directory
 * and merges them in (template wins on name collisions). Used by both the
 * Vite plugin (at build time) and the runtime fallback (in dev / Node prod).
 *
 * Synchronous — the Vite plugin's load hook calls it inline during the build.
 */
export function readAgentsBundleFromFs(
  cwd: string,
  workspaceSource: WorkspaceAgentsSource | null = null,
): AgentsBundle {
  let agentsMd = "";
  try {
    const agentsMdPath = path.join(cwd, "AGENTS.md");
    if (fs.existsSync(agentsMdPath)) {
      agentsMd = fs.readFileSync(agentsMdPath, "utf-8");
    }
  } catch {}

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

  // Merge skills: template first (so its entries are authoritative), then
  // workspace-core with skipExistingNames=true so same-named skills don't
  // overwrite the template's. `.agents/skills` is canonical; `.agent/skills`
  // is accepted as a legacy alias and does not override canonical skills.
  const skills: Record<string, Skill> = {};
  for (const [index, relSkillsDir] of TEMPLATE_SKILLS_DIRS.entries()) {
    try {
      readSkillsDir(path.join(cwd, relSkillsDir), cwd, skills, index > 0);
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

  return { agentsMd, workspaceAgentsMd, skills };
}

/**
 * Load the agents bundle. Returns a cached result on subsequent calls.
 * Tries the virtual module first (works everywhere, including edge), then
 * falls back to filesystem reads from `process.cwd()` — which, when a
 * workspace core is present, also merges in the workspace core's skills
 * and AGENTS.md.
 */
export async function loadAgentsBundle(): Promise<AgentsBundle> {
  if (cached) return cached;

  // 1. Try the Vite-emitted virtual module. This is the path that works on
  //    every deployment target because the content is inlined at build time.
  //    The Vite plugin itself is responsible for merging workspace-core
  //    content into the bundle it emits.
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

  // 2. Filesystem fallback — works in dev / Node prod. If a workspace core
  //    is present in the ancestor chain, merge its skills + AGENTS.md in.
  try {
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
    } catch {
      // workspace-core discovery isn't available (e.g. edge runtime).
    }
    cached = readAgentsBundleFromFs(process.cwd(), workspaceSource);
    return cached;
  } catch {
    cached = EMPTY;
    return cached;
  }
}

/**
 * Generate the `<skills>` block to inject into the system prompt.
 *
 * Skills are folders at `.agents/skills/<name>/` (or legacy
 * `.agent/skills/<name>/`) containing a `SKILL.md` entry file plus any number
 * of supporting files (additional markdown, examples, images, scripts). This
 * block lists what's available and how to read them.
 *
 * In dev mode the agent has bash access and reads skills via `cat` — exactly
 * like running `claude` locally in the repo. In production mode the agent has
 * no bash; templates that need skill content at runtime should inline the
 * critical parts directly in `AGENTS.md`.
 */
/**
 * Skills visible to the agent-native RUNTIME agent. Excludes `scope: dev`
 * skills (those are for the human's coding agent only). Skills with no scope,
 * `scope: runtime`, or `scope: both` are all included. Use this anywhere the
 * runtime agent's view of skills is built (prompt block + docs-search) so a
 * dev-scoped skill is invisible to the runtime agent everywhere.
 */
export function getRuntimeSkills(bundle: AgentsBundle): Skill[] {
  return Object.values(bundle.skills).filter(
    (skill) => skill.meta.scope !== "dev",
  );
}

/**
 * Skills visible to development/coding agents. Excludes `scope: runtime`
 * skills that are intended only for the deployed in-app agent.
 */
export function getDevelopmentSkills(bundle: AgentsBundle): Skill[] {
  return Object.values(bundle.skills).filter(
    (skill) => skill.meta.scope !== "runtime",
  );
}

function generateSkillsPromptBlockForEntries(entries: Skill[]): string {
  if (entries.length === 0) return "";

  const lines = entries.map((s) => {
    const extras =
      s.extraFiles.length > 0
        ? ` (also contains: ${s.extraFiles.join(", ")})`
        : "";
    return `- \`${s.meta.name}\` at \`${s.dir}/\` — ${s.meta.description || "(no description)"}${extras}`;
  });

  return `<skills>
The following skills live in the repo, usually at \`.agents/skills/<name>/\` (legacy \`.agent/skills/<name>/\` is also supported). Each skill is a folder containing a \`SKILL.md\` entry file and sometimes supporting files. Read a skill BEFORE starting a task it applies to.

To read a skill in dev mode (when you have bash access):
  \`bash(command="cat <skill-dir>/SKILL.md")\`
  \`bash(command="ls <skill-dir>/")\` to see all files in the folder

Available skills:
${lines.join("\n")}
</skills>`;
}

export function generateSkillsPromptBlock(bundle: AgentsBundle): string {
  return generateSkillsPromptBlockForEntries(getRuntimeSkills(bundle));
}

export function generateDevelopmentSkillsPromptBlock(
  bundle: AgentsBundle,
): string {
  return generateSkillsPromptBlockForEntries(getDevelopmentSkills(bundle));
}

/** For tests — reset the module cache. */
export function __resetAgentsBundleCache(): void {
  cached = null;
}
