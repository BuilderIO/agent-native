import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_E2E_PREFIX = "templates/design/e2e/";
const LONG_MUSIC_APP_SPEC = "e2e/interaction-responsive-music-app.spec.ts";
const LONG_MUSIC_APP_TEST_TITLE =
  "create a responsive music-app desktop shell under a Screen root";

type IsFile = (specPath: string) => boolean;
type ReadFile = (specPath: string) => string;

type ResolvedDesignE2ESpecs = {
  existingSpecs: string[];
  removedSpecs: string[];
};

function isRunnableSpec(specPath: string): boolean {
  try {
    const stats = statSync(specPath);
    if (!stats.isFile()) {
      throw new Error(`Changed Design E2E path is not a file: ${specPath}`);
    }
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
}

function declaresLongMusicAppTest(source: string): boolean {
  const escapedTitle = LONG_MUSIC_APP_TEST_TITLE.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  const quotedTitle = `(?:"${escapedTitle}"|'${escapedTitle}'|\`${escapedTitle}\`)`;
  return new RegExp(`\\btest\\s*\\(\\s*${quotedTitle}\\s*,`, "u").test(source);
}

export function resolveDesignE2ESpecs(
  rawSelector: string | undefined,
  {
    isFile = isRunnableSpec,
    readFile = (specPath) => readFileSync(specPath, "utf8"),
  }: { isFile?: IsFile; readFile?: ReadFile } = {},
): ResolvedDesignE2ESpecs {
  let paths;
  try {
    paths = JSON.parse(rawSelector);
  } catch {
    throw new Error("Expected valid JSON for the changed Design E2E selector");
  }

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("Expected a non-empty changed Design E2E spec selector");
  }

  const existingSpecs: string[] = [];
  const removedSpecs: string[] = [];
  for (const candidate of paths) {
    if (
      typeof candidate !== "string" ||
      !candidate.startsWith(DESIGN_E2E_PREFIX) ||
      candidate.includes("\\") ||
      path.posix.normalize(candidate) !== candidate ||
      !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(candidate)
    ) {
      throw new Error("Invalid changed Design E2E spec path");
    }

    const specPath = candidate.slice("templates/design/".length);
    if (!isFile(specPath)) {
      if (specPath === LONG_MUSIC_APP_SPEC) {
        throw new Error(
          `The selected long music-app workflow spec is missing: ${LONG_MUSIC_APP_SPEC}`,
        );
      }
      removedSpecs.push(specPath);
      continue;
    }

    const declaresLongMusicApp = declaresLongMusicAppTest(readFile(specPath));
    if (declaresLongMusicApp && specPath !== LONG_MUSIC_APP_SPEC) {
      throw new Error(
        `The long music-app workflow test must remain in ${LONG_MUSIC_APP_SPEC}`,
      );
    }
    if (specPath === LONG_MUSIC_APP_SPEC && !declaresLongMusicApp) {
      throw new Error(
        `The long music-app workflow test is missing from ${LONG_MUSIC_APP_SPEC}`,
      );
    }

    existingSpecs.push(specPath);
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
  } catch (error: unknown) {
    console.error(
      `::error::${error instanceof Error ? error.message : "Could not resolve changed Design E2E selector"}`,
    );
    process.exitCode = 2;
  }
}
