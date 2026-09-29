import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import type { ActionRunContext } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import {
  buildResourcePack,
  redactResourceContent,
  RESOURCE_PACK_MAX_BODY_BYTES,
  RESOURCE_PACK_MAX_BYTES,
  RESOURCE_PACK_MAX_FILES,
  RESOURCE_PACK_MAX_REDACTIONS,
  RESOURCE_PACK_MAX_SOURCE_FILE_BYTES,
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
import { mapWithConcurrency } from "./map-with-concurrency.js";

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
  const options: ResourceListOptions = {
    userEmail,
    orgId,
    limit: EXPORT_RESOURCE_LIST_LIMIT,
  };
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

const EXPORT_RESOURCE_READ_CONCURRENCY = 8;
const EXPORT_RESOURCE_LIST_LIMIT = RESOURCE_PACK_MAX_FILES * 2 + 1;

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
  if (metas.length >= EXPORT_RESOURCE_LIST_LIMIT) {
    fail("Resource pack exceeds the export cap.", {
      errorCode: "too_large",
      details: {
        fileCount: metas.length,
        byteCount: 0,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxBytes: RESOURCE_PACK_MAX_BYTES,
      },
    });
  }
  const binaryMetas = metas.filter((meta) =>
    isBinaryResourceMimeType(meta.mimeType),
  );
  if (binaryMetas.length > RESOURCE_PACK_MAX_FILES) {
    fail("Resource pack exceeds the export cap.", {
      errorCode: "too_large",
      details: {
        fileCount: binaryMetas.length,
        byteCount: 0,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxRedactionOnlyPaths: RESOURCE_PACK_MAX_FILES,
        maxBytes: RESOURCE_PACK_MAX_BYTES,
      },
    });
  }
  const textMetas = metas.filter(
    (meta) => !isBinaryResourceMimeType(meta.mimeType),
  );
  const oversized = textMetas.find(
    (meta) =>
      !Number.isFinite(meta.size) ||
      meta.size > RESOURCE_PACK_MAX_SOURCE_FILE_BYTES,
  );
  if (oversized) {
    fail("A resource is too large to export safely.", {
      errorCode: "too_large",
      details: {
        fileCount: textMetas.length,
        byteCount: oversized.size,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxBytes: RESOURCE_PACK_MAX_BYTES,
        maxResourceBytes: RESOURCE_PACK_MAX_SOURCE_FILE_BYTES,
      },
    });
  }
  const entries: ResourcePackEntry[] = [];
  const redactions: ResourcePackRedaction[] = binaryMetas.map((meta) => ({
    path: meta.path,
    reason: "binary",
  }));
  let byteCount = 0;
  for (
    let offset = 0;
    offset < textMetas.length;
    offset += EXPORT_RESOURCE_READ_CONCURRENCY
  ) {
    const loaded = await mapWithConcurrency(
      textMetas.slice(offset, offset + EXPORT_RESOURCE_READ_CONCURRENCY),
      EXPORT_RESOURCE_READ_CONCURRENCY,
      async (meta) => {
        return {
          meta,
          resource: await resourceGet(meta.id, { userEmail, orgId }),
        };
      },
    );

    for (const item of loaded) {
      const resource = item.resource;
      if (!resource || typeof resource.content !== "string") {
        redactions.push({ path: item.meta.path, reason: "unreadable" });
        continue;
      }
      const redacted = redactResourceContent(item.meta.path, resource.content);
      if (redacted.redacted) {
        redactions.push({ path: item.meta.path, reason: "secret" });
      }
      byteCount += Buffer.byteLength(redacted.content, "utf8");
      if (byteCount > RESOURCE_PACK_MAX_BYTES) {
        fail("Resource pack exceeds the export cap.", {
          errorCode: "too_large",
          details: {
            fileCount: metas.length,
            byteCount,
            maxFiles: RESOURCE_PACK_MAX_FILES,
            maxBytes: RESOURCE_PACK_MAX_BYTES,
          },
        });
      }
      entries.push({
        path: item.meta.path,
        scope: packScopeFromOwner(resource.owner, userEmail),
        content: redacted.content,
      });
      if (entries.length > RESOURCE_PACK_MAX_FILES) {
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
    }
  }

  const entryPaths = new Set(entries.map((entry) => entry.path));
  const redactionOnlyPaths = new Set(
    redactions
      .filter((redaction) => !entryPaths.has(redaction.path))
      .map((redaction) => redaction.path),
  );
  if (
    redactionOnlyPaths.size > RESOURCE_PACK_MAX_FILES ||
    redactions.length > RESOURCE_PACK_MAX_REDACTIONS
  ) {
    fail("Resource pack exceeds the export cap.", {
      errorCode: "too_large",
      details: {
        fileCount: entries.length + redactionOnlyPaths.size,
        byteCount,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxRedactionOnlyPaths: RESOURCE_PACK_MAX_FILES,
        maxRedactions: RESOURCE_PACK_MAX_REDACTIONS,
        maxBytes: RESOURCE_PACK_MAX_BYTES,
      },
    });
  }

  const appId = resolveAppId(ctx);
  const pack = buildResourcePack(entries, {
    source: {
      ...(appId ? { appId } : {}),
      scope: packSourceScope(args.scope),
    },
    redactions,
  });
  const requestBytes = Buffer.byteLength(
    JSON.stringify({
      pack,
      targetScope: "organization",
      onConflict: "overwrite",
    }),
    "utf8",
  );
  if (requestBytes > RESOURCE_PACK_MAX_BODY_BYTES) {
    fail("Resource pack exceeds the export cap.", {
      errorCode: "too_large",
      details: {
        fileCount: metas.length,
        byteCount: requestBytes,
        maxFiles: RESOURCE_PACK_MAX_FILES,
        maxBytes: RESOURCE_PACK_MAX_BODY_BYTES,
      },
    });
  }
  return {
    pack,
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
