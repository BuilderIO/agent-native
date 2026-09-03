import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CORE_ACTION_GROUPS,
  filterFrameworkToolGroups,
  FRAMEWORK_TOOL_GROUPS,
  frameworkGroupEnabled,
  isFrameworkGroupedAction,
  resolveFrameworkTools,
  type FrameworkToolGroup,
} from "./framework-tools.js";

describe("resolveFrameworkTools", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("leaves every group on when nothing is configured", () => {
    const resolved = resolveFrameworkTools(undefined);

    expect(resolved.disabledGroups.size).toBe(0);
    // `undefined` (not "read") so `normalizeDatabaseToolsMode` keeps owning the
    // default and this resolver cannot drift from it.
    expect(resolved.database).toBeUndefined();
    expect(resolved.extensions).toBe(false);
    for (const group of FRAMEWORK_TOOL_GROUPS) {
      expect(resolved.isEnabled(group), group).toBe(true);
    }
  });

  it("turns every group off for the minimal preset", () => {
    for (const config of ["minimal" as const, { preset: "minimal" as const }]) {
      const resolved = resolveFrameworkTools({ frameworkTools: config });

      expect(resolved.disabledGroups.size).toBe(FRAMEWORK_TOOL_GROUPS.length);
      expect(resolved.database).toBe("off");
      expect(resolved.extensions).toBe(false);
    }
  });

  it("lets an explicit group key win over the preset", () => {
    const resolved = resolveFrameworkTools({
      frameworkTools: { preset: "minimal", resources: true, database: "write" },
    });

    expect(resolved.isEnabled("resources")).toBe(true);
    expect(resolved.isEnabled("sharing")).toBe(false);
    expect(resolved.database).toBe("write");
  });

  it("disables only the groups set to false", () => {
    const resolved = resolveFrameworkTools({
      frameworkTools: { sharing: false, review: false },
    });

    expect([...resolved.disabledGroups].sort()).toEqual(["review", "sharing"]);
    expect(resolved.isEnabled("history")).toBe(true);
  });

  describe("deprecated flags", () => {
    it("honors databaseTools alone and warns", () => {
      const resolved = resolveFrameworkTools({ databaseTools: "off" });

      expect(resolved.database).toBe("off");
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("`databaseTools` is deprecated"),
      );
    });

    it("honors extensionTools alone and warns", () => {
      const resolved = resolveFrameworkTools({ extensionTools: true });

      expect(resolved.extensions).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("`extensionTools` is deprecated"),
      );
    });

    it("accepts old and new forms that agree, including boolean spellings", () => {
      // `false` and `"off"` are the same mode, so this is not a conflict.
      expect(
        resolveFrameworkTools({
          databaseTools: false,
          frameworkTools: { database: "off" },
        }).database,
      ).toBe("off");
      expect(
        resolveFrameworkTools({
          extensionTools: true,
          frameworkTools: { extensions: true },
        }).extensions,
      ).toBe(true);
    });

    it("throws when the old and new forms disagree", () => {
      // Silently preferring one would boot the app with a tool surface nobody
      // chose, and the resulting "why can't the agent see db-query" is
      // unexplainable from either call site.
      expect(() =>
        resolveFrameworkTools({
          databaseTools: false,
          frameworkTools: { database: "write" },
        }),
      ).toThrow(/databaseTools.*frameworkTools\.database.*disagree/s);
      expect(() =>
        resolveFrameworkTools({
          extensionTools: false,
          frameworkTools: { extensions: true },
        }),
      ).toThrow(/extensionTools.*frameworkTools\.extensions.*disagree/s);
    });

    it("names both values so the error identifies the fix", () => {
      expect(() =>
        resolveFrameworkTools({
          databaseTools: "read",
          frameworkTools: { database: "off" },
        }),
      ).toThrow(/"read".*"off"/s);
    });
  });
});

describe("filterFrameworkToolGroups", () => {
  const registry = {
    "create-form": { tool: { description: "app action" } },
    "share-resource": { frameworkGroup: "sharing" as FrameworkToolGroup },
    "list-review-comments": { frameworkGroup: "review" as FrameworkToolGroup },
  };

  it("returns the input untouched when nothing is disabled", () => {
    // Same reference: the default path must not pay to rebuild the registry.
    expect(filterFrameworkToolGroups(registry, new Set())).toBe(registry);
  });

  it("drops only the disabled groups and never the app's own actions", () => {
    const filtered = filterFrameworkToolGroups(
      registry,
      new Set<FrameworkToolGroup>(["sharing"]),
    );

    expect(Object.keys(filtered).sort()).toEqual([
      "create-form",
      "list-review-comments",
    ]);
  });
});

describe("isFrameworkGroupedAction", () => {
  it("separates framework kits from app actions", () => {
    expect(isFrameworkGroupedAction("list-audit-events", {})).toBe(true);
    expect(
      isFrameworkGroupedAction("anything", { frameworkGroup: "audit" }),
    ).toBe(true);
    expect(isFrameworkGroupedAction("create-form", {})).toBe(false);
  });
});

describe("group membership resolves by name, not only by tag", () => {
  // The guard this file was missing. Every test above stamped `frameworkGroup`
  // by hand, so the filter looked correct while the tag was reaching almost no
  // real registry: it is written only by `mergeCoreSharingActions`, which runs
  // against the ungated `httpActions`. Apps loading core kits through
  // `loadActionsFromStaticRegistry` or their own actions directory therefore
  // held untagged entries, and eight `frameworkTools` switches silently did
  // nothing. Build the fixtures the way those apps do — no tag — so a
  // regression here fails instead of passing on hand-tagged inputs.
  const untagged = Object.fromEntries(
    Object.keys(CORE_ACTION_GROUPS).map((name) => [
      name,
      { run: async () => ({}) },
    ]),
  );

  it("drops every core action of a disabled group when nothing is tagged", () => {
    for (const group of FRAMEWORK_TOOL_GROUPS) {
      const names = Object.entries(CORE_ACTION_GROUPS)
        .filter(([, g]) => g === group)
        .map(([name]) => name);
      if (names.length === 0) continue;

      const filtered = filterFrameworkToolGroups(untagged, new Set([group]));
      for (const name of names) {
        expect(
          Object.hasOwn(filtered, name),
          `${name} survived \`${group}: false\``,
        ).toBe(false);
      }
      // Only that group goes; the rest of the catalog is untouched.
      expect(Object.keys(filtered).length).toBe(
        Object.keys(untagged).length - names.length,
      );
    }
  });

  it("leaves app actions that merely resemble a kit name alone", () => {
    const filtered = filterFrameworkToolGroups(
      { "share-portfolio": { run: async () => ({}) } },
      new Set(["sharing"]),
    );
    expect(Object.keys(filtered)).toEqual(["share-portfolio"]);
  });
});

describe("frameworkGroupEnabled", () => {
  it("treats an absent disabled set as everything enabled", () => {
    expect(frameworkGroupEnabled(undefined, "docs")).toBe(true);
    expect(frameworkGroupEnabled(new Set(["docs"]), "docs")).toBe(false);
    expect(frameworkGroupEnabled(new Set(["docs"]), "web")).toBe(true);
  });
});
