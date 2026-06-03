import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
const npmPublishAllowlist = new Set([
  "@agent-native/core",
  "@agent-native/dispatch",
  "@agent-native/pinpoint",
  "@agent-native/scheduling",
]);

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; stream?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: process.env,
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
  if (
    output.includes("E404") ||
    output.includes("404 Not Found") ||
    output.includes("No match found")
  ) {
    return false;
  }
  throw new Error(
    `Unable to check whether ${pkg.name}@${pkg.version} is published:\n${output}`,
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

function tagName(pkg: PublishPackage): string {
  return `${pkg.name}@${pkg.version}`;
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

  console.log(`Publishing \"${pkg.name}\" at \"${pkg.version}\"`);
  const result = await run("npm", [
    "publish",
    publishDir,
    "--access",
    access,
    "--tag",
    "latest",
    `--registry=${registry}`,
    "--provenance",
    "--json",
  ]);

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

  throw new Error(
    `Failed to publish ${pkg.name}@${pkg.version} with exit code ${result.code}`,
  );
}

async function main() {
  const packages = await getPublishPackages();
  const packagesNeedingTags: PublishPackage[] = [];

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
        packagesNeedingTags.push(pkg);
      }
      continue;
    }
    console.log(
      `${pkg.name} is being published because local version ${pkg.version} has not been published on npm`,
    );
    if (await publishPackage(pkg)) {
      packagesNeedingTags.push(pkg);
    }
  }

  if (packagesNeedingTags.length === 0) {
    console.log("No unpublished packages found");
    return;
  }

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
