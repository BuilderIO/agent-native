#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
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
const templatesDir = join(rootDir, "templates");
const defaultTemplateSkillsDir = join(
  rootDir,
  "packages",
  "core",
  "src",
  "templates",
  "default",
  ".agents",
  "skills",
);

const workspaceSkillIncludes = [
  "a2a-protocol",
  "actions",
  "agent-native-docs",
  "adding-a-feature",
  "address-feedback",
  "audit-log",
  "authentication",
  "automations",
  "capture-learnings",
  "changelog",
  "client-methods",
  "client-side-routing",
  "composable-mini-apps",
  "context-awareness",
  "context-xray",
  "create-skill",
  "delegate-to-agent",
  "extension-points",
  "extensions",
  "external-agents",
  "frontend-design",
  "generative-ui",
  "harness-agents",
  "internationalization",
  "integration-webhooks",
  "mvp-followup",
  "observability",
  "onboarding",
  "performance",
  "portability",
  "qa",
  "real-time-collab",
  "real-time-sync",
  "recurring-jobs",
  "reliable-mutations",
  "secrets",
  "security",
  "self-modifying-code",
  "server-plugins",
  "shadcn-ui",
  "sharing",
  "storing-data",
  "tracking",
  "visual-answer",
  "voice-transcription",
  "writing-agent-instructions",
];

// These are shared framework/best-practice skills that generated/default apps
// and first-party templates often copy locally. Keep them byte-for-byte
// canonical so generated apps, workspaces, and this repo do not learn different
// architectural rules.
const templateSharedSkillIncludes = [
  "actions",
  "agent-native-docs",
  "adding-a-feature",
  "capture-learnings",
  "client-methods",
  "create-skill",
  "delegate-to-agent",
  "frontend-design",
  "internationalization",
  "performance",
  "real-time-collab",
  "real-time-sync",
  "security",
  "self-modifying-code",
  "shadcn-ui",
  "storing-data",
];

const requiredTemplateSharedSkills: Record<string, string[]> = {
  chat: ["agent-native-docs"],
};

const requiredDefaultTemplateSharedSkills = ["internationalization"];

const actionFirstInstructionFiles = [
  join(
    rootDir,
    "packages",
    "core",
    "src",
    "templates",
    "default",
    "DEVELOPING.md",
  ),
  join(rootDir, "registry", "agent-native-app", "AGENTS.md"),
];

const staleInstructionPatterns = [
  {
    pattern: /React Query hooks fetch from `\/api\/\*`/,
    message:
      "teach action hooks (`useActionQuery` / `useActionMutation`) as the default data path instead of `/api/*` fetches",
  },
  {
    pattern: /^#{2,3} Adding an API Route$/m,
    message:
      "teach `Adding App Data` plus route-only endpoint exceptions instead of route-first CRUD",
  },
  {
    pattern:
      /Create `actions\/my-script\.ts` exporting `default async function\(args: string\[\]\)`/,
    message: "teach `defineAction` instead of the legacy bare script export",
  },
  {
    pattern: /^#{2,3} Adding New Scripts$/m,
    message: "teach `Adding an Action` with `defineAction`",
  },
];

const requiredActionGuidance = [
  {
    rel: "packages/core/src/templates/default/AGENTS.md",
    pattern:
      /Do not create `\/api\/\*` routes that only call,\s+repackage, or proxy an action\./,
  },
  {
    rel: "packages/core/src/templates/workspace-root/AGENTS.md",
    pattern: /Normal app data must flow through actions\./,
  },
  {
    rel: "packages/core/src/templates/workspace-core/AGENTS.md",
    pattern: /Normal app data must flow through actions\./,
  },
  {
    rel: "registry/agent-native-app/AGENTS.md",
    pattern: /Normal app data must flow through actions\./,
  },
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
  const missingTemplateShared = templateSharedSkillIncludes.filter(
    (skill) => !sourceSkills.includes(skill),
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
  if (missingTemplateShared.length > 0) {
    errors.push(
      `Template-shared skills missing from ${sourceDir}: ${missingTemplateShared.join(
        ", ",
      )}`,
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

function checkSkillDirInSync(label, skill, targetSkillDir) {
  const sourceSkillDir = join(sourceDir, skill);
  const expected = listFiles(sourceSkillDir);
  const actual = listFiles(targetSkillDir);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((file) => !actualSet.has(file));
  const extra = actual.filter((file) => !expectedSet.has(file));
  const changed = expected.filter((file) => {
    if (!actualSet.has(file)) return false;
    return (
      readFileSync(join(sourceSkillDir, file), "utf-8") !==
      readFileSync(join(targetSkillDir, file), "utf-8")
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
    `${label}/${skill} is out of sync with .agents/skills/${skill}.\n\n${sections.join(
      "\n\n",
    )}\n\nRun: pnpm sync:workspace-skills`,
  );
}

function listTemplateDirs() {
  if (!existsSync(templatesDir)) return [];
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listInstructionFiles() {
  const files = [...actionFirstInstructionFiles];
  for (const template of listTemplateDirs()) {
    const file = join(templatesDir, template, "DEVELOPING.md");
    if (existsSync(file)) files.push(file);
  }
  return files.sort();
}

function checkActionFirstInstructionPhrases() {
  const findings = [];
  for (const file of listInstructionFiles()) {
    const content = readFileSync(file, "utf-8");
    for (const { pattern, message } of staleInstructionPatterns) {
      if (pattern.test(content)) {
        findings.push(`${relative(rootDir, file)}: ${message}`);
      }
    }
  }

  for (const { rel, pattern } of requiredActionGuidance) {
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(`${rel}: missing required generated-app guidance file`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    if (!pattern.test(content)) {
      findings.push(`${rel}: missing canonical action-first guidance`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Action-first generated guidance is out of sync.\n\n${findings.join(
        "\n",
      )}`,
    );
  }
}

function forEachExistingTemplateSharedSkill(fn) {
  for (const skill of templateSharedSkillIncludes) {
    const targetSkillDir = join(defaultTemplateSkillsDir, skill);
    if (
      existsSync(targetSkillDir) ||
      requiredDefaultTemplateSharedSkills.includes(skill)
    ) {
      fn(
        "packages/core/src/templates/default/.agents/skills",
        skill,
        targetSkillDir,
      );
    }
  }

  for (const template of listTemplateDirs()) {
    for (const skill of templateSharedSkillIncludes) {
      const targetSkillDir = join(
        templatesDir,
        template,
        ".agents",
        "skills",
        skill,
      );
      if (
        existsSync(targetSkillDir) ||
        (requiredTemplateSharedSkills[template] ?? []).includes(skill)
      ) {
        fn(`templates/${template}/.agents/skills`, skill, targetSkillDir);
      }
    }
  }
}

function checkTemplateSharedSkillsInSync() {
  forEachExistingTemplateSharedSkill((label, skill, targetSkillDir) => {
    checkSkillDirInSync(label, skill, targetSkillDir);
  });
}

function copySkill(skill, targetSkillDir) {
  if (
    existsSync(targetSkillDir) &&
    lstatSync(targetSkillDir).isSymbolicLink()
  ) {
    return;
  }
  rmSync(targetSkillDir, { recursive: true, force: true });
  mkdirSync(dirname(targetSkillDir), { recursive: true });
  cpSync(join(sourceDir, skill), targetSkillDir, { recursive: true });
}

function syncWorkspaceCoreSkills() {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const skill of workspaceSkillIncludes) {
    copySkill(skill, join(targetDir, skill));
  }
}

function syncTemplateSharedSkills() {
  forEachExistingTemplateSharedSkill((_template, skill, targetSkillDir) => {
    copySkill(skill, targetSkillDir);
  });
}

try {
  assertCategorized();
  if (check) {
    checkInSync();
    checkTemplateSharedSkillsInSync();
    checkActionFirstInstructionPhrases();
    console.log(
      "Workspace-core, default-template, and template shared skills are in sync.",
    );
  } else {
    syncWorkspaceCoreSkills();
    syncTemplateSharedSkills();
    checkInSync();
    checkTemplateSharedSkillsInSync();
    checkActionFirstInstructionPhrases();
    console.log(
      "Synced workspace-core, default-template, and template shared skills from .agents/skills.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
