import fs from "fs";
import path from "path";
import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidWorkspace,
  PROJECTS_DIR,
  SHARED_DIR,
  fail,
} from "./_utils.js";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  title?: string;
  children?: FileNode[];
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return filename.replace(/\.md$/, "").replace(/-/g, " ");
}

function buildFileTree(dir: string, basePath = ""): FileNode[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "media") continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: buildFileTree(fullPath, relativePath),
      });
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".json")) {
      const node: FileNode = {
        name: entry.name,
        path: relativePath,
        type: "file",
      };
      if (entry.name.endsWith(".md")) {
        try {
          node.title = extractTitle(
            fs.readFileSync(fullPath, "utf-8"),
            entry.name,
          );
        } catch {}
      }
      nodes.push(node);
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

function fileTreeToText(nodes: FileNode[], indent = ""): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "directory") {
      text += `${indent}${node.name}/\n`;
      if (node.children) text += fileTreeToText(node.children, indent + "  ");
    } else {
      const label = node.title ? `${node.name} (${node.title})` : node.name;
      text += `${indent}${label}\n`;
    }
  }
  return text;
}

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script get-file-tree [options]

Options:
  --project-slug  Project slug to show tree for
  --workspace     Workspace name (for workspace shared resources)`);
    return;
  }

  const { projectSlug, workspace } = opts;

  let dir: string;
  let label: string;
  if (projectSlug) {
    dir = path.join(PROJECTS_DIR, projectSlug);
    label = projectSlug;
  } else if (workspace) {
    if (!isValidWorkspace(workspace)) fail("Invalid workspace name");
    dir = path.join(PROJECTS_DIR, workspace, "shared-resources");
    label = `${workspace}/shared-resources`;
  } else {
    dir = SHARED_DIR;
    label = "shared-resources";
  }

  if (!fs.existsSync(dir)) fail(`Not found: ${label}`);

  const tree = buildFileTree(dir);
  console.log(`File tree for ${label}:\n`);
  console.log(fileTreeToText(tree));
}
