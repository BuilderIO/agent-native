import type { TreeNode } from "./use-resources.js";

export type ResourceView =
  | "files"
  | "instructions"
  | "agents"
  | "memory"
  | "skills"
  | "learnings"
  | "remote-agents";

export type ResourceTreeVariant = "tree" | "collection";

const SPECIAL_RESOURCE_ROOTS = new Set([
  "agents",
  "agent-scratch",
  "jobs",
  "memory",
  "remote-agents",
  "skills",
]);
const SPECIAL_RESOURCE_FILES = new Set(["agents.md", "learnings.md"]);

function normalizedResourcePath(path: string): string {
  return path.replace(/^\/+/, "").toLowerCase();
}

function resourceMatchesView(node: TreeNode, view: ResourceView): boolean {
  const path = normalizedResourcePath(node.path);
  switch (view) {
    case "files":
      return (
        !SPECIAL_RESOURCE_ROOTS.has(path.split("/", 1)[0]) &&
        !SPECIAL_RESOURCE_FILES.has(path.split("/").pop() ?? "")
      );
    case "instructions":
      return path.split("/").pop() === "agents.md";
    case "agents":
      return node.kind === "agent";
    case "memory":
      return path === "memory" || path.startsWith("memory/");
    case "skills":
      return node.kind === "skill";
    case "learnings":
      return path.split("/").pop() === "learnings.md";
    case "remote-agents":
      return node.kind === "remote-agent";
  }
}

export function filterResourceTree(
  tree: TreeNode[],
  view: ResourceView | undefined,
): TreeNode[] {
  if (!view) return tree;
  return tree.flatMap((node) => {
    if (node.type === "folder") {
      if (
        view === "files" &&
        (SPECIAL_RESOURCE_ROOTS.has(
          normalizedResourcePath(node.path).split("/", 1)[0],
        ) ||
          SPECIAL_RESOURCE_FILES.has(
            normalizedResourcePath(node.path).split("/").pop() ?? "",
          ))
      ) {
        return [];
      }
      const children = filterResourceTree(node.children ?? [], view);
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    return resourceMatchesView(node, view) ? [node] : [];
  });
}
