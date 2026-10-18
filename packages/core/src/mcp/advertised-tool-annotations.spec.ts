import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  BASELINE_PATH,
  readLegacyBaseline,
} from "../../../../scripts/guard-no-new-legacy-mcp-hints.js";
import { isMcpReadOnlyTool } from "../action-call-classification.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { filesystemActionEntry } from "../server/filesystem-action-entry.js";
import {
  LOAD_TIMEOUT_MS,
  SURFACES,
  loadAppCatalogs,
  type AppCatalog,
  type SurfaceCatalog,
} from "./advertised-catalog.harness.js";

// The guard and this spec read the baseline through the same function, so the
// list the guard compares with the base branch is the list checked here.
const LEGACY_UNREVIEWED = readLegacyBaseline(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);

// Tools the MCP server provides itself, with no action to declare hints on.
// Each name carries its reviewed hints, asserted exactly below, so listing a
// tool here is declaring its hints rather than exempting it.
const SERVER_DECIDED_TOOLS: Readonly<
  Record<
    string,
    { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }
  >
> = {
  // Hands an instruction to the app's agent, which may write or call out.
  "ask-agent": {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
};

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

// Read-only actions that still write: run-code through its bridge, web-request
// with a non-GET method or saveToFile, and pull-document by saving an open
// editor first. Each stays a write over MCP wherever it is served.
const READ_ONLY_ACTIONS_THAT_WRITE = [
  "run-code",
  "web-request",
  "pull-document",
] as const;

function isReadOnlyAction(entry: ActionEntry | undefined): boolean {
  return entry !== undefined && isMcpReadOnlyTool(entry);
}

// A tool is mutating when any call can write, by the rule the server applies.
// Only a declared `readOnlyHint: false` counts from the hints, so a hint can
// make a tool a write but never a read.
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
  ].filter((name) => !Object.hasOwn(SERVER_DECIDED_TOOLS, name));
}

// Only annotations the action itself declares count as a decision. The server
// fills in hints for every tool it advertises, and dev discovery supplies
// defaults (`mcpAnnotationDefaults`) for files that declare none; neither is a
// review. Tools with no entry are reviewed by name in SERVER_DECIDED_TOOLS.
function declaresDestructiveHint(app: AppCatalog, name: string): boolean {
  return advertisements(app)
    .filter(({ tool }) => tool.name === name)
    .every(
      ({ entry }) =>
        typeof entry?.mcpAnnotations?.destructiveHint === "boolean",
    );
}

// Legacy entries are keyed by whose action the tool is: the template's own
// actions and the files its dev server discovers under the app, everything the
// framework composes under "core".
function sectionFor(app: AppCatalog, name: string): string {
  return app.templateActionNames.has(name) || app.devDiscoveredTools.has(name)
    ? app.appId
    : "core";
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
// declaration.
function declaredMismatches(): string[] {
  const mismatches = new Set<string>();
  for (const app of apps) {
    for (const { tool, entry } of advertisements(app)) {
      const declared = entry?.mcpAnnotations;
      if (
        declared &&
        HINTS.some((hint) => declared[hint] !== tool.annotations[hint])
      ) {
        mismatches.add(`${app.appId}/${tool.name}`);
      }
    }
  }
  return [...mismatches].sort();
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

  it("advertises exactly the reviewed hints of every server-provided tool", () => {
    for (const [name, hints] of Object.entries(SERVER_DECIDED_TOOLS)) {
      const tools = apps.flatMap((app) =>
        advertisements(app).filter(({ tool }) => tool.name === name),
      );

      expect(tools.length, name).toBeGreaterThan(0);
      for (const { tool } of tools) {
        expect(tool.annotations, name).toEqual(hints);
      }
    }
  });

  it("advertises read-only actions that still write as writes", () => {
    for (const name of READ_ONLY_ACTIONS_THAT_WRITE) {
      const served = apps.flatMap((app) =>
        advertisements(app).filter(({ tool }) => tool.name === name),
      );

      expect(served.length, name).toBeGreaterThan(0);
      for (const { tool, entry } of served) {
        expect(entry?.readOnly, name).toBe(true);
        expect(tool.annotations.readOnlyHint, name).toBe(false);
      }
    }
  });

  // A dev server wraps loose files (helpers, one-off CLI scripts) as tools.
  // Without hints of their own they advertise the framework defaults; this pins
  // what those defaults are, end to end. The defaults are not a declaration, so
  // such a tool is also held to the destructiveHint requirement below.
  it("advertises dev-discovered files without their own hints as destructive and open-world", () => {
    const fallbackHints = {
      write: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      read: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    };
    let checked = 0;
    const problems = apps.flatMap((app) =>
      [...app.devDiscoveredTools].flatMap((name) => {
        const discovered = advertisements(app).filter(
          ({ surface, tool }) => surface.dev && tool.name === name,
        );
        if (discovered.length === 0) {
          return [`${app.appId}/${name}: not advertised on the dev surface`];
        }
        return discovered.flatMap(({ entry, tool }) => {
          if (!entry) return [`${app.appId}/${name}: no action entry`];
          // A file's own declaration is checked like any action's.
          if (entry.mcpAnnotations) return [];
          checked++;
          const expected = isReadOnlyAction(entry)
            ? fallbackHints.read
            : fallbackHints.write;
          return HINTS.every(
            (hint) => tool.annotations[hint] === expected[hint],
          )
            ? []
            : [
                `${app.appId}/${name}: advertises ${JSON.stringify(tool.annotations)}`,
              ];
        });
      }),
    );
    expect(problems).toEqual([]);
    expect(
      checked,
      "No dev-discovered tool advertised the defaults, so nothing was checked.",
    ).toBeGreaterThan(0);
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

  it("does not count the defaults a dev server supplies as a declaration", () => {
    const entry = filesystemActionEntry({
      tool: {
        description: "Rewrite a record",
        parameters: { type: "object", properties: {} },
      },
      run: async () => undefined,
    });
    const app: AppCatalog = {
      appId: "annotation-regression",
      templateActionNames: new Set(),
      ownMcpMount: false,
      devDiscoveredTools: new Set(["discovered-write"]),
      surfaces: [
        {
          surface: {
            name: "dev",
            dev: true,
            codeExecution: "off",
            fullSurface: true,
          },
          catalogs: {
            default: [],
            full: [
              {
                name: "discovered-write",
                annotations: {
                  readOnlyHint: false,
                  destructiveHint: true,
                  openWorldHint: true,
                },
              },
            ],
          },
          entries: { "discovered-write": entry },
        },
      ],
      instructions: "",
    };

    expect(entry.mcpAnnotationDefaults?.destructiveHint).toBe(true);
    expect(undeclaredMutatingTools(app)).toEqual(["discovered-write"]);
    expect(sectionFor(app, "discovered-write")).toBe("annotation-regression");
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
        "A file the dev server wraps as a tool only because it is not a loadable action cannot declare hints: make it a defineAction, or prefix it with _ to keep it out of discovery. " +
        `Do not add them to ${BASELINE_PATH}: that baseline is frozen and may only shrink (guard:no-new-legacy-mcp-hints rejects added ids). ` +
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
      `These ${BASELINE_PATH} entries name a tool that was removed, is read-only, is not advertised, or now declares mcpAnnotations. Delete them.`,
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
      declaredMismatches(),
      "A catalog advertises hints that differ from the action's declared mcpAnnotations.",
    ).toEqual([]);
  });

  it("keeps the advertised read-only hint aligned with action metadata", () => {
    const mismatches = apps.flatMap((app) =>
      readOnlyMismatches(app).map((name) => `${app.appId}/${name}`),
    );
    expect(mismatches).toEqual([]);
  });
});
