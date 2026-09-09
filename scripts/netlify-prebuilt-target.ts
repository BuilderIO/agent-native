import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type NetlifyDeploymentTarget = "beta" | "production";

export type ResolvedNetlifyPrebuiltTarget = {
  functionsDirectory: string;
  host: string;
  publishDirectory: string;
  siteId: string;
  siteName: string;
  sourceRef: "beta" | "main";
  sourceTemplate: string;
};

type SourceProject = {
  functionsDirectory: string;
  packageDirectory: string;
  publishDirectory: string;
  filter: string;
};

type ProductionSite = {
  host: string;
  siteId: string;
};

type BetaSite = ProductionSite & {
  id: string;
};

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readJson<T>(fileName: string, repoRoot: string): T {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "scripts", fileName), "utf8"),
  ) as T;
}

function canonicalSiteName(
  target: NetlifyDeploymentTarget,
  requestedSite: string,
): string {
  const site = requestedSite.trim().toLowerCase();
  if (!site) throw new Error("A Netlify site id is required.");

  if (target === "beta") {
    return site === "starter" ? "chat" : site;
  }

  if (target === "production") {
    return site === "chat" ? "starter" : site === "www" ? "fw" : site;
  }

  throw new Error(`Unknown Netlify deployment target: ${target}`);
}

function sourceProject(siteName: string, repoRoot: string): SourceProject {
  if (siteName === "fw") {
    return {
      filter: "@agent-native/docs",
      functionsDirectory: "packages/docs/.netlify/functions-internal",
      packageDirectory: path.join(repoRoot, "packages/docs"),
      publishDirectory: "packages/docs/dist",
    };
  }

  const sourceTemplate = siteName === "starter" ? "chat" : siteName;
  return {
    filter: sourceTemplate,
    functionsDirectory: `templates/${sourceTemplate}/.netlify/functions-internal`,
    packageDirectory: path.join(repoRoot, "templates", sourceTemplate),
    publishDirectory: `templates/${sourceTemplate}/dist`,
  };
}

export function resolveNetlifyPrebuiltTarget(
  target: NetlifyDeploymentTarget,
  requestedSite: string,
  repoRoot = REPO_ROOT,
): ResolvedNetlifyPrebuiltTarget {
  if (target !== "beta" && target !== "production") {
    throw new Error(`Unknown Netlify deployment target: ${target}`);
  }

  const siteName = canonicalSiteName(target, requestedSite);
  const site =
    target === "beta"
      ? readJson<BetaSite[]>("netlify-beta-sites.json", repoRoot).find(
          (candidate) => candidate.id === siteName,
        )
      : readJson<Record<string, ProductionSite>>(
          "netlify-production-sites.json",
          repoRoot,
        )[siteName];

  if (!site) {
    throw new Error(
      `Unknown ${target} Netlify site: ${requestedSite.trim() || "(empty)"}`,
    );
  }

  const project = sourceProject(siteName, repoRoot);
  if (
    !existsSync(path.join(project.packageDirectory, "package.json")) ||
    !existsSync(path.join(project.packageDirectory, "netlify.toml"))
  ) {
    throw new Error(
      `${target} site ${siteName} has no buildable template mapping; refusing to guess a source directory.`,
    );
  }

  return {
    functionsDirectory: project.functionsDirectory,
    host: site.host,
    publishDirectory: project.publishDirectory,
    siteId: site.siteId,
    siteName,
    sourceRef: target === "beta" ? "beta" : "main",
    sourceTemplate: project.filter,
  };
}

export function writeGitHubOutputs(
  target: ResolvedNetlifyPrebuiltTarget,
  outputPath: string,
): void {
  const outputs: Record<string, string> = {
    functions_directory: target.functionsDirectory,
    host: target.host,
    publish_directory: target.publishDirectory,
    site_id: target.siteId,
    site_name: target.siteName,
    source_ref: target.sourceRef,
    source_template: target.sourceTemplate,
  };

  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(outputPath, `${key}=${value}\n`);
  }
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const target = argumentValue("--target") as
    | NetlifyDeploymentTarget
    | undefined;
  const site = argumentValue("--site");
  if (!target || !site) {
    throw new Error(
      "Usage: netlify-prebuilt-target.ts --target <beta|production> --site <site> [--github-output <path>]",
    );
  }

  const resolved = resolveNetlifyPrebuiltTarget(target, site);
  const outputPath = argumentValue("--github-output");
  if (outputPath) {
    writeGitHubOutputs(resolved, outputPath);
  } else {
    console.log(JSON.stringify(resolved, null, 2));
  }
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) main();
