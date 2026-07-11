/**
 * Core script: resource-write
 *
 * Write (create or update) a resource in the SQL store.
 *
 * Usage:
 *   pnpm action resource-write --path <path> --content <content> [--scope personal|shared] [--mime <mime-type>] [--visibility workspace|agent_scratch]
 */

import {
  canWriteLocalWorkspaceResourcePath,
  resourcePut,
  SHARED_OWNER,
  WORKSPACE_OWNER,
  type ResourceCreatedBy,
  type ResourceVisibility,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

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

function parseVisibility(
  value: string | undefined,
): ResourceVisibility | undefined {
  if (!value) return undefined;
  if (value === "workspace" || value === "agent_scratch") return value;
  fail("--visibility must be workspace or agent_scratch.");
}

function parseCreatedBy(
  value: string | undefined,
): ResourceCreatedBy | undefined {
  if (!value) return undefined;
  if (value === "user" || value === "agent" || value === "system") return value;
  fail("--created-by must be user, agent, or system.");
}

function parseOptionalNumber(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${flag} must be a number.`);
  return parsed;
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
  --scope personal|shared|workspace
                           Scope to write to (default: personal). Workspace is writable for local file mode control resources.
  --mime <mime-type>       MIME type (default: inferred from extension)
  --visibility workspace|agent_scratch
                           Visibility (default: workspace)
  --created-by user|agent|system
                           Provenance label (default: user)
  --thread-id <id>         Agent thread id for scratch/provenance
  --run-id <id>            Agent run id for scratch/provenance
  --expires-at <ms>        Expiry timestamp in epoch milliseconds
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
  if (scope === "workspace") {
    if (!(await canWriteLocalWorkspaceResourcePath(resourcePath))) {
      fail(
        "Workspace resources are managed from Dispatch unless local file mode exposes this path. Writable local workspace paths are AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, and skills/.",
      );
    }
  }
  const mimeType = parsed.mime ?? inferMimeType(resourcePath);
  const visibility = parseVisibility(parsed.visibility);
  const createdBy = parseCreatedBy(parsed["created-by"] ?? parsed.createdBy);
  const threadId = parsed["thread-id"] ?? parsed.threadId;
  const runId = parsed["run-id"] ?? parsed.runId;
  const expiresAt = parseOptionalNumber(
    parsed["expires-at"] ?? parsed.expiresAt,
    "--expires-at",
  );
  let owner: string;
  if (scope === "shared") {
    owner = SHARED_OWNER;
  } else if (scope === "workspace") {
    owner = WORKSPACE_OWNER;
  } else {
    const personalOwner = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;
    if (!personalOwner) {
      fail(
        "resource-write --scope=personal requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
      );
    }
    owner = personalOwner;
  }

  const writeOptions = {
    visibility,
    createdBy,
    threadId,
    runId,
    expiresAt,
  };
  const hasWriteOptions = Object.values(writeOptions).some(
    (value) => value !== undefined,
  );
  const resource = hasWriteOptions
    ? await resourcePut(owner, resourcePath, content, mimeType, writeOptions)
    : await resourcePut(owner, resourcePath, content, mimeType);
  console.log(`Wrote resource: ${resource.path} (${resource.size} bytes)`);
}
