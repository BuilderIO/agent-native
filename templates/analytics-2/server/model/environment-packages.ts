import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { collectBrowserNotebookPackages } from "../../shared/notebook-browser-packages.js";

export const environmentReportSchema = z.strictObject({
  runtime: z.string().min(1).max(80),
  runtimeVersion: z.string().min(1).max(80).nullable(),
  packages: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        version: z.string().min(1).max(200),
      }),
    )
    .max(512),
});

export type EnvironmentReport = z.infer<typeof environmentReportSchema>;

const LOCK_FILE = "runtime/pyodide/pyodide-lock.json";

/**
 * The lock file sits in `server/assets/formatter` in source, and the app build
 * copies the formatter assets beside the deployable server entry
 * (`formatter-assets/`, see server/formatter/copy-assets-to-build.ts). A bundled
 * server has no `server/` directory left, so the source-relative path alone
 * answers 500 in the deployed function: every candidate is tried and a missing
 * one is a named error, never an empty package list.
 */
export function resolveLockPath(
  moduleUrl: string,
  workingDirectory: string | undefined = typeof process === "undefined"
    ? undefined
    : process.cwd(),
): URL {
  const candidates = lockCandidates(moduleUrl, workingDirectory);
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  // The deployed server is one bundled entry file, and the preset decides where
  // the formatter assets sit next to it, so a fixed list of relative paths is
  // not enough (row 432: the Environment panel answered 500 on Labs while the
  // package lock was present in the build). Naming the module URL and every
  // path tried makes the next failure diagnosable from the action's message
  // instead of a bare 500.
  throw new Error(
    `The Python runtime's package lock is missing (${LOCK_FILE}); from ${fileURLToPath(
      new URL(".", moduleUrl),
    )} looked in ${candidates.map((candidate) => fileURLToPath(candidate)).join(", ")}.`,
  );
}

/**
 * Every place the lock can legitimately sit, in try order: beside the module
 * (a bundled entry), one and two levels up (a chunk directory), the source
 * tree, and the process working directory for a preset that keeps assets there.
 */
export function lockCandidates(
  moduleUrl: string,
  workingDirectory?: string | undefined,
): URL[] {
  const candidates: URL[] = [
    new URL(`../assets/formatter/${LOCK_FILE}`, moduleUrl),
    new URL(`./formatter-assets/${LOCK_FILE}`, moduleUrl),
    new URL(`../formatter-assets/${LOCK_FILE}`, moduleUrl),
    new URL(`../../formatter-assets/${LOCK_FILE}`, moduleUrl),
    new URL(`../../../formatter-assets/${LOCK_FILE}`, moduleUrl),
  ];
  const directories = [workingDirectory, moduleUrl].filter(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "",
  );
  for (const directory of directories) {
    candidates.push(
      new URL(
        `formatter-assets/${LOCK_FILE}`,
        directory.startsWith("file:") ? directory : `file://${directory}/`,
      ),
    );
  }
  return candidates;
}

const lockSchema = z.object({
  info: z.object({
    version: z.string().optional(),
    python: z.string().optional(),
  }),
  packages: z.record(
    z.string(),
    z.object({
      version: z.string().min(1),
      depends: z.array(z.string()),
    }),
  ),
});

export async function listEnvironmentPackages(
  readFileImpl: (path: URL) => Promise<string> = (path) =>
    readFile(path, "utf8"),
  lockPath: URL = resolveLockPath(import.meta.url),
): Promise<EnvironmentReport> {
  const raw = await readFileImpl(lockPath);
  const lock = lockSchema.parse(JSON.parse(raw));
  const packages = Array.from(
    collectBrowserNotebookPackages(lock.packages),
    ([name, { version }]) => ({ name, version }),
  ).sort((a, b) => a.name.localeCompare(b.name));
  return {
    runtime: "Pyodide",
    // The lock names its Python build, not a Pyodide release; reporting the
    // Python version is the part a reader can check against the panel's list.
    runtimeVersion: lock.info.version ?? lock.info.python ?? null,
    packages,
  };
}
