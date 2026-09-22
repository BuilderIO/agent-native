import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import type { ActionRunContext } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import {
  buildResourcePack,
  redactResourceContent,
  RESOURCE_PACK_MAX_BYTES,
  RESOURCE_PACK_MAX_FILES,
  type ResourcePack,
  type ResourcePackEntry,
  type ResourcePackRedaction,
  type ResourcePackScope,
} from "../pack.js";
import {
  ensurePersonalDefaults,
  isBinaryResourceMimeType,
  packScopeFromOwner,
  resourceGet,
  resourceList,
  resourceListAccessible,
  resourceListOrganization,
  WORKSPACE_OWNER,
  type ResourceListOptions,
  type ResourceMeta,
} from "../store.js";

export const exportResourcePackSchema = z.object({
  scope: z
    .enum(["personal", "organization", "workspace", "accessible"])
    .default("accessible")
    .describe(
      'Which resources to include: "personal", "organization", "workspace", or "accessible" (all three, personal winning). Defaults to "accessible".',
    ),
  prefix: z
    .string()
    .optional()
    .describe('Optional path prefix such as "memory/" or "skills/".'),
});

export type ExportResourcePackArgs = z.infer<typeof exportResourcePackSchema>;

function resolveAppId(ctx?: ActionRunContext): string | undefined {
  if (typeof ctx?.appId === "string" && ctx.appId.trim().length > 0) {
    return ctx.appId.trim();
  }
  const id = getAppConfig().app.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

async function listMetasForScope(
  userEmail: string,
  orgId: string | null,
  scope: ExportResourcePackArgs["scope"],
  prefix: string | undefined,
): Promise<ResourceMeta[]> {
  const options: ResourceListOptions = { userEmail, orgId };
  if (scope === "personal") {
    return resourceList(userEmail, prefix, options);
  }
  if (scope === "organization") {
    return resourceListOrganization(orgId, prefix, options);
  }
  if (scope === "workspace") {
    return resourceList(WORKSPACE_OWNER, prefix, options);
  }
  return resourceListAccessible(userEmail, prefix, options);
}

function packSourceScope(
  scope: ExportResourcePackArgs["scope"],
): ResourcePackScope {
  return scope === "accessible" ? "personal" : scope;
}

export async function exportResourcePackForCaller(
  args: ExportResourcePackArgs,
  ctx?: ActionRunContext,
): Promise<{ pack: ResourcePack }> {
  const userEmail = ctx?.userEmail;
  if (!userEmail) fail("Not authenticated.", { statusCode: 401 });
  const orgId = ctx?.orgId ?? null;
  await ensurePersonalDefaults(userEmail);

  const metas = await listMetasForScope(
    userEmail,
    orgId,
    args.scope,
    args.prefix,
  );
  const entries: ResourcePackEntry[] = [];
  const redactions: ResourcePackRedaction[] = [];
  let byteCount = 0;

  for (const meta of metas) {
    if (isBinaryResourceMimeType(meta.mimeType)) {
      redactions.push({ path: meta.path, reason: "binary" });
      continue;
    }
    const resource = await resourceGet(meta.id, { userEmail, orgId });
    if (!resource || typeof resource.content !== "string") {
      redactions.push({ path: meta.path, reason: "unreadable" });
      continue;
    }
    const redacted = redactResourceContent(meta.path, resource.content);
    if (redacted.redacted) {
      redactions.push({ path: meta.path, reason: "secret" });
    }
    byteCount += Buffer.byteLength(resource.content, "utf8");
    entries.push({
      path: meta.path,
      scope: packScopeFromOwner(resource.owner, userEmail),
      content: redacted.content,
    });
  }

  if (
    entries.length > RESOURCE_PACK_MAX_FILES ||
    byteCount > RESOURCE_PACK_MAX_BYTES
  ) {
    fail("Resource pack exceeds the export cap.", {
      errorCode: "too_large",
      details: {
        fileCount: entries.length,
        byteCount,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxBytes: RESOURCE_PACK_MAX_BYTES,
      },
    });
  }

  const appId = resolveAppId(ctx);
  return {
    pack: buildResourcePack(entries, {
      source: {
        ...(appId ? { appId } : {}),
        scope: packSourceScope(args.scope),
      },
      redactions,
    }),
  };
}

export default defineAction({
  description:
    "Export a checksummed JSON pack of the text agent resources you can already read. Secrets and MCP tokens are redacted; binaries are omitted. Use import-resource-pack to load a pack into personal (default) or organization scope.",
  schema: exportResourcePackSchema,
  http: { method: "GET" },
  readOnly: true,
  audit: {
    onRead: true,
    summary: (args) =>
      `Export resource pack (${(args as { scope?: string }).scope ?? "accessible"})`,
  },
  run: exportResourcePackForCaller,
});
