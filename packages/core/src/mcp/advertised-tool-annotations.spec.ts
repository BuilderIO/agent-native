import { beforeAll, describe, expect, it } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  loadAppCatalogs,
  type AdvertisedTool,
  type AppCatalog,
} from "./advertised-catalog.harness.js";
import {
  LEGACY_UNREVIEWED,
  LEGACY_UNREVIEWED_COUNT,
} from "./legacy-unreviewed-destructive-hint.fixture.js";

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

let apps: AppCatalog[] = [];

beforeAll(async () => {
  apps = await loadAppCatalogs();
}, LOAD_TIMEOUT_MS);

function advertisedIn(app: AppCatalog): Map<string, AdvertisedTool[]> {
  const byName = new Map<string, AdvertisedTool[]>();
  for (const tool of [...app.catalogs.default, ...app.catalogs.full]) {
    byName.set(tool.name, [...(byName.get(tool.name) ?? []), tool]);
  }
  return byName;
}

// A tool is mutating when any catalog advertises it as not read-only.
function mutatingToolNames(app: AppCatalog): string[] {
  return [...advertisedIn(app)]
    .filter(([, tools]) =>
      tools.some((tool) => tool.annotations.readOnlyHint !== true),
    )
    .map(([name]) => name)
    .filter((name) => !SERVER_DECIDED_TOOLS.has(name));
}

function declaresDestructiveHint(app: AppCatalog, name: string): boolean {
  return (
    typeof app.entries[name]?.mcpAnnotations?.destructiveHint === "boolean"
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

function declaredMismatches(): string[] {
  const mismatches: string[] = [];
  for (const app of apps) {
    for (const [name, tools] of advertisedIn(app)) {
      const declared = app.entries[name]?.mcpAnnotations;
      if (!declared) continue;
      const differs = tools.some((tool) =>
        (["readOnlyHint", "destructiveHint", "openWorldHint"] as const).some(
          (hint) => declared[hint] !== tool.annotations[hint],
        ),
      );
      if (differs) mismatches.push(`${app.appId}/${name}`);
    }
  }
  return mismatches;
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
      expect(
        app.catalogs.full.map((tool) => tool.name),
        `${app.appId}: framework tools are missing from the full catalog`,
      ).toContain("manage-automations");
      expect(
        app.catalogs.default.map((tool) => tool.name),
        `${app.appId}: tool-search is missing from the default catalog`,
      ).toContain("tool-search");
      expect(app.catalogs.full.length).toBeGreaterThan(
        app.catalogs.default.length,
      );
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
        `Do not add them to ${FIXTURE}: that baseline is frozen and may only shrink. Hosts use the hint to decide when to ask the user first.`,
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
      `These ${FIXTURE} entries name a tool that was removed, is read-only, is not advertised, or now declares mcpAnnotations. Delete them and lower LEGACY_UNREVIEWED_COUNT.`,
    ).toEqual([]);
  });

  it("freezes the legacy baseline size", () => {
    const names = Object.entries(LEGACY_UNREVIEWED).flatMap(
      ([section, section_names]) =>
        section_names.map((name) => `${section}/${name}`),
    );
    expect(
      new Set(names).size,
      "A tool is listed twice in the legacy baseline.",
    ).toBe(names.length);
    expect(
      names.length,
      names.length > LEGACY_UNREVIEWED_COUNT
        ? `${FIXTURE} grew. Do not add tools to the legacy baseline: declare mcpAnnotations on the new action instead.`
        : `${FIXTURE} shrank. Lower LEGACY_UNREVIEWED_COUNT to ${names.length} so the freed room cannot be reused.`,
    ).toBe(LEGACY_UNREVIEWED_COUNT);
  });

  it("advertises the declared hints wherever the derived hints already agree", () => {
    expect(
      declaredMismatches().filter(
        (key) => !DECLARATION_NOT_ADVERTISED_UNTIL_6836.has(key),
      ),
      "A catalog advertises hints that differ from the action's declared mcpAnnotations.",
    ).toEqual([]);
  });

  // On main the default and full catalogs derive their hints and ignore the
  // declaration, so this fails. Once #6836 lands it passes: remove `.fails`
  // and DECLARATION_NOT_ADVERTISED_UNTIL_6836 together.
  it.fails("advertises the declared hints on every declared tool (#6836)", () => {
    expect(declaredMismatches()).toEqual([]);
  });

  it("keeps the pending-#6836 list limited to declarations that still mismatch", () => {
    const mismatching = new Set(declaredMismatches());
    expect(
      [...DECLARATION_NOT_ADVERTISED_UNTIL_6836].filter(
        (key) => !mismatching.has(key),
      ),
      "These now advertise their declaration: remove them from DECLARATION_NOT_ADVERTISED_UNTIL_6836.",
    ).toEqual([]);
  });
});
