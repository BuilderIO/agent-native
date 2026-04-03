/**
 * Core script: resource-write
 *
 * Write (create or update) a resource in the SQL store.
 *
 * Usage:
 *   pnpm action resource-write --path <path> --content <content> [--scope personal|shared] [--mime <mime-type>]
 */

import { parseArgs, fail } from "../utils.js";
import { resourcePut, SHARED_OWNER } from "../../resources/store.js";

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".html": "text/html",
  ".css": "text/css",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".sql": "text/sql",
  ".sh": "text/x-shellscript",
  ".py": "text/x-python",
  ".toml": "text/toml",
};

function inferMimeType(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return "text/plain";
  const ext = filePath.slice(dotIndex).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? "text/plain";
}

export default async function resourceWriteScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(
      `Usage: pnpm action resource-write --path <path> --content <content> [options]

Options:
  --path <path>            Resource path (required)
  --content <content>      Content to write (required)
  --scope personal|shared  Scope to write to (default: personal)
  --mime <mime-type>       MIME type (default: inferred from extension)
  --help                   Show this help message`,
    );
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path notes/todo.md");
  }

  const content = parsed.content;
  if (content === undefined || content === null) {
    fail("--content is required.");
  }

  const scope = parsed.scope ?? "personal";
  const mimeType = parsed.mime ?? inferMimeType(resourcePath);
  const owner =
    scope === "shared"
      ? SHARED_OWNER
      : (process.env.AGENT_USER_EMAIL ?? "local@localhost");

  const resource = await resourcePut(owner, resourcePath, content, mimeType);
  console.log(`Wrote resource: ${resource.path} (${resource.size} bytes)`);
}
