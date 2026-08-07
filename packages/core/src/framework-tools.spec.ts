import { beforeEach, describe, expect, it, vi } from "vitest";

import {
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
    expect(isFrameworkGroupedAction({ frameworkGroup: "audit" })).toBe(true);
    expect(isFrameworkGroupedAction({})).toBe(false);
  });
});

describe("frameworkGroupEnabled", () => {
  it("treats an absent disabled set as everything enabled", () => {
    expect(frameworkGroupEnabled(undefined, "docs")).toBe(true);
    expect(frameworkGroupEnabled(new Set(["docs"]), "docs")).toBe(false);
    expect(frameworkGroupEnabled(new Set(["docs"]), "web")).toBe(true);
  });
});
