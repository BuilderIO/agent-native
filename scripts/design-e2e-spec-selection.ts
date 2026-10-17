import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_E2E_PREFIX = "templates/design/e2e/";
const LONG_MUSIC_APP_SPEC = "e2e/interaction-responsive-music-app.spec.ts";
const LONG_LANDING_PAGE_SPEC = "e2e/interaction-landing-page-build.spec.ts";
const LOOPBACK_ONLY_DESIGN_SPECS = new Set([
  "e2e/home-system-selection.spec.ts",
]);
const LONG_LANDING_PAGE_TEST_TITLES = [
  "Shift+A wraps four selected nav links into a horizontal auto-layout frame inside Navbar without moving them",
  "Cmd+G groups two layers selected in the Layers panel and one Cmd+Z restores the ungrouped document",
  "Cmd+D on a screen creates an independent sibling screen: deleting a layer in the copy leaves the original untouched",
] as const;
const LONG_MUSIC_APP_TEST_TITLES = [
  "a drawn empty Frame refreshes its inspector after auto layout",
  "sizing mode actions survive the selected layer route update",
] as const;

type IsFile = (specPath: string) => boolean;
type ReadFile = (specPath: string) => string;

type ResolvedDesignE2ESpecs = {
  existingSpecs: string[];
  removedSpecs: string[];
  filteredSpecs: string[];
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

function declaresTestTitles(
  source: string,
  titles: readonly string[],
): string[] {
  return titles.filter((title) => {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const quotedTitle = `(?:"${escapedTitle}"|'${escapedTitle}'|\`${escapedTitle}\`)`;
    return new RegExp(`\\btest\\s*\\(\\s*${quotedTitle}\\s*,`, "u").test(
      source,
    );
  });
}

function declaresLongMusicAppTests(source: string): string[] {
  return declaresTestTitles(source, LONG_MUSIC_APP_TEST_TITLES);
}

function declaresLongLandingPageTests(source: string): string[] {
  return declaresTestTitles(source, LONG_LANDING_PAGE_TEST_TITLES);
}

export function resolveDesignE2ESpecs(
  rawSelector: string | undefined,
  {
    isFile = isRunnableSpec,
    readFile = (specPath) => readFileSync(specPath, "utf8"),
    includeLoopbackOnlySpecs = process.env.E2E_AI_SIDEBAR_LOOPBACK === "1",
    includeLandingPageWorkflowSpec = process.env
      .DESIGN_CANVAS_LANDING_PAGE_WORKFLOW === "1",
  }: {
    isFile?: IsFile;
    readFile?: ReadFile;
    includeLoopbackOnlySpecs?: boolean;
    includeLandingPageWorkflowSpec?: boolean;
  } = {},
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
  const filteredSpecs: string[] = [];
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
      if (specPath === LONG_LANDING_PAGE_SPEC) {
        throw new Error(
          "The selected landing-page workflow spec is missing: " +
            LONG_LANDING_PAGE_SPEC,
        );
      }
      removedSpecs.push(specPath);
      continue;
    }
    const landingPageTests = declaresLongLandingPageTests(readFile(specPath));
    if (landingPageTests.length > 0 && specPath !== LONG_LANDING_PAGE_SPEC) {
      throw new Error(
        "The long landing-page workflow tests must remain in " +
          LONG_LANDING_PAGE_SPEC,
      );
    }
    if (
      specPath === LONG_LANDING_PAGE_SPEC &&
      landingPageTests.length !== LONG_LANDING_PAGE_TEST_TITLES.length
    ) {
      const missingTests = LONG_LANDING_PAGE_TEST_TITLES.filter(
        (title) => !landingPageTests.includes(title),
      );
      throw new Error(
        "The long landing-page workflow tests are missing from " +
          LONG_LANDING_PAGE_SPEC +
          ": " +
          missingTests.join(", "),
      );
    }
    if (
      specPath === LONG_LANDING_PAGE_SPEC &&
      !includeLandingPageWorkflowSpec
    ) {
      filteredSpecs.push(specPath);
      continue;
    }
    if (LOOPBACK_ONLY_DESIGN_SPECS.has(specPath) && !includeLoopbackOnlySpecs) {
      filteredSpecs.push(specPath);
      continue;
    }

    const longMusicAppTests = declaresLongMusicAppTests(readFile(specPath));
    if (longMusicAppTests.length > 0 && specPath !== LONG_MUSIC_APP_SPEC) {
      throw new Error(
        `The long music-app workflow test must remain in ${LONG_MUSIC_APP_SPEC}`,
      );
    }
    if (
      specPath === LONG_MUSIC_APP_SPEC &&
      longMusicAppTests.length !== LONG_MUSIC_APP_TEST_TITLES.length
    ) {
      const missingTests = LONG_MUSIC_APP_TEST_TITLES.filter(
        (title) => !longMusicAppTests.includes(title),
      );
      throw new Error(
        `The long music-app workflow tests are missing from ${LONG_MUSIC_APP_SPEC}: ${missingTests.join(", ")}`,
      );
    }

    existingSpecs.push(specPath);
  }

  return { existingSpecs, removedSpecs, filteredSpecs };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { existingSpecs, removedSpecs, filteredSpecs } =
      resolveDesignE2ESpecs(process.env.DESIGN_CANVAS_E2E_SPECS);
    for (const spec of removedSpecs) {
      console.error(
        `::warning::Removed Design E2E spec is no longer runnable: ${spec}`,
      );
    }
    for (const spec of filteredSpecs) {
      console.error(
        `::notice::Design E2E spec is handled by its dedicated workflow lane and omitted from generic shards: ${spec}`,
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
