import type { WorkspaceFileEntry } from "./types";

/**
 * Pure file-tree construction for the explorer. Given a flat list of
 * root-relative paths, builds a folders-first, case-insensitive alphabetical
 * tree — matching VS Code explorer ordering.
 */

export interface TreeFileNode {
  kind: "file";
  path: string;
  name: string;
  entry: WorkspaceFileEntry;
}

export interface TreeFolderNode {
  kind: "folder";
  path: string;
  name: string;
  children: TreeNode[];
}

export type TreeNode = TreeFileNode | TreeFolderNode;

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  const folders = nodes
    .filter((node): node is TreeFolderNode => node.kind === "folder")
    .sort((a, b) => compareNames(a.name, b.name))
    .map((folder) => ({ ...folder, children: sortTree(folder.children) }));
  const files = nodes
    .filter((node): node is TreeFileNode => node.kind === "file")
    .sort((a, b) => compareNames(a.name, b.name));
  return [...folders, ...files];
}

/**
 * Build a folders-first tree from a flat list of workspace file entries.
 * Folders are derived from `/`-separated path segments; each level is sorted
 * alphabetically (case-insensitive) with folders before files.
 */
export function buildFileTree(entries: WorkspaceFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderIndex = new Map<string, TreeFolderNode>();

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let siblings = root;
    let currentPath = "";
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let folder = folderIndex.get(currentPath);
      if (!folder) {
        folder = {
          kind: "folder",
          path: currentPath,
          name: segment,
          children: [],
        };
        folderIndex.set(currentPath, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    const fileName = segments[segments.length - 1]!;
    siblings.push({
      kind: "file",
      path: entry.path,
      name: entry.displayName || fileName,
      entry,
    });
  }

  return sortTree(root);
}

export interface FlatTreeRow {
  node: TreeNode;
  path: string;
  depth: number;
  parentPath: string | null;
}

/**
 * Flatten a tree into the currently visible rows given a set of expanded
 * folder paths. Used for keyboard nav (Up/Down/typeahead) over the rendered
 * rows without re-deriving DOM order.
 */
export function flattenVisibleTree(
  nodes: TreeNode[],
  expandedPaths: ReadonlySet<string> | readonly string[],
  depth = 0,
  parentPath: string | null = null,
  rows: FlatTreeRow[] = [],
): FlatTreeRow[] {
  const expanded =
    expandedPaths instanceof Set ? expandedPaths : new Set(expandedPaths);
  for (const node of nodes) {
    rows.push({ node, path: node.path, depth, parentPath });
    if (node.kind === "folder" && expanded.has(node.path)) {
      flattenVisibleTree(node.children, expanded, depth + 1, node.path, rows);
    }
  }
  return rows;
}
