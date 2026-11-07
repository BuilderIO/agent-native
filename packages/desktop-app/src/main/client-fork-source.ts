import fs from "node:fs/promises";
import path from "node:path";

import { runForkCommand } from "./client-forks.js";

export async function sparseForkSource(
  source: string,
  sha: string,
  appId: string,
): Promise<void> {
  const paths = (
    await runForkCommand(
      "git",
      ["ls-tree", "-r", "--name-only", sha],
      source,
      undefined,
      2_000_000,
    )
  ).split("\n");
  const manifests = new Map<
    string,
    { directory: string; dependencies: string[] }
  >();
  for (const filename of paths.filter((item) =>
    /^(?:packages\/[^/]+|templates\/[^/]+)\/package\.json$/.test(item),
  )) {
    const manifest = JSON.parse(
      await runForkCommand(
        "git",
        ["show", `${sha}:${filename}`],
        source,
        undefined,
        1_000_000,
      ),
    ) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    if (manifest.name)
      manifests.set(manifest.name, {
        directory: path.posix.dirname(filename),
        dependencies: Object.entries({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.optionalDependencies,
        })
          .filter(([, version]) => version.startsWith("workspace:"))
          .map(([name]) => name),
      });
  }
  const initial = [...manifests.entries()].find(
    ([, entry]) => entry.directory === `templates/${appId}`,
  );
  if (!initial)
    throw new Error("The deployed app source has no workspace manifest");
  const directories = new Set(["scripts", ".github/workflows", ".agents"]);
  const visit = (name: string) => {
    const entry = manifests.get(name);
    if (!entry) throw new Error(`Missing workspace dependency: ${name}`);
    if (directories.has(entry.directory)) return;
    directories.add(entry.directory);
    for (const dependency of entry.dependencies) visit(dependency);
  };
  visit(initial[0]);
  await runForkCommand("git", ["sparse-checkout", "init", "--cone"], source);
  await runForkCommand(
    "git",
    ["sparse-checkout", "set", ...directories],
    source,
  );
  if (
    paths.some(
      (item) =>
        /(?:^|\/)\.env$/.test(item) &&
        [...directories].some((directory) => item.startsWith(`${directory}/`)),
    )
  )
    throw new Error("App source unexpectedly contains a tracked .env file");
}

export async function sourceSize(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await sourceSize(filename);
    else if (entry.isFile()) bytes += (await fs.stat(filename)).size;
  }
  return bytes;
}

export async function verifyClientAssets(directory: string): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyClientAssets(filename);
    else if (/\.(?:js|html)$/.test(entry.name)) {
      const text = await fs.readFile(filename, "utf8");
      const forbiddenEnv = [
        ...text.matchAll(/process\.env\.([A-Za-z0-9_]+)/g),
      ].some(
        (match) => match[1] !== "NODE_ENV" && !match[1]?.startsWith("VITE_"),
      );
      if (
        forbiddenEnv ||
        /(?:from\s*|(?:import|require)\s*\()["'](?:pg|postgres|node:fs|node:child_process|drizzle-orm\/node-postgres)["']/.test(
          text,
        )
      )
        throw new Error(
          `Client build contains server-only code: ${entry.name}`,
        );
    }
  }
}
