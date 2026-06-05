#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");
const sourceDir = join(rootDir, ".agents", "skills");
const targetDir = join(
  rootDir,
  "packages",
  "core",
  "src",
  "templates",
  "workspace-core",
  ".agents",
  "skills",
);

const workspaceSkillIncludes = [
  "a2a-protocol",
  "actions",
  "adding-a-feature",
  "address-feedback",
  "authentication",
  "automations",
  "capture-learnings",
  "client-methods",
  "client-side-routing",
  "context-awareness",
  "context-xray",
  "create-skill",
  "delegate-to-agent",
  "extension-points",
  "extensions",
  "external-agents",
  "frontend-design",
  "integration-webhooks",
  "mvp-followup",
  "observability",
  "onboarding",
  "portability",
  "qa",
  "real-time-collab",
  "real-time-sync",
  "recurring-jobs",
  "secrets",
  "security",
  "self-modifying-code",
  "server-plugins",
  "shadcn-ui",
  "sharing",
  "storing-data",
  "tracking",
  "voice-transcription",
  "writing-agent-instructions",
];

// Repo-maintenance workflows are useful in this repository, but generated
// workspaces should not inherit branch/PR shipping behavior from our monorepo.
const workspaceSkillExcludes = [
  "babysit-pr",
  "new-branch",
  "ship",
  "ship-desktop",
];

const check = process.argv.includes("--check");
const includeSet = new Set(workspaceSkillIncludes);
const excludeSet = new Set(workspaceSkillExcludes);

function listSkillDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(abs, base));
    } else if (entry.isFile()) {
      files.push(relative(base, abs));
    }
  }
  return files.sort();
}

function relSkillFiles(skillName) {
  return listFiles(join(sourceDir, skillName)).map((file) =>
    join(skillName, file),
  );
}

function assertCategorized() {
  const sourceSkills = listSkillDirs(sourceDir);
  const unknown = sourceSkills.filter(
    (skill) => !includeSet.has(skill) && !excludeSet.has(skill),
  );
  const missing = workspaceSkillIncludes.filter(
    (skill) => !sourceSkills.includes(skill),
  );
  const overlap = workspaceSkillIncludes.filter((skill) =>
    excludeSet.has(skill),
  );

  const errors = [];
  if (unknown.length > 0) {
    errors.push(
      `Uncategorized root skills: ${unknown.join(", ")}. Add each one to workspaceSkillIncludes or workspaceSkillExcludes.`,
    );
  }
  if (missing.length > 0) {
    errors.push(
      `Included skills missing from ${sourceDir}: ${missing.join(", ")}`,
    );
  }
  if (overlap.length > 0) {
    errors.push(
      `Skills listed as both included and excluded: ${overlap.join(", ")}`,
    );
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function expectedFiles() {
  return workspaceSkillIncludes.flatMap((skill) => relSkillFiles(skill)).sort();
}

function checkInSync() {
  const expected = expectedFiles();
  const actual = listFiles(targetDir);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((file) => !actualSet.has(file));
  const extra = actual.filter((file) => !expectedSet.has(file));
  const changed = expected.filter((file) => {
    if (!actualSet.has(file)) return false;
    return (
      readFileSync(join(sourceDir, file), "utf-8") !==
      readFileSync(join(targetDir, file), "utf-8")
    );
  });

  if (missing.length === 0 && extra.length === 0 && changed.length === 0) {
    return;
  }

  const sections = [];
  if (missing.length > 0) sections.push(`Missing:\n${missing.join("\n")}`);
  if (extra.length > 0) sections.push(`Extra:\n${extra.join("\n")}`);
  if (changed.length > 0) sections.push(`Changed:\n${changed.join("\n")}`);
  throw new Error(
    `Workspace-core skills are out of sync with .agents/skills.\n\n${sections.join(
      "\n\n",
    )}\n\nRun: pnpm sync:workspace-skills`,
  );
}

function sync() {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const skill of workspaceSkillIncludes) {
    cpSync(join(sourceDir, skill), join(targetDir, skill), { recursive: true });
  }
}

try {
  assertCategorized();
  if (check) {
    checkInSync();
    console.log("Workspace-core skills are in sync.");
  } else {
    sync();
    checkInSync();
    console.log("Synced workspace-core skills from .agents/skills.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
