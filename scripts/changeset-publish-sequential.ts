import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishConfig?: {
    access?: string;
    directory?: string;
  };
};

type PublishPackage = {
  dir: string;
  name: string;
  version: string;
  packageJson: PackageJson;
};

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const registry = "https://registry.npmjs.org";
const availabilityPollIntervalMs = 10_000;
const availabilityTimeoutMs = Number(
  process.env.AGENT_NATIVE_NPM_AVAILABILITY_TIMEOUT_MS ?? 5 * 60_000,
);
const npmPublishAllowlist = new Set([
  "@agent-native/core",
  "@agent-native/dispatch",
  "@agent-native/pinpoint",
  "@agent-native/scheduling",
  "@agent-native/skills",
  "@agent-native/toolkit",
]);

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; stream?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (options.stream !== false) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options.stream !== false) {
        process.stderr.write(text);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isRegistryNotFound(output: string): boolean {
  return (
    output.includes("E404") ||
    output.includes("404 Not Found") ||
    output.includes("No match found")
  );
}

function parseJsonOutput(output: string, context: string): unknown {
  const trimmed = output.trim();
  const starts: number[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (
      (char === "[" || char === "{") &&
      (index === 0 || trimmed[index - 1] === "\n")
    ) {
      starts.push(index);
    }
  }

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index];
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {}
  }

  throw new Error(`Unable to parse JSON output for ${context}:\n${output}`);
}

export function parsePackJson(output: string, pkg: PublishPackage): string {
  let parsed: unknown;
  try {
    parsed = parseJsonOutput(output, `pnpm pack ${tagName(pkg)}`);
  } catch (error) {
    const parseError = new Error(
      `Unable to parse pnpm pack output for ${tagName(pkg)}:\n${output}`,
    );
    (parseError as Error & { cause?: unknown }).cause = error;
    throw parseError;
  }

  const packResult = Array.isArray(parsed) ? parsed[0] : parsed;
  if (
    !packResult ||
    typeof packResult !== "object" ||
    typeof (packResult as { filename?: unknown }).filename !== "string"
  ) {
    throw new Error(
      `pnpm pack did not return a tarball filename for ${tagName(pkg)}:\n${output}`,
    );
  }

  return (packResult as { filename: string }).filename;
}

function protocolDependencyFailures(pkg: PackageJson): string[] {
  const packageName = pkg.name ?? "unknown package";
  const failures: string[] = [];
  for (const [field, dependencies] of Object.entries({
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
    optionalDependencies: pkg.optionalDependencies,
    peerDependencies: pkg.peerDependencies,
  })) {
    if (!dependencies) continue;
    for (const [dependencyName, version] of Object.entries(dependencies)) {
      if (/^(catalog|workspace):/.test(version)) {
        failures.push(
          `${packageName} ${field}.${dependencyName} still uses ${version}`,
        );
      }
    }
  }
  return failures;
}

async function assertPackedManifestIsPublishable(
  tarballPath: string,
  pkg: PublishPackage,
): Promise<void> {
  const result = await run(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    { stream: false },
  );
  if (result.code !== 0) {
    throw new Error(
      `Unable to read packed package.json for ${tagName(pkg)}:\n${result.stderr}`,
    );
  }

  const packedPackageJson = JSON.parse(result.stdout) as PackageJson;
  const failures = protocolDependencyFailures(packedPackageJson);
  if (failures.length > 0) {
    throw new Error(
      `Packed manifest for ${tagName(pkg)} is not publishable:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}`,
    );
  }
}

async function getPublishPackages(): Promise<PublishPackage[]> {
  const changesetConfig = await readJson<{ ignore?: string[] }>(
    path.join(rootDir, ".changeset/config.json"),
  );
  const ignored = new Set(changesetConfig.ignore ?? []);
  const packageRoot = path.join(rootDir, "packages");
  const packageDirs = await readdir(packageRoot);
  const packages: PublishPackage[] = [];

  for (const packageDir of packageDirs) {
    const dir = path.join(packageRoot, packageDir);
    const packageJsonPath = path.join(dir, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = await readJson<PackageJson>(packageJsonPath);
    if (
      packageJson.private ||
      !packageJson.name ||
      !packageJson.version ||
      ignored.has(packageJson.name) ||
      !npmPublishAllowlist.has(packageJson.name)
    ) {
      continue;
    }
    packages.push({
      dir,
      name: packageJson.name,
      version: packageJson.version,
      packageJson,
    });
  }

  return sortByLocalDependencies(packages);
}

function sortByLocalDependencies(packages: PublishPackage[]): PublishPackage[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const sorted: PublishPackage[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (pkg: PublishPackage) => {
    if (visited.has(pkg.name)) {
      return;
    }
    if (visiting.has(pkg.name)) {
      throw new Error(`Cycle detected in publish package graph at ${pkg.name}`);
    }
    visiting.add(pkg.name);
    const deps = {
      ...pkg.packageJson.dependencies,
      ...pkg.packageJson.peerDependencies,
      ...pkg.packageJson.devDependencies,
    };
    for (const depName of Object.keys(deps)) {
      const localDep = byName.get(depName);
      if (localDep) {
        visit(localDep);
      }
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    sorted.push(pkg);
  };

  for (const pkg of packages) {
    visit(pkg);
  }

  return sorted;
}

async function isPublished(pkg: PublishPackage): Promise<boolean> {
  const result = await run(
    "npm",
    [
      "view",
      `${pkg.name}@${pkg.version}`,
      "version",
      `--registry=${registry}`,
      "--json",
    ],
    { stream: false },
  );
  if (result.code === 0) {
    return true;
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (isRegistryNotFound(output)) {
    return false;
  }
  throw new Error(
    `Unable to check whether ${pkg.name}@${pkg.version} is published:\n${output}`,
  );
}

async function packageExistsOnRegistry(pkg: PublishPackage): Promise<boolean> {
  const result = await run(
    "npm",
    ["view", pkg.name, "version", `--registry=${registry}`, "--json"],
    { stream: false },
  );
  if (result.code === 0) return true;
  const output = `${result.stdout}\n${result.stderr}`;
  if (isRegistryNotFound(output)) return false;
  throw new Error(
    `Unable to check whether ${pkg.name} exists on npm:\n${output}`,
  );
}

function firstPublishToken(): string | null {
  return (
    process.env.AGENT_NATIVE_NPM_BOOTSTRAP_TOKEN ||
    process.env.NODE_AUTH_TOKEN ||
    process.env.NPM_TOKEN ||
    null
  );
}

function isAlreadyPublished(output: string): boolean {
  return (
    output.includes("E403") &&
    (output.includes("cannot publish over the previously published versions") ||
      output.includes(
        "You cannot publish over the previously published versions",
      ))
  );
}

// A 404 on the PUT for a package that isn't on npm yet means the registry
// would not let us CREATE the package. With OIDC trusted publishing this is
// expected: a brand-new package's first version cannot be created over OIDC
// and must be bootstrapped with a token (npm/cli#8544).
function isMissingPackageOnPublish(output: string): boolean {
  return (
    (output.includes("E404") || output.includes("404 Not Found")) &&
    (output.includes("PUT") ||
      output.includes("could not be found or you do not have permission"))
  );
}

function makePublishError(message: string, isMissingPackage: boolean): Error {
  const error = new Error(message);
  (error as Error & { isMissingPackage?: boolean }).isMissingPackage =
    isMissingPackage;
  return error;
}

function tagName(pkg: PublishPackage): string {
  return `${pkg.name}@${pkg.version}`;
}

async function waitForPackageAvailability(pkg: PublishPackage): Promise<void> {
  const startedAt = Date.now();
  let attempt = 0;
  let lastOutput = "";

  while (Date.now() - startedAt <= availabilityTimeoutMs) {
    attempt += 1;
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "agent-native-npm-"));
    try {
      const result = await run(
        "npm",
        [
          "pack",
          tagName(pkg),
          "--pack-destination",
          tmpRoot,
          `--registry=${registry}`,
          "--json",
          "--prefer-online",
          "--cache",
          path.join(tmpRoot, "cache"),
        ],
        { stream: false },
      );
      if (result.code === 0) {
        console.log(
          `${tagName(pkg)} is fetchable from npm after ${attempt} attempt(s)`,
        );
        return;
      }
      lastOutput = `${result.stdout}\n${result.stderr}`.trim();
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = availabilityTimeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      break;
    }
    const waitMs = Math.min(availabilityPollIntervalMs, remainingMs);
    console.warn(
      `${tagName(pkg)} is published but not fetchable yet; retrying in ${Math.ceil(
        waitMs / 1000,
      )}s`,
    );
    await sleep(waitMs);
  }

  throw new Error(
    `${tagName(pkg)} was published but npm could not fetch it within ${Math.ceil(
      availabilityTimeoutMs / 1000,
    )}s:\n${lastOutput}`,
  );
}

export function localRuntimeDependencyNames(pkg: PublishPackage): string[] {
  return Object.keys({
    ...pkg.packageJson.dependencies,
    ...pkg.packageJson.optionalDependencies,
  });
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const details = error.stack ?? error.message;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) {
    return details;
  }
  return `${details}\nCaused by: ${formatError(cause)}`;
}

async function hasRemoteTag(pkg: PublishPackage): Promise<boolean> {
  const result = await run(
    "git",
    ["ls-remote", "--tags", "origin", tagName(pkg)],
    { stream: false },
  );
  if (result.code !== 0) {
    throw new Error(
      `Unable to check whether ${tagName(pkg)} exists on origin:\n${result.stderr}`,
    );
  }
  return result.stdout.trim().length > 0;
}

async function hasLocalTag(pkg: PublishPackage): Promise<boolean> {
  const result = await run(
    "git",
    ["rev-parse", "-q", "--verify", `refs/tags/${tagName(pkg)}`],
    { stream: false },
  );
  if (result.code === 0) {
    return true;
  }
  if (result.code === 1) {
    return false;
  }
  throw new Error(
    `Unable to check whether ${tagName(pkg)} exists locally:\n${result.stderr}`,
  );
}

async function createLocalTag(pkg: PublishPackage): Promise<void> {
  if (await hasLocalTag(pkg)) {
    return;
  }
  const result = await run("git", ["tag", tagName(pkg)], { stream: false });
  if (result.code !== 0) {
    throw new Error(
      `Unable to create local tag ${tagName(pkg)}:\n${result.stderr}`,
    );
  }
}

async function publishPackage(pkg: PublishPackage): Promise<boolean> {
  const publishDir = path.resolve(
    pkg.dir,
    pkg.packageJson.publishConfig?.directory ?? ".",
  );
  const access = pkg.packageJson.publishConfig?.access ?? "public";
  const packageExists = await packageExistsOnRegistry(pkg);
  const bootstrapToken = packageExists ? null : firstPublishToken();

  if (!packageExists && !bootstrapToken) {
    throw makePublishError(
      `${pkg.name} does not exist on npm yet, and no first-publish token is configured. Set AGENT_NATIVE_NPM_BOOTSTRAP_TOKEN, NODE_AUTH_TOKEN, or NPM_TOKEN for the one-time package creation publish.`,
      true,
    );
  }

  console.log(`Publishing \"${pkg.name}\" at \"${pkg.version}\"`);
  if (bootstrapToken) {
    console.log(
      `${pkg.name} does not exist on npm yet; bootstrapping the first publish with a token and --no-provenance.`,
    );
  }
  const packDir = await mkdtemp(path.join(os.tmpdir(), "agent-native-pack-"));
  let result: RunResult | undefined;
  try {
    const packResult = await run("pnpm", [
      "--dir",
      publishDir,
      "pack",
      "--pack-destination",
      packDir,
      "--json",
    ]);
    if (packResult.code !== 0) {
      throw new Error(
        `Failed to pack ${tagName(pkg)} with exit code ${packResult.code}`,
      );
    }

    const tarballPath = parsePackJson(packResult.stdout, pkg);
    await assertPackedManifestIsPublishable(tarballPath, pkg);
    const publishArgs = [
      "publish",
      tarballPath,
      "--access",
      access,
      "--tag",
      "latest",
      `--registry=${registry}`,
      bootstrapToken ? "--no-provenance" : "--provenance",
      "--json",
    ];
    result = await run(
      "npm",
      publishArgs,
      bootstrapToken
        ? {
            env: {
              NODE_AUTH_TOKEN: bootstrapToken,
              NPM_CONFIG_PROVENANCE: "false",
            },
          }
        : undefined,
    );
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }

  if (!result) {
    throw new Error(`Publishing ${tagName(pkg)} did not produce a result`);
  }

  if (result.code === 0) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (isAlreadyPublished(output)) {
    console.warn(
      `${pkg.name}@${pkg.version} was already published by the time npm responded; skipping tag creation.`,
    );
    return false;
  }

  throw makePublishError(
    `Failed to publish ${pkg.name}@${pkg.version} with exit code ${result.code}`,
    isMissingPackageOnPublish(output),
  );
}

async function main() {
  const packages = await getPublishPackages();
  const packagesNeedingTags: PublishPackage[] = [];
  const failures: { pkg: PublishPackage; error: unknown }[] = [];
  const failedPackageNames = new Set<string>();

  for (const pkg of packages) {
    if (await isPublished(pkg)) {
      if (await hasRemoteTag(pkg)) {
        console.log(
          `${pkg.name} is not being published because version ${pkg.version} is already published on npm and ${tagName(pkg)} exists on origin`,
        );
      } else {
        console.log(
          `${pkg.name} is already published on npm, but ${tagName(pkg)} is missing on origin`,
        );
        await waitForPackageAvailability(pkg);
        packagesNeedingTags.push(pkg);
      }
      continue;
    }

    const failedLocalRuntimeDeps = localRuntimeDependencyNames(pkg).filter(
      (dependencyName) => failedPackageNames.has(dependencyName),
    );
    if (failedLocalRuntimeDeps.length > 0) {
      const error = new Error(
        `${tagName(pkg)} depends on failed local runtime package(s): ${failedLocalRuntimeDeps.join(
          ", ",
        )}`,
      );
      failures.push({ pkg, error });
      failedPackageNames.add(pkg.name);
      console.error(
        `::error::Skipping ${tagName(pkg)} because ${error.message}`,
      );
      continue;
    }

    console.log(
      `${pkg.name} is being published because local version ${pkg.version} has not been published on npm`,
    );
    // Don't let one package's failure abort the whole release: keep going so
    // packages that DID publish still get their git tags, then fail the run
    // at the end with a summary of what broke.
    try {
      if (await publishPackage(pkg)) {
        await waitForPackageAvailability(pkg);
        packagesNeedingTags.push(pkg);
      }
    } catch (error) {
      failures.push({ pkg, error });
      failedPackageNames.add(pkg.name);
      console.error(`::error::Failed to publish ${tagName(pkg)}`);
      console.error(formatError(error));
      if ((error as { isMissingPackage?: boolean }).isMissingPackage) {
        console.error(
          `${pkg.name} does not exist on npm yet, and OIDC trusted publishing ` +
            `cannot create a brand-new package (npm/cli#8544). Configure ` +
            `AGENT_NATIVE_NPM_BOOTSTRAP_TOKEN, NODE_AUTH_TOKEN, or NPM_TOKEN ` +
            `for a one-time token publish, or bootstrap it manually ` +
            `(\`cd ${path.relative(rootDir, pkg.dir)} && npm publish --access public --no-provenance\`). ` +
            `Then add a Trusted Publisher for it on npmjs.com matching the ` +
            `other @agent-native packages (repo BuilderIO/agent-native, workflow ` +
            `auto-publish.yml, environment npm-publish). After that, OIDC ` +
            `publishes every future version automatically.`,
        );
      }
    }
  }

  if (packagesNeedingTags.length === 0) {
    console.log("No unpublished packages found");
  } else {
    console.log("packages ready for release tags:");
    for (const pkg of packagesNeedingTags) {
      console.log(`${pkg.name}@${pkg.version}`);
    }
    for (const pkg of packagesNeedingTags) {
      console.log("Creating git tag...");
      await createLocalTag(pkg);
      console.log(`New tag:  ${tagName(pkg)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to publish ${failures.length} package(s): ${failures
        .map((failure) => tagName(failure.pkg))
        .join(", ")}`,
    );
  }
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
