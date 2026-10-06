#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  readlinkSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { missingInstructionSkillReferences } from "../packages/core/src/cli/template-skill-references.js";
import {
  CLIPS_TEMPLATE_SHARED_SKILLS,
  CHAT_STARTER_SKILLS,
  DEFAULT_TEMPLATE_LOCAL_SKILLS,
  DEFAULT_TEMPLATE_SHARED_SKILLS,
  DISPATCH_TEMPLATE_SHARED_SKILLS,
  DOMAIN_TEMPLATE_SHARED_SKILLS,
  FACTORY_TEMPLATE_SHARED_SKILLS,
  FRAMEWORK_TEMPLATE_SHARED_SKILLS,
  HEADLESS_TEMPLATE_SHARED_SKILLS,
  WORKSPACE_SKILLS,
} from "../packages/core/src/cli/workspace-skill-policy.js";
import { isRetiredCompatibilityTemplate } from "./template-standard/manifest.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");
const sourceDir = join(rootDir, ".agents", "skills");
const allowedSourceRoots = [
  realpathSync(sourceDir),
  realpathSync(join(rootDir, "skills")),
  realpathSync(join(rootDir, "templates", "content", ".agents", "skills")),
];
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
const headlessTemplateSkillsDir = join(
  rootDir,
  "packages",
  "core",
  "src",
  "templates",
  "headless",
  ".agents",
  "skills",
);
const chatStarterSkillsDir = join(
  rootDir,
  "packages",
  "core",
  "src",
  "templates",
  "chat",
  ".agents",
  "skills",
);
const factoryBundleSkillsDir = join(
  rootDir,
  "packages",
  "core",
  "src",
  "templates",
  "factory",
  ".agents",
  "skills",
);
const factoryBundleSkillIncludes = ["review-latest-feedback", "review-prs"];

const workspaceSkillIncludes = [...WORKSPACE_SKILLS];

const defaultTemplateSharedSkillIncludes = [...DEFAULT_TEMPLATE_SHARED_SKILLS];
const defaultTemplateSyncedSkillIncludes =
  defaultTemplateSharedSkillIncludes.filter(
    (skill) =>
      !DEFAULT_TEMPLATE_LOCAL_SKILLS.includes(
        skill as (typeof DEFAULT_TEMPLATE_LOCAL_SKILLS)[number],
      ),
  );

const headlessTemplateSharedSkillIncludes = [
  ...HEADLESS_TEMPLATE_SHARED_SKILLS,
];

const templateSharedSkillIncludesByTemplate: Record<string, string[]> = {
  chat: [...CHAT_STARTER_SKILLS],
  clips: [...CLIPS_TEMPLATE_SHARED_SKILLS],
  dispatch: [...DISPATCH_TEMPLATE_SHARED_SKILLS],
  factory: [...FACTORY_TEMPLATE_SHARED_SKILLS],
};

function templateSkillsFor(template: string): string[] {
  return (
    templateSharedSkillIncludesByTemplate[template] ?? [
      ...DOMAIN_TEMPLATE_SHARED_SKILLS,
    ]
  );
}

function includedSkillsForTemplate(template: string): string[] {
  if (template === "default") return defaultTemplateSharedSkillIncludes;
  if (template === "headless") return headlessTemplateSharedSkillIncludes;
  return templateSkillsFor(template);
}

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

const runtimeIntegrationGuidancePattern =
  /For external integrations, inspect the workspace\/provider connection catalog\s+first(?:\.|;)/;

const interactionResponsivenessInstructionPattern =
  /^- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work\.$/m;

const requiredRuntimeInstructionFiles = [
  "AGENTS.md",
  "packages/core/src/templates/default/AGENTS.md",
  "packages/core/src/templates/headless/AGENTS.md",
  "packages/core/src/templates/workspace-root/AGENTS.md",
  "packages/core/src/templates/workspace-core/AGENTS.md",
  "registry/agent-native-app/AGENTS.md",
];

const requiredGeneratedGuidance = [
  {
    rel: "packages/core/src/templates/default/AGENTS.md",
    pattern:
      /Do not\s+create `\/api\/\*` routes that only call,\s+repackage, or proxy an action\./,
    message: "canonical action-first guidance",
  },
  {
    rel: "packages/core/src/templates/default/AGENTS.md",
    pattern: runtimeIntegrationGuidancePattern,
    message: "runtime-visible integration preflight",
  },
  {
    rel: "packages/core/src/templates/headless/AGENTS.md",
    pattern: runtimeIntegrationGuidancePattern,
    message: "runtime-visible integration preflight",
  },
  {
    rel: "packages/core/src/templates/workspace-root/AGENTS.md",
    pattern: /Normal app data must flow through actions\./,
    message: "canonical action-first guidance",
  },
  {
    rel: "packages/core/src/templates/workspace-core/AGENTS.md",
    pattern: /Normal app data must flow through actions\./,
    message: "canonical action-first guidance",
  },
  {
    rel: "registry/agent-native-app/AGENTS.md",
    pattern: /Normal app data must flow through actions\./,
    message: "canonical action-first guidance",
  },
  {
    rel: "registry/agent-native-app/AGENTS.md",
    pattern: runtimeIntegrationGuidancePattern,
    message: "runtime-visible integration preflight",
  },
  {
    rel: "packages/core/src/templates/workspace-root/AGENTS.md",
    pattern:
      /Before implementing an app that connects to an external service, inspect the\s+workspace\/provider connection catalog first[.;]/,
    message: "shared-primitive integration preflight",
  },
  {
    rel: "packages/core/src/templates/workspace-core/AGENTS.md",
    pattern:
      /For external integrations, check the provider connection catalog first/,
    message: "shared-primitive integration preflight",
  },
];

const requiredAgentWorkflowGuidance = [
  "packages/core/src/templates/default/AGENTS.md",
  "packages/core/src/templates/workspace-root/AGENTS.md",
  "packages/core/src/templates/workspace-core/AGENTS.md",
  "registry/agent-native-app/AGENTS.md",
  "templates/chat/AGENTS.md",
].map((rel) => ({
  rel,
  pattern:
    /Keep actions deterministic\s+and\s+focused[\s\S]*AgentSidebar[\s\S]*same\s+thread/,
}));

const requiredToolkitDiscoveryGuidance = [
  "packages/core/src/templates/default/AGENTS.md",
  "packages/core/src/templates/headless/AGENTS.md",
  "packages/core/src/templates/workspace-core/AGENTS.md",
  "packages/core/src/templates/workspace-root/AGENTS.md",
  "registry/agent-native-app/AGENTS.md",
  "templates/chat/AGENTS.md",
];

const requiredRegistryConventionSkills = [
  "agent-native-toolkit",
  "customizing-agent-native",
];

const workspaceSkillExcludes = [
  "babysit-pr",
  "chat-first-workbench",
  "concurrent-agents",
  "delegating-work",
  "fix-at-the-boundary",
  "multi-frontier-desktop",
  "new-branch",
  "ship",
  "ship-and-monitor",
  "verifying-changes",
  "content-product-development",
  "design-exploration",
  "visual-edit",
  "visual-plan",
  "visual-recap",
  "visualize-repo",
  "writing-reference-docs",
];

const check = process.argv.includes("--check");
const excludeSet = new Set(workspaceSkillExcludes);

function isDirEntry(dir, entry) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(join(dir, entry.name)).isDirectory();
  } catch {
    // coercion-ok: broken symlink entries are intentionally excluded from generated skill copies.
    return false; // broken symlink
  }
}

function listSkillDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => isDirEntry(dir, entry))
    .map((entry) => entry.name)
    .sort();
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (isDirEntry(dir, entry)) {
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
  const missing = workspaceSkillIncludes.filter(
    (skill) => !sourceSkills.includes(skill),
  );
  const overlap = workspaceSkillIncludes.filter((skill) =>
    excludeSet.has(skill),
  );
  const missingTemplateShared = defaultTemplateSyncedSkillIncludes.filter(
    (skill) => !sourceSkills.includes(skill),
  );
  const missingDefaultLocal = DEFAULT_TEMPLATE_LOCAL_SKILLS.filter(
    (skill) => !listSkillDirs(defaultTemplateSkillsDir).includes(skill),
  );
  const missingPerTemplate = [
    ...new Set(Object.values(templateSharedSkillIncludesByTemplate).flat()),
  ].filter((skill) => !sourceSkills.includes(skill));
  const missingHeadless = headlessTemplateSharedSkillIncludes.filter(
    (skill) => !sourceSkills.includes(skill),
  );

  const errors = [];
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
  if (missingDefaultLocal.length > 0) {
    errors.push(
      `Default-template local skills missing from ${defaultTemplateSkillsDir}: ${missingDefaultLocal.join(", ")}`,
    );
  }
  if (missingPerTemplate.length > 0) {
    errors.push(
      `Per-template shared skills missing from ${sourceDir}: ${missingPerTemplate.join(
        ", ",
      )}`,
    );
  }
  if (missingHeadless.length > 0) {
    errors.push(
      `Headless-template skills missing from ${sourceDir}: ${missingHeadless.join(
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
    .filter((entry) => {
      if (!isDirEntry(templatesDir, entry)) return false;
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        return false;
      }
      return (
        existsSync(join(templatesDir, entry.name, "package.json")) &&
        !isRetiredCompatibilityTemplate(entry.name)
      );
    })
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

function hasInteractionResponsivenessSkill(content) {
  const match = content.match(
    /^## Interaction Responsiveness\n\n((?:(?!^## ).)*)/ms,
  );
  if (!match) return false;
  const section = match[1];
  return (
    section.includes("100 ms") &&
    section.includes("400 ms") &&
    section.includes("network round-trip")
  );
}

function checkGeneratedInstructionPhrases() {
  const findings = [];
  for (const file of listInstructionFiles()) {
    const content = readFileSync(file, "utf-8");
    for (const { pattern, message } of staleInstructionPatterns) {
      if (pattern.test(content)) {
        findings.push(`${relative(rootDir, file)}: ${message}`);
      }
    }
  }

  for (const { rel, pattern, message } of requiredGeneratedGuidance) {
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(`${rel}: missing required generated-app guidance file`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    if (!pattern.test(content)) {
      findings.push(`${rel}: missing ${message}`);
    }
  }

  for (const template of listTemplateDirs()) {
    const rel = `templates/${template}/AGENTS.md`;
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(`${rel}: missing required generated-app guidance file`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    if (!runtimeIntegrationGuidancePattern.test(content)) {
      findings.push(`${rel}: missing runtime-visible integration preflight`);
    }
  }

  const interactionResponsivenessSkillFile = join(
    sourceDir,
    "frontend-design",
    "SKILL.md",
  );
  if (
    !hasInteractionResponsivenessSkill(
      readFileSync(interactionResponsivenessSkillFile, "utf-8"),
    )
  ) {
    findings.push(
      ".agents/skills/frontend-design/SKILL.md: missing bounded interaction responsiveness guidance",
    );
  }

  for (const rel of [
    ...requiredRuntimeInstructionFiles,
    ...listTemplateDirs().map((template) => `templates/${template}/AGENTS.md`),
  ]) {
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(
        `${rel}: missing required interaction responsiveness guidance file`,
      );
      continue;
    }
    if (
      !interactionResponsivenessInstructionPattern.test(
        readFileSync(file, "utf-8"),
      )
    ) {
      findings.push(`${rel}: missing interaction responsiveness guidance`);
    }
  }

  for (const { rel, pattern } of requiredAgentWorkflowGuidance) {
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(`${rel}: missing required agent-workflow guidance file`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    if (!pattern.test(content)) {
      findings.push(
        `${rel}: missing deterministic-action versus AgentSidebar guidance`,
      );
    }
  }

  for (const rel of requiredToolkitDiscoveryGuidance) {
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(`${rel}: missing required Toolkit discovery guidance file`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    if (
      !content.includes(
        "Before building common workspace or agent UI, read `agent-native-toolkit`",
      )
    ) {
      findings.push(`${rel}: missing canonical Toolkit discovery guidance`);
    }
    if (!content.includes("`customizing-agent-native`")) {
      findings.push(`${rel}: missing customization ladder guidance`);
    }
  }

  for (const template of listTemplateDirs()) {
    const rel = `templates/${template}/AGENTS.md`;
    const file = join(rootDir, rel);
    if (!existsSync(file)) {
      findings.push(`${rel}: missing template agent instructions`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    if (
      !content.includes(
        "Before building common workspace or agent UI, read `agent-native-toolkit`",
      ) ||
      !content.includes("`customizing-agent-native`")
    ) {
      findings.push(`${rel}: missing Toolkit discovery/customization guidance`);
    }
  }

  const registry = JSON.parse(
    readFileSync(join(rootDir, "registry.json"), "utf-8"),
  );
  const conventionPaths = new Set(
    registry.items
      ?.find((item) => item.name === "conventions")
      ?.files?.map((file) => file.path) ?? [],
  );
  for (const skill of requiredRegistryConventionSkills) {
    const expected = `.agents/skills/${skill}/SKILL.md`;
    if (!conventionPaths.has(expected)) {
      findings.push(`registry.json: conventions must install ${expected}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Generated app guidance is out of sync.\n\n${findings.join("\n")}`,
    );
  }
}

function checkInstructionSkillReferences() {
  const knownSkillNames = new Set([
    ...FRAMEWORK_TEMPLATE_SHARED_SKILLS,
    ...listSkillDirs(sourceDir),
    ...listSkillDirs(defaultTemplateSkillsDir),
    ...listSkillDirs(headlessTemplateSkillsDir),
    ...listSkillDirs(targetDir),
    ...listSkillDirs(factoryBundleSkillsDir),
    ...listTemplateDirs().flatMap((template) =>
      listSkillDirs(join(templatesDir, template, ".agents", "skills")),
    ),
  ]);
  const scaffoldInstructions = [
    {
      rel: "packages/core/src/templates/default/AGENTS.md",
      skillsDir: defaultTemplateSkillsDir,
    },
    {
      rel: "packages/core/src/templates/headless/AGENTS.md",
      skillsDir: headlessTemplateSkillsDir,
    },
    {
      rel: "packages/core/src/templates/workspace-core/AGENTS.md",
      skillsDir: targetDir,
    },
    {
      rel: "packages/core/src/templates/workspace-root/AGENTS.md",
      skillsDir: targetDir,
    },
    ...listTemplateDirs().map((template) => ({
      rel: `templates/${template}/AGENTS.md`,
      skillsDir: join(templatesDir, template, ".agents", "skills"),
    })),
  ];
  const findings = [];
  for (const { rel, skillsDir } of scaffoldInstructions) {
    const instructions = join(rootDir, rel);
    if (!existsSync(instructions)) continue;
    const content = readFileSync(instructions, "utf-8");
    if (!content.includes("rg --hidden --follow")) {
      findings.push(
        `${rel}: missing hidden and linked skill discovery command`,
      );
    }
    for (const flag of ["query", "slug"]) {
      if (!content.includes(`pnpm action docs-search --${flag}`)) {
        findings.push(`${rel}: missing docs-search --${flag} command`);
      }
    }
    const shippedSkills = new Set(listSkillDirs(skillsDir));
    const missing = missingInstructionSkillReferences(
      content,
      shippedSkills,
      knownSkillNames,
    );
    if (missing.length > 0) {
      findings.push(
        `${rel}: references skills not shipped here: ${missing.join(", ")}`,
      );
    }
  }

  const skillScaffoldDirs = [
    dirname(dirname(defaultTemplateSkillsDir)),
    dirname(dirname(headlessTemplateSkillsDir)),
    dirname(dirname(targetDir)),
    join(rootDir, "packages", "core", "src", "templates", "workspace-root"),
    dirname(dirname(chatStarterSkillsDir)),
    dirname(dirname(factoryBundleSkillsDir)),
    ...listTemplateDirs().map((template) => join(templatesDir, template)),
  ];
  for (const dir of skillScaffoldDirs) {
    const ignoreFile = join(dir, ".ignore");
    const rel = relative(rootDir, ignoreFile);
    if (
      !existsSync(ignoreFile) ||
      !readFileSync(ignoreFile, "utf-8").split(/\r?\n/).includes("!.agents/")
    ) {
      findings.push(`${rel}: missing !.agents/ skill-discovery exception`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Generated AGENTS.md skill references are out of sync.\n\n${findings.join("\n")}`,
    );
  }
}

function checkSyncedSkillFrontmatter() {
  const skills = new Set([
    ...workspaceSkillIncludes,
    ...defaultTemplateSyncedSkillIncludes,
    ...headlessTemplateSharedSkillIncludes,
    ...Object.values(templateSharedSkillIncludesByTemplate).flat(),
  ]);
  const findings = [];
  for (const skill of [...skills].sort()) {
    const file = join(sourceDir, skill, "SKILL.md");
    if (!existsSync(file)) {
      findings.push(`${skill}: missing SKILL.md`);
      continue;
    }
    const content = readFileSync(file, "utf-8");
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const fields = frontmatter?.[1];
    if (!fields) {
      findings.push(`${skill}: missing YAML frontmatter`);
      continue;
    }
    const name = fields.match(/^name:\s*(\S+)\s*$/m)?.[1];
    const descriptionLine = fields.match(/^description:\s*(.*)$/m)?.[1];
    const descriptionHasValue = Boolean(
      descriptionLine?.trim() ||
      (descriptionLine !== undefined &&
        fields
          .slice(fields.indexOf("description:") + "description:".length)
          .split("\n")
          .slice(1)
          .some((line) => /^\s+\S/.test(line))),
    );
    if (name !== skill || !descriptionHasValue) {
      findings.push(
        `${skill}: frontmatter must name the skill and describe what/when to use it`,
      );
    }
  }
  if (findings.length > 0) {
    throw new Error(
      `Synced skill frontmatter is incomplete.\n\n${findings.join("\n")}`,
    );
  }
}

function forEachExistingTemplateSharedSkill(fn) {
  for (const skill of defaultTemplateSyncedSkillIncludes) {
    const targetSkillDir = join(defaultTemplateSkillsDir, skill);
    fn(
      "packages/core/src/templates/default/.agents/skills",
      skill,
      targetSkillDir,
    );
  }

  for (const skill of headlessTemplateSharedSkillIncludes) {
    const targetSkillDir = join(headlessTemplateSkillsDir, skill);
    fn(
      "packages/core/src/templates/headless/.agents/skills",
      skill,
      targetSkillDir,
    );
  }

  for (const skill of CHAT_STARTER_SKILLS) {
    const targetSkillDir = join(chatStarterSkillsDir, skill);
    fn(
      "packages/core/src/templates/chat/.agents/skills",
      skill,
      targetSkillDir,
    );
  }

  for (const template of listTemplateDirs()) {
    for (const skill of templateSkillsFor(template)) {
      const targetSkillDir = join(
        templatesDir,
        template,
        ".agents",
        "skills",
        skill,
      );
      fn(`templates/${template}/.agents/skills`, skill, targetSkillDir);
    }
  }
}

function checkTemplateSharedSkillsInSync() {
  forEachExistingTemplateSharedSkill((label, skill, targetSkillDir) => {
    checkSkillDirInSync(label, skill, targetSkillDir);
  });
  checkNoStaleTemplateSharedSkills();
}

function checkFactoryBundleSkillsInSync() {
  for (const skill of factoryBundleSkillIncludes) {
    checkSkillDirInSync(
      "packages/core/src/templates/factory/.agents/skills",
      skill,
      join(factoryBundleSkillsDir, skill),
    );
  }
}

function forEachTemplateSkillsDir(fn) {
  fn(
    "packages/core/src/templates/default/.agents/skills",
    defaultTemplateSkillsDir,
    "default",
  );
  fn(
    "packages/core/src/templates/headless/.agents/skills",
    headlessTemplateSkillsDir,
    "headless",
  );
  fn(
    "packages/core/src/templates/chat/.agents/skills",
    chatStarterSkillsDir,
    "chat",
  );
  fn(
    "packages/core/src/templates/factory/.agents/skills",
    factoryBundleSkillsDir,
    "factory",
  );
  for (const template of listTemplateDirs()) {
    fn(
      `templates/${template}/.agents/skills`,
      join(templatesDir, template, ".agents", "skills"),
      template,
    );
  }
}

function checkNoStaleTemplateSharedSkills() {
  const extra = [];
  forEachTemplateSkillsDir((label, skillsDir, template) => {
    const includedSkills = includedSkillsForTemplate(template);
    const staleSkills = FRAMEWORK_TEMPLATE_SHARED_SKILLS.filter(
      (skill) => !includedSkills.includes(skill),
    );
    for (const skill of staleSkills) {
      if (existsSync(join(skillsDir, skill))) {
        extra.push(`${label}/${skill}`);
      }
    }
  });
  if (extra.length > 0) {
    throw new Error(
      `Optional framework skills are still copied into templates:\n${extra.join(
        "\n",
      )}\n\nRun: pnpm sync:workspace-skills`,
    );
  }
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function isAbsoluteLinkTarget(target) {
  return isAbsolute(target) || win32.isAbsolute(target);
}

function resolveSourceSkill(skill) {
  const sourceSkillDir = realpathSync(join(sourceDir, skill));
  if (!allowedSourceRoots.some((root) => isWithin(root, sourceSkillDir))) {
    throw new Error(
      `Refusing to copy ${skill}: resolved source is outside approved skill roots (${sourceSkillDir})`,
    );
  }
  return sourceSkillDir;
}

function validateSourceSkills() {
  for (const skill of new Set([
    ...workspaceSkillIncludes,
    ...defaultTemplateSyncedSkillIncludes,
    ...headlessTemplateSharedSkillIncludes,
    ...Object.values(templateSharedSkillIncludesByTemplate).flat(),
  ])) {
    resolveSourceSkill(skill);
  }
}

function copySkill(skill, targetSkillDir) {
  const sourceSkillDir = resolveSourceSkill(skill);
  if (
    existsSync(targetSkillDir) &&
    lstatSync(targetSkillDir).isSymbolicLink() &&
    !isAbsoluteLinkTarget(readlinkSync(targetSkillDir))
  ) {
    return;
  }
  rmSync(targetSkillDir, { recursive: true, force: true });
  mkdirSync(dirname(targetSkillDir), { recursive: true });
  cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
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
  forEachTemplateSkillsDir((_label, skillsDir, template) => {
    const includedSkills = includedSkillsForTemplate(template);
    const staleSkills = FRAMEWORK_TEMPLATE_SHARED_SKILLS.filter(
      (skill) => !includedSkills.includes(skill),
    );
    for (const skill of staleSkills) {
      rmSync(join(skillsDir, skill), { recursive: true, force: true });
    }
  });
}

function syncFactoryBundleSkills() {
  rmSync(factoryBundleSkillsDir, { recursive: true, force: true });
  mkdirSync(factoryBundleSkillsDir, { recursive: true });
  for (const skill of factoryBundleSkillIncludes) {
    copySkill(skill, join(factoryBundleSkillsDir, skill));
  }
}

try {
  assertCategorized();
  validateSourceSkills();
  if (check) {
    checkInSync();
    checkTemplateSharedSkillsInSync();
    checkFactoryBundleSkillsInSync();
    checkGeneratedInstructionPhrases();
    checkInstructionSkillReferences();
    checkSyncedSkillFrontmatter();
    console.log(
      "Workspace-core, default-template, and template shared skills are in sync.",
    );
  } else {
    syncWorkspaceCoreSkills();
    syncTemplateSharedSkills();
    syncFactoryBundleSkills();
    checkInSync();
    checkTemplateSharedSkillsInSync();
    checkFactoryBundleSkillsInSync();
    checkGeneratedInstructionPhrases();
    checkInstructionSkillReferences();
    checkSyncedSkillFrontmatter();
    console.log(
      "Synced workspace-core, default-template, and template shared skills from .agents/skills.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
