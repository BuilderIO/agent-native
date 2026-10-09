import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_E2E_PREFIX = "templates/design/e2e/";

function isRunnableSpec(specPath) {
  try {
    const stats = statSync(specPath);
    if (!stats.isFile()) {
      throw new Error(`Changed Design E2E path is not a file: ${specPath}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

export function resolveDesignE2ESpecs(
  rawSelector,
  { isFile = isRunnableSpec } = {},
) {
  let paths;
  try {
    paths = JSON.parse(rawSelector);
  } catch {
    throw new Error("Expected valid JSON for the changed Design E2E selector");
  }

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("Expected a non-empty changed Design E2E spec selector");
  }

  const existingSpecs = [];
  const removedSpecs = [];
  for (const candidate of paths) {
    if (
      typeof candidate !== "string" ||
      !candidate.startsWith(DESIGN_E2E_PREFIX) ||
      candidate.includes("\\") ||
      path.posix.normalize(candidate) !== candidate ||
      !candidate.endsWith(".spec.ts")
    ) {
      throw new Error("Invalid changed Design E2E spec path");
    }

    const specPath = candidate.slice("templates/design/".length);
    if (isFile(specPath)) existingSpecs.push(specPath);
    else removedSpecs.push(specPath);
  }

  return { existingSpecs, removedSpecs };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { existingSpecs, removedSpecs } = resolveDesignE2ESpecs(
      process.env.DESIGN_CANVAS_E2E_SPECS,
    );
    for (const spec of removedSpecs) {
      console.error(
        `::warning::Removed Design E2E spec is no longer runnable: ${spec}`,
      );
    }
    process.stdout.write(existingSpecs.map((spec) => `${spec}\0`).join(""));
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : "Could not resolve changed Design E2E selector"}`,
    );
    process.exitCode = 2;
  }
}
