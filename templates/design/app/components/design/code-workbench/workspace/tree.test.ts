import { describe, expect, it } from "vitest";

import { buildFileTree, flattenVisibleTree } from "./tree";
import type { WorkspaceFileEntry } from "./types";

function entry(path: string): WorkspaceFileEntry {
  return { path };
}

describe("buildFileTree", () => {
  it("builds nested folders from / separated paths", () => {
    const tree = buildFileTree([
      entry("index.html"),
      entry("src/app.js"),
      entry("src/components/Button.jsx"),
      entry("src/components/Card.jsx"),
    ]);

    expect(tree.map((node) => node.name)).toEqual(["src", "index.html"]);
    const src = tree[0];
    if (src.kind !== "folder") throw new Error("expected folder");
    expect(src.children.map((node) => node.name)).toEqual([
      "components",
      "app.js",
    ]);
    const components = src.children[0];
    if (components.kind !== "folder") throw new Error("expected folder");
    expect(components.children.map((node) => node.name)).toEqual([
      "Button.jsx",
      "Card.jsx",
    ]);
  });

  it("orders folders before files, alphabetically and case-insensitively", () => {
    const tree = buildFileTree([
      entry("zeta.html"),
      entry("Alpha/file.js"),
      entry("beta/file.js"),
      entry("apple.css"),
      entry("Banana.css"),
    ]);

    expect(tree.map((node) => node.name)).toEqual([
      "Alpha",
      "beta",
      "apple.css",
      "Banana.css",
      "zeta.html",
    ]);
  });

  it("dedupes shared folder ancestry across multiple files", () => {
    const tree = buildFileTree([
      entry("src/a.ts"),
      entry("src/b.ts"),
      entry("src/nested/c.ts"),
    ]);
    expect(tree).toHaveLength(1);
    const src = tree[0];
    if (src.kind !== "folder") throw new Error("expected folder");
    expect(src.children).toHaveLength(3);
  });

  it("uses displayName for the file label when present", () => {
    const tree = buildFileTree([{ path: "index.html", displayName: "Home" }]);
    expect(tree[0].name).toBe("Home");
  });

  it("ignores empty paths", () => {
    expect(buildFileTree([entry(""), entry("/")])).toEqual([]);
  });
});

describe("flattenVisibleTree", () => {
  it("only descends into expanded folders", () => {
    const tree = buildFileTree([
      entry("src/a.ts"),
      entry("src/nested/b.ts"),
      entry("root.ts"),
    ]);

    const collapsed = flattenVisibleTree(tree, new Set());
    expect(collapsed.map((row) => row.path)).toEqual(["src", "root.ts"]);

    const expanded = flattenVisibleTree(tree, new Set(["src"]));
    expect(expanded.map((row) => row.path)).toEqual([
      "src",
      "src/nested",
      "src/a.ts",
      "root.ts",
    ]);

    const fullyExpanded = flattenVisibleTree(
      tree,
      new Set(["src", "src/nested"]),
    );
    expect(fullyExpanded.map((row) => row.path)).toEqual([
      "src",
      "src/nested",
      "src/nested/b.ts",
      "src/a.ts",
      "root.ts",
    ]);
  });

  it("tracks depth and parentPath for indentation and Left-arrow nav", () => {
    const tree = buildFileTree([entry("src/nested/b.ts")]);
    const rows = flattenVisibleTree(tree, new Set(["src", "src/nested"]));
    const nested = rows.find((row) => row.path === "src/nested");
    const file = rows.find((row) => row.path === "src/nested/b.ts");
    expect(nested?.depth).toBe(1);
    expect(nested?.parentPath).toBe("src");
    expect(file?.depth).toBe(2);
    expect(file?.parentPath).toBe("src/nested");
  });

  it("accepts a readonly array as well as a Set for expandedPaths", () => {
    const tree = buildFileTree([entry("src/a.ts")]);
    const rows = flattenVisibleTree(tree, ["src"]);
    expect(rows.map((row) => row.path)).toEqual(["src", "src/a.ts"]);
  });
});
