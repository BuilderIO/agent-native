import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const RELEASE_COMMAND = /\bmigrate:production\b/;
const RELEASE_FLAG =
  /^\s*AGENT_NATIVE_RELEASE_MIGRATIONS\s*=\s*["']1["']\s*(?:#.*)?$/m;

/**
 * Production builds that run a release migration must bake the ownership
 * decision into their server bundle. Without it, the shared migration runner
 * quite correctly assumes previews own their schema and probes the database
 * from every production serverless request.
 */
export function validateNetlifyReleaseMigrationConfig(
  source: string,
  file = "netlify.toml",
): string[] {
  const build = readTomlSection(source, "build");
  if (!build || !RELEASE_COMMAND.test(build)) return [];

  const productionEnvironment = readTomlSection(
    source,
    "context.production.environment",
  );
  if (productionEnvironment === null) {
    return [
      `${file}: production runs migrate:production but has no [context.production.environment] section`,
    ];
  }
  if (!RELEASE_FLAG.test(productionEnvironment)) {
    return [
      `${file}: production runs migrate:production but does not set AGENT_NATIVE_RELEASE_MIGRATIONS = "1" in [context.production.environment]`,
    ];
  }
  return [];
}

function readTomlSection(source: string, header: string): string | null {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${header}]`);
  if (start === -1) return null;
  const nextSection = lines.findIndex(
    (line, index) => index > start && /^\s*\[[^\]]+\]\s*$/.test(line),
  );
  return lines
    .slice(start + 1, nextSection === -1 ? undefined : nextSection)
    .join("\n");
}

export function findNetlifyReleaseMigrationIssues(
  repoRoot = REPO_ROOT,
): string[] {
  const files = collectNetlifyConfigsFrom(repoRoot);
  return files.flatMap((file) =>
    validateNetlifyReleaseMigrationConfig(
      readFileSync(file, "utf8"),
      path.relative(repoRoot, file),
    ),
  );
}

function collectNetlifyConfigsFrom(repoRoot: string): string[] {
  const files: string[] = [];
  const templatesDir = path.join(repoRoot, "templates");
  for (const entry of readdirSync(templatesDir)) {
    const file = path.join(templatesDir, entry, "netlify.toml");
    if (existsSync(file) && statSync(file).isFile()) files.push(file);
  }
  const docsFile = path.join(repoRoot, "packages/docs/netlify.toml");
  if (existsSync(docsFile) && statSync(docsFile).isFile()) files.push(docsFile);
  return files.sort();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const issues = findNetlifyReleaseMigrationIssues();
  if (issues.length > 0) {
    console.error("guard-netlify-release-migrations failed:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(
    "guard-netlify-release-migrations: clean (release-owned production schemas skip request probes).",
  );
}
