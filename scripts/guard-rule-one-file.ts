import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const communityTemplateCopies = [
  "community-templates/account-expert",
  "community-templates/account-tiering",
  "community-templates/call-follow-up-drafter",
  "community-templates/churn-early-warning",
  "community-templates/demo-clip-library",
  "community-templates/linkedin-icp-prospect-tracker",
  "community-templates/linkedin-signal-watch",
  "community-templates/outbound-in-your-voice",
  "community-templates/win-loss-memo",
];

const coreTemplateCopies = [
  "packages/core/src/templates/default",
  "packages/core/src/templates/headless",
  "packages/core/src/templates/workspace-core",
  "packages/core/src/templates/workspace-root",
];

const appTemplateCopies = [
  "templates/analytics",
  "templates/assets",
  "templates/brain",
  "templates/calendar",
  "templates/chat",
  "templates/clips",
  "templates/community/qr",
  "templates/content",
  "templates/crm",
  "templates/design",
  "templates/dispatch",
  "templates/factory",
  "templates/forms",
  "templates/mail",
  "templates/plan",
  "templates/slides",
  "templates/tasks",
];

// These payloads are scaffolded or packaged for consumers that require a real AGENTS.md.
export const copyReasons = new Map<string, string>([
  ...communityTemplateCopies.map(
    (directory) =>
      [
        directory,
        "Published community template; scaffold consumers require a real AGENTS.md.",
      ] as const,
  ),
  [
    "registry/agent-native-app",
    "Published registry payload; consumers require a real AGENTS.md.",
  ],
  ...coreTemplateCopies.map(
    (directory) =>
      [
        directory,
        "Packaged core template; npm and scaffold consumers require a real AGENTS.md.",
      ] as const,
  ),
  ...appTemplateCopies.map(
    (directory) =>
      [
        directory,
        "Scaffolded app template; consumers require a real AGENTS.md.",
      ] as const,
  ),
]);

function trackedPaths(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

export function checkRuleFilePairs(
  root: string,
  files = trackedPaths(root),
  copies: ReadonlyMap<string, string> = copyReasons,
): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const name = path.posix.basename(file);
    if (name === "AGENTS.md" || name === "CLAUDE.md") {
      directories.add(path.posix.dirname(file));
    }
  }

  const errors: string[] = [];
  for (const relativeDirectory of [...directories].sort()) {
    const directory = path.join(
      root,
      relativeDirectory === "." ? "" : relativeDirectory,
    );
    const agentsPath = path.join(directory, "AGENTS.md");
    const claudePath = path.join(directory, "CLAUDE.md");
    if (!existsSync(agentsPath) && !existsSync(claudePath)) continue;
    let agents;
    let claude;
    try {
      agents = lstatSync(agentsPath);
      claude = lstatSync(claudePath);
    } catch {
      errors.push(
        `${relativeDirectory}: both AGENTS.md and CLAUDE.md must exist`,
      );
      continue;
    }

    const reason = copies.get(relativeDirectory);
    if (reason) {
      if (agents.isSymbolicLink() || claude.isSymbolicLink()) {
        errors.push(`${relativeDirectory}: keep real copies (${reason})`);
        continue;
      }
      if (!readFileSync(agentsPath).equals(readFileSync(claudePath))) {
        errors.push(`${relativeDirectory}: copy contents differ (${reason})`);
      }
      continue;
    }

    if (claude.isSymbolicLink()) {
      errors.push(`${relativeDirectory}: CLAUDE.md must be the real file`);
    }
    if (!agents.isSymbolicLink()) {
      errors.push(
        `${relativeDirectory}: AGENTS.md must be a symlink to CLAUDE.md`,
      );
    } else if (
      path.posix.normalize(
        path.posix.join(relativeDirectory, readlinkSync(agentsPath)),
      ) !== path.posix.join(relativeDirectory, "CLAUDE.md")
    ) {
      errors.push(
        `${relativeDirectory}: AGENTS.md must link to its sibling CLAUDE.md`,
      );
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    const errors = checkRuleFilePairs(process.cwd());
    if (errors.length) {
      console.error(
        errors.map((error) => `[guard:rule-one-file] ${error}`).join("\n"),
      );
      process.exitCode = 1;
    } else {
      console.log("[guard:rule-one-file] all rule-file pairs are canonical");
    }
  } catch (error) {
    console.error(
      "[guard:rule-one-file] could not inspect tracked files",
      error,
    );
    process.exitCode = 2;
  }
}
