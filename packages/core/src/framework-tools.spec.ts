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
      frameworkTools: {
        sharing: false,
        review: false,
        browserSessions: false,
      },
    });

    expect([...resolved.disabledGroups].sort()).toEqual([
      "browserSessions",
      "review",
      "sharing",
    ]);
    expect(resolved.isEnabled("history")).toBe(true);
    expect(resolved.isEnabled("browserSessions")).toBe(false);
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

    it("honors frameworkTools.experiments as the Labs alias and warns", () => {
      const resolved = resolveFrameworkTools({
        frameworkTools: { experiments: false },
      });

      expect(resolved.isEnabled("labs")).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("`frameworkTools.experiments` is deprecated"),
      );
    });

    it("accepts old and new forms that agree, including boolean spellings", () => {
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
      expect(
        resolveFrameworkTools({
          frameworkTools: { experiments: false, labs: false },
        }).isEnabled("labs"),
      ).toBe(false);
    });

    it("throws when the old and new forms disagree", () => {
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
      expect(() =>
        resolveFrameworkTools({
          frameworkTools: { experiments: false, labs: true },
        }),
      ).toThrow(/frameworkTools\.experiments.*frameworkTools\.labs.*disagree/s);
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
  it("keeps suggestion amendments in the review group", () => {
    expect(CORE_ACTION_GROUPS["update-resource-suggestion"]).toBe("review");
    expect(
      filterFrameworkToolGroups(
        { "update-resource-suggestion": {} },
        new Set<FrameworkToolGroup>(["review"]),
      ),
    ).toEqual({});
  });

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
