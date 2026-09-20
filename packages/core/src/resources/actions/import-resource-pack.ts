import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import type { ActionRunContext } from "../../action.js";
import { getOrgRoleForEmail } from "../../mcp/actions/service-token-access.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  RESOURCE_PACK_MAX_BYTES,
  RESOURCE_PACK_MAX_FILES,
  verifyResourcePack,
  type ResourcePack,
} from "../pack.js";
import {
  ownerForPackTarget,
  resourceGetByPath,
  resourcePut,
  resourcePutIfAbsent,
} from "../store.js";

export const importResourcePackSchema = z.object({
  pack: z
    .unknown()
    .describe("The JSON resource pack object from export-resource-pack."),
  targetScope: z
    .enum(["personal", "organization", "workspace"])
    .default("personal")
    .describe(
      'Where to write imported files. Defaults to "personal". "workspace" is refused.',
    ),
  onConflict: z
    .enum(["skip", "overwrite"])
    .default("skip")
    .describe(
      'When a path already exists in the target scope: "skip" (default) or "overwrite".',
    ),
});

export type ImportResourcePackArgs = z.infer<typeof importResourcePackSchema>;

export interface ImportResourcePackResult {
  imported: number;
  skipped: number;
  redacted: number;
  errors: Array<{ path: string; error: string }>;
}

function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".txt") || lower.endsWith(".csv")) return "text/plain";
  return "text/markdown";
}

function packByteCount(pack: ResourcePack): number {
  return pack.resources.reduce(
    (sum, resource) => sum + Buffer.byteLength(resource.content, "utf8"),
    0,
  );
}

async function assertCanWriteOrganization(
  ctx: ActionRunContext | undefined,
): Promise<void> {
  const email = ctx?.userEmail;
  const orgId = ctx?.orgId ?? null;
  if (!email) fail("Not authenticated.", { statusCode: 401 });
  if (!orgId) return;
  const role = await getOrgRoleForEmail(orgId, email);
  if (!canManageOrg(role)) {
    fail("Only organization admins can import into organization files.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
}

export async function importResourcePackForCaller(
  args: ImportResourcePackArgs,
  ctx?: ActionRunContext,
): Promise<ImportResourcePackResult> {
  const userEmail = ctx?.userEmail;
  if (!userEmail) fail("Not authenticated.", { statusCode: 401 });

  const targetScope = args.targetScope;
  if (targetScope === "workspace") {
    fail("Workspace import is not available.", {
      errorCode: "workspace_import_forbidden",
      statusCode: 400,
    });
  }

  const verified = verifyResourcePack(args.pack);
  if (!verified.ok) {
    fail(
      verified.error === "checksum_mismatch"
        ? "Resource pack checksum does not match its contents."
        : verified.error === "unsupported_version"
          ? "This resource pack version is not supported."
          : "Resource pack is invalid.",
      { errorCode: verified.error },
    );
  }

  const pack = verified.pack;
  const byteCount = packByteCount(pack);
  if (
    pack.resources.length > RESOURCE_PACK_MAX_FILES ||
    byteCount > RESOURCE_PACK_MAX_BYTES
  ) {
    fail("Resource pack exceeds the import cap.", {
      errorCode: "too_large",
      details: {
        fileCount: pack.resources.length,
        byteCount,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxBytes: RESOURCE_PACK_MAX_BYTES,
      },
    });
  }

  if (targetScope === "organization") {
    await assertCanWriteOrganization(ctx);
  }

  const owner = ownerForPackTarget(targetScope, userEmail, ctx?.orgId ?? null);
  const errors: ImportResourcePackResult["errors"] = [];
  let imported = 0;
  let skipped = 0;

  for (const resource of pack.resources) {
    try {
      const mimeType = mimeTypeForPath(resource.path);
      if (args.onConflict === "overwrite") {
        await resourcePut(owner, resource.path, resource.content, mimeType);
        imported += 1;
        continue;
      }
      const existing = await resourceGetByPath(owner, resource.path, {
        userEmail,
        orgId: ctx?.orgId ?? null,
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      const created = await resourcePutIfAbsent(
        owner,
        resource.path,
        resource.content,
        mimeType,
      );
      if (created) {
        imported += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        path: resource.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    imported,
    skipped,
    redacted: pack.redactions.length,
    errors,
  };
}

export default defineAction({
  description:
    "Import a checksummed JSON resource pack into personal scope by default (skip-on-conflict). Organization import requires the same admin write ACL as editing organization files. Workspace import is refused.",
  schema: importResourcePackSchema,
  run: importResourcePackForCaller,
});
