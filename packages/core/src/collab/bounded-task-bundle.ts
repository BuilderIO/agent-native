import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDED_TASK_GLOBAL,
  type BoundedTaskSource,
} from "./bounded-tasks.js";

export interface BundleBoundedTaskSourceOptions {
  /** Shown in errors and runner names. Defaults to the entry file's name. */
  name?: string;
  /** Extra esbuild `conditions` for package resolution. */
  conditions?: string[];
}

export interface BundledBoundedTaskSource extends BoundedTaskSource {
  /** Every file esbuild read, for watch-mode rebuilds. */
  readonly inputs: readonly string[];
}

/**
 * Bundles a task module and everything it imports into one script a worker
 * can evaluate. The module must export `tasks`: an object of functions that
 * take plain data and return plain data (or a Promise of it).
 */
export async function bundleBoundedTaskSource(
  entry: string | URL,
  options: BundleBoundedTaskSourceOptions = {},
): Promise<BundledBoundedTaskSource> {
  const entryPath =
    entry instanceof URL || entry.startsWith("file:")
      ? fileURLToPath(entry)
      : path.resolve(entry);
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "iife",
    globalName: BOUNDED_TASK_GLOBAL,
    platform: "node",
    target: "node20",
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    ...(options.conditions ? { conditions: options.conditions } : {}),
  });
  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error(`esbuild produced no output for bounded task ${entryPath}`);
  }
  const cwd = process.cwd();
  return {
    kind: "bounded-task-source",
    name: options.name ?? path.basename(entryPath).replace(/\.[^.]+$/, ""),
    code: output.text,
    inputs: Object.keys(result.metafile?.inputs ?? {}).map((input) =>
      path.resolve(cwd, input),
    ),
  };
}
