import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BETA_PREBUILT_WORKFLOW = ".github/workflows/deploy-netlify-prebuilt.yml";
const BETA_SCHEMA_OWNER_RUNTIME_FILES = [
  "packages/core/src/db/migrations.ts",
  "packages/core/src/vite/client.ts",
  "packages/core/src/deploy/build.ts",
] as const;
const BETA_SCHEMA_OWNER_MARKER = "AGENT_NATIVE_BETA_SCHEMA_OWNER";
const BETA_SCHEMA_OWNER_CONFIG_CONSUMER = "migration.betaSchemaOwner";
const RELEASE_COMMAND = /\bmigrate:production\b/;
const RELEASE_FLAG =
  /^\s*AGENT_NATIVE_RELEASE_MIGRATIONS\s*=\s*["']1["']\s*(?:#.*)?$/m;
const BETA_RELEASE_FLAG = /\bAGENT_NATIVE_RUN_RELEASE_MIGRATIONS\b/;
const BETA_SCHEMA_OWNER_EXPORT =
  "export AGENT_NATIVE_BETA_SCHEMA_OWNER=production";
const CLIPS_PREBUILT_MIGRATION_SKIP =
  /agentNativePrebuiltBuild:-\}.*!= \\\"true\\\".*migrate:production/;

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

/**
 * Published sites have two build lanes in this repository: production and the
 * automatic beta prebuilt lane. A production-only command/flag is not enough
 * when beta builds use branch-deploy context, because that leaves the request
 * runtime doing schema probes on every cold function.
 */
export function validatePublishedNetlifyReleaseMigrationConfig(
  source: string,
  file = "netlify.toml",
  sourceTemplate = "",
): string[] {
  const build = readTomlSection(source, "build");
  if (!build || !RELEASE_COMMAND.test(build)) {
    return [
      `${file}: published production/beta site must run migrate:production in its [build] command`,
    ];
  }

  const issues = validateNetlifyReleaseMigrationConfig(source, file);
  if (
    sourceTemplate !== "clips" ||
    !CLIPS_PREBUILT_MIGRATION_SKIP.test(build)
  ) {
    if (!BETA_RELEASE_FLAG.test(build)) {
      issues.push(
        `${file}: beta branch-deploy builds run migrate:production only when AGENT_NATIVE_RUN_RELEASE_MIGRATIONS = "1" is supplied by the prebuilt beta lane`,
      );
    }
  }
  return issues;
}

export function validateBetaPrebuiltReleaseEnvironment(
  source: string,
  file = BETA_PREBUILT_WORKFLOW,
): string[] {
  const betaStart = source.indexOf('if [[ "$TARGET" == "beta" ]]');
  const betaEnd = source.indexOf(
    'if [[ "$SOURCE_TEMPLATE" == "clips" ]]',
    betaStart,
  );
  const betaBuild =
    betaStart >= 0 && betaEnd > betaStart
      ? source.slice(betaStart, betaEnd)
      : "";
  const nonClipsBlockMatch = betaBuild.match(
    /if \[\[ "\$SOURCE_TEMPLATE" != "clips" \]\]; then([\s\S]*?)\n\s*fi/,
  );
  const nonClipsBlock = nonClipsBlockMatch?.[1] ?? "";
  const clipsOwnerBlockMatch = betaBuild.match(
    /if \[\[ "\$SOURCE_TEMPLATE" != "clips" \]\]; then[\s\S]*?\n\s*else([\s\S]*?)\n\s*fi/,
  );
  const clipsOwnerBlock = clipsOwnerBlockMatch?.[1] ?? "";
  const releaseExports = [
    "export AGENT_NATIVE_RELEASE_MIGRATIONS=1",
    "export AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1",
  ];
  const warmRuntimeExports = [
    "export AGENT_NATIVE_ENABLE_KEEP_WARM=1",
    "export AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND=1",
    "export AGENT_NATIVE_HOSTED_HARNESS=true",
  ];
  const issues: string[] = [];
  for (const entry of warmRuntimeExports) {
    if (!betaBuild.includes(entry)) {
      issues.push(
        `${file}: beta build must export ${entry.replace(/^export /, "")} inside its beta-only build block`,
      );
    }
  }
  if (!nonClipsBlockMatch) {
    issues.push(
      `${file}: beta build must scope release migration exports to a non-Clips template block`,
    );
  }
  if (
    !clipsOwnerBlockMatch ||
    !clipsOwnerBlock.includes(BETA_SCHEMA_OWNER_EXPORT)
  ) {
    issues.push(
      `${file}: Clips beta build must export AGENT_NATIVE_BETA_SCHEMA_OWNER=production only in the Clips branch of its beta-only build block`,
    );
  }
  for (const entry of releaseExports) {
    if (!nonClipsBlock.includes(entry)) {
      issues.push(
        `${file}: beta build must export ${entry.replace(/^export /, "")} inside the non-Clips template block`,
      );
    }
  }
  const betaOutsideNonClipsBlock = nonClipsBlockMatch
    ? betaBuild.replace(nonClipsBlockMatch[0], "")
    : betaBuild;
  for (const entry of releaseExports) {
    if (betaOutsideNonClipsBlock.includes(entry)) {
      issues.push(
        `${file}: ${entry.replace(/^export /, "")} must not be exported for Clips beta builds`,
      );
    }
  }
  const betaOutsideClipsOwnerBlock = clipsOwnerBlockMatch
    ? betaBuild.replace(clipsOwnerBlockMatch[0], "")
    : betaBuild;
  if (betaOutsideClipsOwnerBlock.includes(BETA_SCHEMA_OWNER_EXPORT)) {
    issues.push(
      `${file}: AGENT_NATIVE_BETA_SCHEMA_OWNER=production must not be exported outside the Clips branch of the beta-only build block`,
    );
  }
  return issues;
}

export function validateBetaSchemaOwnerRuntimeContract(
  repoRoot = REPO_ROOT,
): string[] {
  const issues: string[] = [];
  for (const relativeFile of BETA_SCHEMA_OWNER_RUNTIME_FILES) {
    const file = path.join(repoRoot, relativeFile);
    if (!existsSync(file)) {
      issues.push(
        `${relativeFile}: production-owned beta schema marker has no runtime/build integration file`,
      );
      continue;
    }
    const source = readFileSync(file, "utf8");
    const consumesConfigBackedMarker =
      relativeFile === "packages/core/src/db/migrations.ts" &&
      source.includes("getAppConfig") &&
      source.includes(BETA_SCHEMA_OWNER_CONFIG_CONSUMER);
    if (
      !source.includes(BETA_SCHEMA_OWNER_MARKER) &&
      !consumesConfigBackedMarker
    ) {
      issues.push(
        `${relativeFile}: must consume or embed ${BETA_SCHEMA_OWNER_MARKER} instead of treating it as a config-only marker`,
      );
    }
  }
  return issues;
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
  const issues: string[] = [];
  for (const { file, sourceTemplate } of collectPublishedNetlifyConfigs(
    repoRoot,
  )) {
    const relativeFile = path.relative(repoRoot, file);
    if (!existsSync(file)) {
      issues.push(
        `${relativeFile}: published Netlify site has no netlify.toml`,
      );
      continue;
    }
    issues.push(
      ...validatePublishedNetlifyReleaseMigrationConfig(
        readFileSync(file, "utf8"),
        relativeFile,
        sourceTemplate,
      ),
    );
  }

  const workflow = path.join(repoRoot, BETA_PREBUILT_WORKFLOW);
  if (!existsSync(workflow)) {
    issues.push(`${BETA_PREBUILT_WORKFLOW}: beta prebuilt workflow is missing`);
  } else {
    issues.push(
      ...validateBetaPrebuiltReleaseEnvironment(readFileSync(workflow, "utf8")),
    );
  }
  issues.push(...validateBetaSchemaOwnerRuntimeContract(repoRoot));
  return issues;
}

type PublishedNetlifyConfig = {
  file: string;
  sourceTemplate: string;
};

function collectPublishedNetlifyConfigs(
  repoRoot: string,
): PublishedNetlifyConfig[] {
  const files = new Map<string, string>();
  const add = (siteName: string): void => {
    if (siteName === "workspace") return;
    const sourceTemplate =
      siteName === "fw"
        ? "@agent-native/docs"
        : siteName === "starter"
          ? "chat"
          : siteName;
    const file =
      siteName === "fw"
        ? path.join(repoRoot, "packages/docs/netlify.toml")
        : path.join(repoRoot, "templates", sourceTemplate, "netlify.toml");
    files.set(file, sourceTemplate);
  };

  const betaSites = JSON.parse(
    readFileSync(
      path.join(repoRoot, "scripts/netlify-beta-sites.json"),
      "utf8",
    ),
  ) as Array<{ id: string }>;
  for (const site of betaSites) add(site.id);

  const productionSites = JSON.parse(
    readFileSync(
      path.join(repoRoot, "scripts/netlify-production-sites.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  for (const siteName of Object.keys(productionSites)) add(siteName);

  return [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, sourceTemplate]) => ({ file, sourceTemplate }));
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
    "guard-netlify-release-migrations: clean (published production and beta schemas have explicit owners).",
  );
}
