import { beforeAll, describe, expect, it } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  SURFACES,
  loadAppCatalogs,
  type AppCatalog,
  type SurfaceCatalog,
} from "./advertised-catalog.harness.js";
import { LEGACY_UNREVIEWED } from "./legacy-unreviewed-destructive-hint.fixture.js";

const FIXTURE =
  "packages/core/src/mcp/legacy-unreviewed-destructive-hint.fixture.ts";

// `ask-agent` is added by the server itself with explicit annotations, not by
// an action, so there is no action to declare on.
const SERVER_DECIDED_TOOLS = new Set(["ask-agent"]);

// Declared `mcpAnnotations` that the default and full catalogs do not
// advertise yet, because on main only the directory catalog reads them. They
// are advertised as declared once #6836 ("declared mcpAnnotations win on every
// catalog") lands; that flips the it.fails below, which is the cue to delete
// this list and the marker. Keys are "<app>/<tool>".
const DECLARATION_NOT_ADVERTISED_UNTIL_6836 = new Set([
  "content/add-database-item",
  "content/edit-document",
  "content/update-database-item",
  "design/edit-design",
  "design/generate-design",
  "design/get-design-system",
  "design/present-design-variants",
  "slides/create-deck",
  "slides/get-design-system",
  "slides/patch-deck",
  "slides/update-slide",
]);

// The same for framework tools, which every app that registers them shares, so
// they are listed by name instead of once per app.
const FRAMEWORK_DECLARATION_NOT_ADVERTISED_UNTIL_6836 = new Set([
  "bash",
  "edit",
  "write",
]);

let apps: AppCatalog[] = [];

beforeAll(async () => {
  apps = await loadAppCatalogs();
}, LOAD_TIMEOUT_MS);

type Hint = "readOnlyHint" | "destructiveHint" | "openWorldHint";
const HINTS: readonly Hint[] = [
  "readOnlyHint",
  "destructiveHint",
  "openWorldHint",
];

// Every (tool, catalog) pair an app advertises, over every deployment surface
// and both catalog modes. Files a dev server wraps as tools are left out (see
// AppCatalog.devDiscoveredTools).
function advertisements(app: AppCatalog) {
  return app.surfaces.flatMap((surface: SurfaceCatalog) =>
    (["default", "full"] as const).flatMap((mode) =>
      surface.catalogs[mode]
        .filter(
          (tool) =>
            !(surface.surface.dev && app.devDiscoveredTools.has(tool.name)),
        )
        .map((tool) => ({
          tool,
          entry: surface.entries[tool.name],
        })),
    ),
  );
}

// A tool is mutating when any catalog advertises it as not read-only.
function mutatingToolNames(app: AppCatalog): string[] {
  return [
    ...new Set(
      advertisements(app)
        .filter(({ tool }) => tool.annotations.readOnlyHint !== true)
        .map(({ tool }) => tool.name),
    ),
  ].filter((name) => !SERVER_DECIDED_TOOLS.has(name));
}

function declaresDestructiveHint(app: AppCatalog, name: string): boolean {
  return advertisements(app)
    .filter(({ tool }) => tool.name === name)
    .every(
      ({ entry }) =>
        typeof entry?.mcpAnnotations?.destructiveHint === "boolean",
    );
}

// Legacy entries are keyed by whose action the tool is: the template's own
// actions under the app, everything the framework composes under "core".
function sectionFor(app: AppCatalog, name: string): string {
  return app.templateActionNames.has(name) ? app.appId : "core";
}

function undeclaredMutatingTools(app: AppCatalog): string[] {
  return mutatingToolNames(app).filter(
    (name) => !declaresDestructiveHint(app, name),
  );
}

// "<app>/<tool>" for every tool whose advertised hints differ from its
// declaration, with whether the framework declares it for all apps.
function declaredMismatches(): Array<{ key: string; frameworkName?: string }> {
  const mismatches = new Map<string, { key: string; frameworkName?: string }>();
  for (const app of apps) {
    for (const { tool, entry } of advertisements(app)) {
      const declared = entry?.mcpAnnotations;
      if (
        declared &&
        HINTS.some((hint) => declared[hint] !== tool.annotations[hint])
      ) {
        const key = `${app.appId}/${tool.name}`;
        mismatches.set(key, {
          key,
          ...(app.templateActionNames.has(tool.name)
            ? {}
            : { frameworkName: tool.name }),
        });
      }
    }
  }
  return [...mismatches.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function isPendingUntil6836({
  key,
  frameworkName,
}: {
  key: string;
  frameworkName?: string;
}): boolean {
  return (
    DECLARATION_NOT_ADVERTISED_UNTIL_6836.has(key) ||
    (frameworkName !== undefined &&
      FRAMEWORK_DECLARATION_NOT_ADVERTISED_UNTIL_6836.has(frameworkName))
  );
}

describe("MCP destructiveHint contract over each app's real catalog", () => {
  it("builds a catalog that includes the framework tools for every app", () => {
    expect(apps.map((app) => app.appId)).toEqual(
      expect.arrayContaining([
        "content",
        "design",
        "forms",
        "mail",
        "plan",
        "slides",
      ]),
    );
    for (const app of apps) {
      const [production] = app.surfaces;
      expect(
        production!.catalogs.full.map((tool) => tool.name),
        `${app.appId}: framework tools are missing from the full catalog`,
      ).toContain("manage-automations");
      expect(
        production!.catalogs.default.map((tool) => tool.name),
        `${app.appId}: tool-search is missing from the default catalog`,
      ).toContain("tool-search");
      expect(app.surfaces.map(({ surface }) => surface)).toEqual(SURFACES);
    }
  });

  it("covers the code-execution tools that only some deployments register", () => {
    const fullTools = (app: AppCatalog, index: number) =>
      app.surfaces[index]!.catalogs.full.map((tool) => tool.name);
    const [off, sandboxed, trusted, dev] = [0, 1, 2, 3];
    const codingTools = ["bash", "edit", "write"];
    for (const app of apps.filter((candidate) => !candidate.ownMcpMount)) {
      const label = (index: number) =>
        `${app.appId}: ${app.surfaces[index]!.surface.name}`;
      expect(fullTools(app, off), label(off)).not.toContain("run-code");
      for (const index of [sandboxed, trusted, dev]) {
        expect(fullTools(app, index), label(index)).toContain("run-code");
      }
      for (const index of [off, sandboxed]) {
        expect(fullTools(app, index), label(index)).not.toContain("bash");
      }
      for (const index of [trusted, dev]) {
        expect(fullTools(app, index), label(index)).toEqual(
          expect.arrayContaining(codingTools),
        );
      }
    }
  });

  it("has a legacy section for every app, plus core, and nothing else", () => {
    expect(Object.keys(LEGACY_UNREVIEWED).sort()).toEqual(
      [...apps.map((app) => app.appId), "core"].sort(),
    );
  });

  it("requires every mutating tool outside the legacy baseline to declare destructiveHint", () => {
    const undeclared = apps.flatMap((app) =>
      undeclaredMutatingTools(app)
        .filter(
          (name) => !LEGACY_UNREVIEWED[sectionFor(app, name)]?.includes(name),
        )
        .map((name) => `${app.appId}/${name}`),
    );
    expect(
      undeclared,
      "These MCP tools can change data but declare no destructiveHint. Add `mcpAnnotations: { readOnlyHint, destructiveHint, openWorldHint }` " +
        "to the action (destructiveHint is true when it deletes, overwrites, or replaces user content, recoverable Trash included). " +
        `Do not add them to ${FIXTURE}: that baseline is frozen and may only shrink (guard:no-new-legacy-mcp-hints rejects added ids). ` +
        "Hosts use the hint to decide when to ask the user first.",
    ).toEqual([]);
  });

  it("keeps the legacy baseline limited to tools that are still undeclared", () => {
    const undeclared = new Set<string>();
    for (const app of apps) {
      for (const name of undeclaredMutatingTools(app)) {
        undeclared.add(`${sectionFor(app, name)}/${name}`);
      }
    }
    const stale = Object.entries(LEGACY_UNREVIEWED).flatMap(
      ([section, names]) =>
        names
          .filter((name) => !undeclared.has(`${section}/${name}`))
          .map((name) => `${section}/${name}`),
    );
    expect(
      stale,
      `These ${FIXTURE} entries name a tool that was removed, is read-only, is not advertised, or now declares mcpAnnotations. Delete them.`,
    ).toEqual([]);
  });

  it("lists each legacy tool once", () => {
    const names = Object.entries(LEGACY_UNREVIEWED).flatMap(
      ([section, sectionNames]) =>
        sectionNames.map((name) => `${section}/${name}`),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("advertises the declared hints wherever the derived hints already agree", () => {
    expect(
      declaredMismatches()
        .filter((mismatch) => !isPendingUntil6836(mismatch))
        .map(({ key }) => key),
      "A catalog advertises hints that differ from the action's declared mcpAnnotations.",
    ).toEqual([]);
  });

  // On main the default and full catalogs derive their hints and ignore the
  // declaration, so this fails. Once #6836 lands it passes: remove `.fails`
  // and both DECLARATION_NOT_ADVERTISED_UNTIL_6836 sets together.
  it.fails("advertises the declared hints on every declared tool (#6836)", () => {
    expect(declaredMismatches().map(({ key }) => key)).toEqual([]);
  });

  it("keeps the pending-#6836 lists limited to declarations that still mismatch", () => {
    const mismatches = declaredMismatches();
    const mismatchingKeys = new Set(mismatches.map(({ key }) => key));
    const mismatchingFramework = new Set(
      mismatches.flatMap(({ frameworkName }) =>
        frameworkName ? [frameworkName] : [],
      ),
    );
    expect(
      [
        ...[...DECLARATION_NOT_ADVERTISED_UNTIL_6836].filter(
          (key) => !mismatchingKeys.has(key),
        ),
        ...[...FRAMEWORK_DECLARATION_NOT_ADVERTISED_UNTIL_6836].filter(
          (name) => !mismatchingFramework.has(name),
        ),
      ],
      "These now advertise their declaration: remove them from the DECLARATION_NOT_ADVERTISED_UNTIL_6836 lists.",
    ).toEqual([]);
  });
});
