import { beforeAll, describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
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
// and both catalog modes, including files a dev server wraps as tools.
function advertisements(app: AppCatalog) {
  return app.surfaces.flatMap((surface: SurfaceCatalog) =>
    (["default", "full"] as const).flatMap((mode) =>
      surface.catalogs[mode].map((tool) => ({
        tool,
        surface: surface.surface,
        entry: surface.entries[tool.name],
      })),
    ),
  );
}

function isReadOnlyAction(entry: { readOnly?: boolean } | undefined): boolean {
  return entry?.readOnly === true;
}

// A tool is mutating when its action metadata says it is not read-only. The
// advertised MCP hint is validated separately so it cannot classify itself.
function mutatingToolNames(app: AppCatalog): string[] {
  return [
    ...new Set(
      advertisements(app)
        .filter(({ entry, tool }) =>
          entry === undefined
            ? tool.annotations.readOnlyHint !== true
            : !isReadOnlyAction(entry),
        )
        .map(({ tool }) => tool.name),
    ),
  ].filter((name) => !SERVER_DECIDED_TOOLS.has(name));
}

function declaresDestructiveHint(app: AppCatalog, name: string): boolean {
  return advertisements(app)
    .filter(({ tool }) => tool.name === name)
    .every(({ entry, tool }) => {
      const destructiveHint = entry
        ? entry.mcpAnnotations?.destructiveHint
        : tool.annotations.destructiveHint;
      return typeof destructiveHint === "boolean";
    });
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

function readOnlyMismatches(app: AppCatalog): string[] {
  return advertisements(app)
    .filter(
      ({ tool, entry }) =>
        entry !== undefined &&
        tool.annotations.readOnlyHint !== isReadOnlyAction(entry),
    )
    .map(({ surface, tool }) => `${surface.name}/${tool.name}`)
    .sort();
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

  it("checks dev-discovered actions against their loaded action entries", () => {
    const missing = apps.flatMap((app) =>
      [...app.devDiscoveredTools].flatMap((name) => {
        const discovered = advertisements(app).filter(
          ({ surface, tool }) => surface.dev && tool.name === name,
        );
        return discovered.length === 0 ||
          discovered.some(
            ({ entry }) =>
              entry === undefined ||
              HINTS.some(
                (hint) => typeof entry.mcpAnnotations?.[hint] !== "boolean",
              ),
          )
          ? [`${app.appId}/${name}`]
          : [];
      }),
    );
    expect(missing).toEqual([]);
  });

  it("classifies mutating actions from metadata independent of MCP hints", () => {
    const app: AppCatalog = {
      appId: "annotation-regression",
      templateActionNames: new Set(["mutating-action"]),
      ownMcpMount: false,
      devDiscoveredTools: new Set(),
      surfaces: [
        {
          surface: {
            name: "production",
            dev: false,
            codeExecution: "off",
            fullSurface: false,
          },
          catalogs: {
            default: [
              {
                name: "mutating-action",
                annotations: {
                  readOnlyHint: true,
                  destructiveHint: false,
                  openWorldHint: false,
                },
              },
            ],
            full: [],
          },
          entries: {
            "mutating-action": {
              tool: {
                description: "Mutate a record",
                parameters: { type: "object", properties: {} },
              },
              run: async () => undefined,
              readOnly: false,
              mcpAnnotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: false,
              },
            } satisfies ActionEntry,
          },
        },
      ],
      instructions: "",
    };

    expect(mutatingToolNames(app)).toEqual(["mutating-action"]);
    expect(readOnlyMismatches(app)).toEqual(["production/mutating-action"]);
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

  it("advertises the declared hints on every declared tool", () => {
    expect(
      declaredMismatches().map(({ key }) => key),
      "A catalog advertises hints that differ from the action's declared mcpAnnotations.",
    ).toEqual([]);
  });

  it("keeps the advertised read-only hint aligned with independent action metadata", () => {
    const mismatches = apps.flatMap((app) =>
      readOnlyMismatches(app).map((name) => `${app.appId}/${name}`),
    );
    expect(mismatches).toEqual([]);
  });
});
