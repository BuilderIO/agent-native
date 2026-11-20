import { getOrgRoleForEmail } from "../../mcp/actions/service-token-access.js";
import { canManageDeploymentWithoutOrg } from "../../org/orgless-access.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  RESOURCE_CONTENT_RECORD,
  resourceContentRevision,
} from "../../resources/revision.js";
import {
  canWriteLocalWorkspaceResourcePath,
  resourceGetByPath,
  resourcePut,
  resourcePutIfSnapshot,
  SHARED_OWNER,
  sharedResourceOwner,
  WORKSPACE_OWNER,
  type Resource,
  type ResourceCreatedBy,
  type ResourceVisibility,
  type ResourceWriteOptions,
} from "../../resources/store.js";
import { SAVE_CONFLICT_ERROR_CODE } from "../../save-conflict/index.js";
import { countSaveOutcome } from "../../save-conflict/server.js";
import {
  getAmbientUserEmail,
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

async function assertCanWriteSharedResource(): Promise<void> {
  const orgId = getRequestOrgId();
  const email = getRequestUserEmail()?.trim() ?? getAmbientUserEmail()?.trim();
  if (!orgId) {
    if (canManageDeploymentWithoutOrg(email)) return;
    fail("Only organization owners and admins can edit organization files");
  }

  const role = email ? await getOrgRoleForEmail(orgId, email) : null;
  if (!email || !canManageOrg(role)) {
    fail("Only organization owners and admins can edit organization files");
  }
}

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

async function writeIfCurrent(input: {
  owner: string;
  scope: string;
  path: string;
  content: string;
  mimeType: string;
  options: ResourceWriteOptions;
  expectedRevision: string;
}): Promise<Resource> {
  const orgId = getRequestOrgId() ?? null;
  const lookup = input.scope === "personal" ? undefined : { orgId };
  for (let attempt = 0; ; attempt += 1) {
    const current = await resourceGetByPath(input.owner, input.path, lookup);
    const legacy =
      !current && input.scope === "shared" && input.owner !== SHARED_OWNER
        ? await resourceGetByPath(SHARED_OWNER, input.path, lookup)
        : null;
    const seen = current ?? legacy;
    if (!seen) {
      countSaveOutcome(RESOURCE_CONTENT_RECORD, "conflict");
      fail(
        `Nothing was written: "${input.path}" isn't in scope ${input.scope}. If your read's [revision …, scope …] line named another scope, write in that scope. Otherwise it was deleted or moved after your read, and a write without expectedRevision creates it again.`,
        {
          errorCode: SAVE_CONFLICT_ERROR_CODE,
          statusCode: 409,
          details: { current: null, currentRevision: null },
        },
      );
    }
    if (current && current.owner !== input.owner) {
      fail(
        `Nothing was written: the "${input.path}" a ${input.scope} read shows isn't the copy a ${input.scope} write changes, so it can't be replaced from here.`,
      );
    }
    const revision = resourceContentRevision(seen);
    const alreadyThere = seen.content === input.content;
    const lastTry = attempt === 2;
    if (lastTry || (revision !== input.expectedRevision && !alreadyThere)) {
      if (alreadyThere) {
        countSaveOutcome(RESOURCE_CONTENT_RECORD, "already_applied");
        return seen;
      }
      countSaveOutcome(RESOURCE_CONTENT_RECORD, "conflict");
      fail(
        revision === input.expectedRevision
          ? `"${input.path}" (scope ${input.scope}) is changing as you write, so nothing was written. Its revision is now ${revision}: write again with it.`
          : `"${input.path}" (scope ${input.scope}) changed after you read it, so nothing was written. Its revision is now ${revision}. Read it again, redo your edit on what's there now, and write with expectedRevision ${revision}.`,
        {
          errorCode: SAVE_CONFLICT_ERROR_CODE,
          statusCode: 409,
          details: { currentRevision: revision },
        },
      );
    }
    const written = await resourcePutIfSnapshot({
      previous: current,
      owner: input.owner,
      path: input.path,
      content: input.content,
      mimeType: input.mimeType,
      options: input.options,
    });
    if (written) {
      countSaveOutcome(RESOURCE_CONTENT_RECORD, "written");
      return written.resource;
    }
  }
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
  --expected-revision <revision>
                           The revision from your read of this file. If it
                           changed since, nothing is written and the write
                           fails with errorCode save_conflict.
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
  const flags: Partial<Record<string, string>> = parsed;
  const threadId = flags["thread-id"] ?? flags.threadId;
  const runId = flags["run-id"] ?? flags.runId;
  const expiresAt = parseOptionalNumber(
    parsed["expires-at"] ?? parsed.expiresAt,
    "--expires-at",
  );
  let owner: string;
  if (scope === "shared") {
    await assertCanWriteSharedResource();
    owner = sharedResourceOwner(getRequestOrgId());
  } else if (scope === "workspace") {
    owner = WORKSPACE_OWNER;
  } else {
    const personalOwner = getRequestUserEmail() ?? getAmbientUserEmail();
    if (!personalOwner) {
      fail(
        "resource-write --scope=personal requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
      );
    }
    owner = personalOwner;
  }

  const writeOptions: ResourceWriteOptions = {
    ...(visibility === undefined ? {} : { visibility }),
    ...(createdBy === undefined ? {} : { createdBy }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(runId === undefined ? {} : { runId }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
  const hasWriteOptions = Object.keys(writeOptions).length > 0;
  const expectedRevision = flags["expected-revision"] ?? flags.expectedRevision;
  if (expectedRevision !== undefined && !expectedRevision.trim()) {
    fail("--expected-revision must be the revision from your read.");
  }
  const resource = expectedRevision
    ? await writeIfCurrent({
        owner,
        scope,
        path: resourcePath,
        content,
        mimeType,
        options: writeOptions,
        expectedRevision,
      })
    : hasWriteOptions
      ? await resourcePut(owner, resourcePath, content, mimeType, writeOptions)
      : await resourcePut(owner, resourcePath, content, mimeType);
  console.log(
    `Wrote resource: ${resource.path} (${resource.size} bytes, revision ${resourceContentRevision(resource)})`,
  );
}
