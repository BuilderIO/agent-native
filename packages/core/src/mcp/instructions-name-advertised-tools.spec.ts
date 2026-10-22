import { beforeAll, describe, expect, it } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  defaultProductionTools,
  loadAppCatalogs,
  type AppCatalog,
} from "./advertised-catalog.harness.js";

// Every token in static instructions that could be a tool name: anything in
// backticks, plus hyphenated or underscored words. Nothing is excluded by
// guessing what a word means; prose that is not a tool is listed explicitly in
// NOT_TOOL_NAMES.
const BACKTICKED = /`([^`]+)`/g;
const COMPOUND_WORD =
  /(?<![\w-])[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+(?![\w-])/g;

function toolReferences(text: string): Set<string> {
  const references = new Set<string>();
  for (const [, token] of text.matchAll(BACKTICKED)) {
    references.add(token!.trim());
  }
  for (const [word] of text.replace(BACKTICKED, " ").matchAll(COMPOUND_WORD)) {
    references.add(word);
  }
  return references;
}

interface ReferenceRules {
  advertised: ReadonlySet<string>;
  notToolNames: Readonly<Record<string, string>>;
  advertisedOnlyConditionally: Readonly<Record<string, string>>;
}

function unadvertisedReferences(
  text: string,
  { advertised, notToolNames, advertisedOnlyConditionally }: ReferenceRules,
): string[] {
  // Own keys only: `in` would also accept inherited names such as
  // `constructor` or `toString` as classified.
  return [...toolReferences(text)].filter(
    (reference) =>
      !advertised.has(reference) &&
      !Object.hasOwn(notToolNames, reference) &&
      !Object.hasOwn(advertisedOnlyConditionally, reference),
  );
}

const prose = (reason: string, ...tokens: string[]) =>
  Object.fromEntries(tokens.map((token) => [token, reason]));

// Words that look like tool names but are not. "*" applies to every app.
// An entry must still appear in that app's instructions, so it cannot outlive
// the text that needed it.
const NOT_TOOL_NAMES: Record<string, Record<string, string>> = {
  "*": prose(
    "hyphenated prose in the shared instructions",
    "Agent-Native",
    "page-local",
    "state-dependent",
    "full-document",
    "built-in",
    "in-app",
    "App-specific",
  ),
  analytics: prose(
    "hyphenated prose",
    "owner-defined",
    "cross-checks",
    "window-bounded",
    "later-activity",
    "right-censoring",
  ),
  content: prose("hyphenated prose", "revision-guarded", "sub-pages"),
  design: {
    ...prose(
      "hyphenated prose",
      "new-design",
      "Hand-off",
      "URL-backed",
      "visual-edit",
      "browser-capable",
    ),
    ...prose(
      "a field of the design system result, not a tool",
      "designSystem",
      "next",
    ),
  },
  slides: {
    ...prose(
      "hyphenated prose",
      "Latest-message",
      "re-read",
      "re-reading",
      "Cross-slide",
      "design-system",
      "content-only",
      "slide-level",
      "deck-wide",
      "multi-slide",
      "per-slide",
    ),
    ...prose(
      "a field of a tool result or argument, not a tool",
      "designSystem",
      "next",
      "deckStyle",
      "representativeSlideId",
    ),
    ...prose(
      "an operation inside a patch-deck argument, not a tool",
      "patch-slide",
    ),
  },
};

const FULL_CATALOG_ONLY =
  "advertised only on the full catalog; owners to reword or advertise";
const PAGE_LOCAL_WEBMCP =
  "a page-local WebMCP tool the text itself marks as a fallback for browser-capable hosts";

// Real tools the instructions name that the default catalog does not
// advertise. App-specific entries are defects awaiting their owners, not
// endorsement: the test fails once the tool is advertised, is no longer named,
// or, unless the page serves it, is missing from the full catalog too.
// "*" applies to every app.
const ADVERTISED_ONLY_CONDITIONALLY: Record<string, Record<string, string>> = {
  "*": prose(
    'the shared text says "the app\'s `view-screen` tool", which only exists in apps with a screen to read',
    "view-screen",
  ),
  design: {
    ...prose(PAGE_LOCAL_WEBMCP, "get-visual-edit-prompt"),
    ...prose(
      FULL_CATALOG_ONLY,
      "export-html",
      "export-zip",
      "export-coding-handoff",
      "export-design-as-figma-svg",
    ),
    ...prose(
      "Builder app tools: they act only on designs backed by a Builder app, so the default catalog leaves them out",
      "send-builder-message",
      "apply-builder-edits",
      "queue-builder-edit",
    ),
  },
  forms: prose(
    "Forms declares no connector tier, so its default catalog is builtins only; owners to advertise or reword",
    "patch-form-fields",
    "update-form",
    "get-form",
    "list-forms",
    "response-insights",
    "list-responses",
    "export-responses",
  ),
};

function rulesFor(app: AppCatalog): ReferenceRules {
  return {
    advertised: new Set(defaultProductionTools(app).map((tool) => tool.name)),
    notToolNames: {
      ...NOT_TOOL_NAMES["*"],
      ...NOT_TOOL_NAMES[app.appId],
    },
    advertisedOnlyConditionally: {
      ...ADVERTISED_ONLY_CONDITIONALLY["*"],
      ...ADVERTISED_ONLY_CONDITIONALLY[app.appId],
    },
  };
}

describe("tool reference detection", () => {
  const rules: ReferenceRules = {
    advertised: new Set(["list-documents", "get-document", "tool-search"]),
    notToolNames: { "revision-guarded": "prose" },
    advertisedOnlyConditionally: {},
  };

  it("accepts advertised names, in prose or in backticks", () => {
    expect(
      unadvertisedReferences(
        "Find with list-documents, read with `get-document`, then `tool-search`.",
        rules,
      ),
    ).toEqual([]);
  });

  it("flags a backticked single word that is not advertised", () => {
    expect(
      unadvertisedReferences("Then call `frobnicate` on the result.", rules),
    ).toEqual(["frobnicate"]);
  });

  it("flags a tool-like name whose verb is one no app uses", () => {
    expect(
      unadvertisedReferences(
        "Use fetch-widgets, then reticulate-splines.",
        rules,
      ),
    ).toEqual(["fetch-widgets", "reticulate-splines"]);
  });

  it("flags a misspelled advertised name", () => {
    expect(unadvertisedReferences("Read with get-documnet.", rules)).toEqual([
      "get-documnet",
    ]);
  });

  it("flags a hyphenated word that is not classified as prose", () => {
    expect(
      unadvertisedReferences(
        "This is a revision-guarded, last-write-wins edit.",
        rules,
      ),
    ).toEqual(["last-write-wins"]);
  });

  it("does not let an exclusion hide a different token", () => {
    expect(
      unadvertisedReferences(
        "Call `revision-guarded` or `edit-document`.",
        rules,
      ),
    ).toEqual(["edit-document"]);
  });

  it("does not treat inherited object keys as exclusions", () => {
    expect(
      unadvertisedReferences(
        "Call `constructor`, `toString`, or `__proto__`.",
        rules,
      ),
    ).toEqual(["constructor", "toString", "__proto__"]);
  });
});

describe("static MCP instructions name only advertised tools", () => {
  let apps: AppCatalog[] = [];

  beforeAll(async () => {
    apps = (await loadAppCatalogs()).filter((app) => app.instructions);
  }, LOAD_TIMEOUT_MS);

  it("covers every app that sets instructions", () => {
    expect(apps.map((app) => app.appId)).toEqual(
      expect.arrayContaining(["content", "design", "forms", "plan", "slides"]),
    );
  });

  it("holds for every app's default catalog", () => {
    const problems = apps.flatMap((app) =>
      unadvertisedReferences(app.instructions, rulesFor(app)).map(
        (reference) =>
          `${app.appId}: instructions mention "${reference}", which its default MCP catalog does not advertise`,
      ),
    );
    expect(
      problems,
      "Static MCP instructions are read by external agents as the guide to this catalog. Remove or reword the " +
        "token, advertise the tool (mcpTool: true on the action, or the app's connectorCatalog), or classify it: " +
        "NOT_TOOL_NAMES for prose and field names, ADVERTISED_ONLY_CONDITIONALLY for a real tool that is legitimately " +
        "conditional. This checks static instructions only, not directory-profile or connection-specific text.",
    ).toEqual([]);
  });

  it("keeps the exception maps limited to tokens that are still needed", () => {
    const stale: string[] = [];
    const ownersOf = (scope: string) =>
      scope === "*" ? apps : apps.filter((app) => app.appId === scope);
    for (const [scope, entries] of Object.entries(NOT_TOOL_NAMES)) {
      for (const token of Object.keys(entries)) {
        if (
          !ownersOf(scope).some((app) =>
            toolReferences(app.instructions).has(token),
          )
        ) {
          stale.push(`NOT_TOOL_NAMES ${scope}/${token}: no longer mentioned`);
        }
      }
    }
    for (const [scope, entries] of Object.entries(
      ADVERTISED_ONLY_CONDITIONALLY,
    )) {
      for (const [token, reason] of Object.entries(entries)) {
        const owners = ownersOf(scope);
        if (
          !owners.some((app) => toolReferences(app.instructions).has(token))
        ) {
          stale.push(
            `ADVERTISED_ONLY_CONDITIONALLY ${scope}/${token}: no longer mentioned`,
          );
        } else if (
          scope !== "*" &&
          owners.every((app) =>
            defaultProductionTools(app).some((tool) => tool.name === token),
          )
        ) {
          stale.push(
            `ADVERTISED_ONLY_CONDITIONALLY ${scope}/${token}: now advertised`,
          );
        } else if (
          scope !== "*" &&
          reason !== PAGE_LOCAL_WEBMCP &&
          !owners.every((app) =>
            app.surfaces[0]!.catalogs.full.some((tool) => tool.name === token),
          )
        ) {
          stale.push(
            `ADVERTISED_ONLY_CONDITIONALLY ${scope}/${token}: not on the full catalog either`,
          );
        }
      }
    }
    expect(
      stale,
      "Remove these entries; they no longer describe the instructions.",
    ).toEqual([]);
  });
});
