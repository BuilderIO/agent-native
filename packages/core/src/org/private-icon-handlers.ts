import {
  createError,
  defineEventHandler,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDbExec } from "../db/client.js";
import {
  getIconAsset,
  IconUploadBodyError,
  putIconAsset,
  readIconUploadFormData,
  readIconAssetForAuthorizedReference,
} from "../icon-assets/index.js";
import {
  readFederatedWorkspaceIcon,
  uploadFederatedWorkspaceIcon,
  verifyFederatedWorkspaceIconOwner,
  type WorkspaceIconAuthority,
} from "../icon-assets/workspace-transport.js";
import { getSession } from "../server/auth.js";
import { runWithRequestContext } from "../server/request-context.js";
import { getOrgContext } from "./context.js";
import { validateFederatedOrganizationMembership } from "./federation.js";
import { parseOrganizationIconJson } from "./visual-identity.js";

const ASSET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ICON_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

type WorkspaceIconOrg = WorkspaceIconAuthority & { iconJson: unknown };

async function readOrg(orgId: string): Promise<WorkspaceIconOrg | null> {
  const result = await getDbExec().execute({
    sql: `SELECT identity_authority, identity_id, allowed_domain, icon_json
          FROM organizations WHERE id = ? LIMIT 1`,
    args: [orgId],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    identityAuthority:
      typeof row.identity_authority === "string"
        ? row.identity_authority
        : null,
    identityId: typeof row.identity_id === "string" ? row.identity_id : null,
    allowedDomain:
      typeof row.allowed_domain === "string" ? row.allowed_domain : null,
    iconJson: row.icon_json,
  };
}

function isFederated(org: WorkspaceIconAuthority): boolean {
  if (Boolean(org.identityAuthority) !== Boolean(org.identityId)) {
    throw new Error("Workspace identity mapping is incomplete.");
  }
  return Boolean(org.identityAuthority);
}

export const uploadWorkspacePrivateIconHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId || !ctx.email)
      throw createError({
        statusCode: 401,
        message: "Organization access required",
      });
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can upload workspace icons",
      });
    }
    const org = await readOrg(ctx.orgId);
    if (!org)
      throw createError({ statusCode: 404, message: "Organization not found" });
    const form = await readIconUploadFormData(event.req).catch(
      (error: unknown) => {
        if (error instanceof IconUploadBodyError) {
          throw createError({
            statusCode: error.statusCode,
            cause: error,
            message:
              error.statusCode === 413
                ? "Workspace icon is too large"
                : error.message,
          });
        }
        throw error;
      },
    );
    const file = form.get("file");
    if (!file || typeof file === "string" || !file.size)
      throw createError({ statusCode: 400, message: "Image file required" });
    if (file.size > MAX_ICON_BYTES)
      throw createError({
        statusCode: 413,
        message: "Workspace icon is too large",
      });
    const mimeType = file.type?.toLowerCase();
    if (!mimeType || !IMAGE_TYPES.has(mimeType)) {
      throw createError({
        statusCode: 415,
        message: "Unsupported workspace icon image type",
      });
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const id = await runWithRequestContext(
      { userEmail: ctx.email, orgId: ctx.orgId },
      async () =>
        isFederated(org)
          ? uploadFederatedWorkspaceIcon(event, org, ctx.email, {
              data,
              mimeType,
              filename: file.name || "workspace-icon",
            })
          : (
              await putIconAsset({
                data,
                mimeType,
                filename: file.name || undefined,
                ownerEmail: ctx.email,
                orgId: ctx.orgId,
              })
            ).id,
    );
    if (!ASSET_ID.test(id))
      throw new Error("Workspace icon storage returned an invalid asset ID.");
    setResponseStatus(event, 201);
    return { id };
  },
);

export const readWorkspacePrivateIconHandler = defineEventHandler(
  async (event: H3Event) => {
    const session = await getSession(event);
    if (!session?.email)
      throw createError({
        statusCode: 401,
        message: "Authentication required",
      });
    const path = getRequestURL(event).pathname;
    const match = path.match(
      /^(?:\/_agent-native\/org\/private-icons)?\/(library\/)?([A-Za-z0-9_-]{1,128})\/([0-9a-f-]{36})\/?$/i,
    );
    if (!match || !ORG_ID.test(match[2]) || !ASSET_ID.test(match[3])) {
      throw createError({
        statusCode: 404,
        message: "Workspace icon not found",
      });
    }
    const [, library, orgId, assetId] = match;
    const membership = await getDbExec().execute({
      sql: `SELECT role FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL LIMIT 1`,
      args: [orgId, session.email.toLowerCase()],
    });
    if (!membership.rows.length)
      throw createError({
        statusCode: 404,
        message: "Workspace icon not found",
      });
    if (
      library &&
      membership.rows[0]?.role !== "owner" &&
      membership.rows[0]?.role !== "admin"
    ) {
      throw createError({
        statusCode: 404,
        message: "Workspace icon not found",
      });
    }
    const org = await readOrg(orgId);
    if (!org)
      throw createError({
        statusCode: 404,
        message: "Workspace icon not found",
      });
    if (library) {
      const owned = isFederated(org)
        ? await verifyFederatedWorkspaceIconOwner(
            event,
            org,
            session.email,
            assetId,
          )
        : Boolean(
            await getIconAsset(assetId, { ownerEmail: session.email, orgId }),
          );
      if (!owned)
        throw createError({
          statusCode: 404,
          message: "Workspace icon not found",
        });
    } else {
      const icon = parseOrganizationIconJson(org.iconJson);
      if (
        icon?.kind !== "image" ||
        icon.authority !== "private-icon" ||
        icon.assetId !== assetId
      ) {
        throw createError({
          statusCode: 404,
          message: "Workspace icon not found",
        });
      }
    }
    if (isFederated(org)) {
      const verified = await validateFederatedOrganizationMembership(event, {
        orgId,
        email: session.email,
      });
      if (!verified.active)
        throw createError({
          statusCode: 404,
          message: "Workspace icon not found",
        });
    }
    const bytes = isFederated(org)
      ? await readFederatedWorkspaceIcon(event, org, session.email, assetId)
      : await readIconAssetForAuthorizedReference(assetId, { orgId });
    if (!bytes || !IMAGE_TYPES.has(bytes.mimeType)) {
      throw createError({
        statusCode: 404,
        message: "Workspace icon not found",
      });
    }
    setResponseHeader(event, "Content-Type", bytes.mimeType);
    setResponseHeader(event, "Content-Length", String(bytes.data.length));
    setResponseHeader(event, "Cache-Control", "private, no-store");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    if (bytes.mimeType === "image/svg+xml") {
      setResponseHeader(
        event,
        "Content-Security-Policy",
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      );
    }
    return Buffer.from(bytes.data);
  },
);

export async function assertOwnedLocalWorkspaceIcon(
  assetId: string,
  email: string,
  orgId: string,
): Promise<void> {
  if (
    !ASSET_ID.test(assetId) ||
    !(await getIconAsset(assetId, { ownerEmail: email, orgId }))
  ) {
    throw createError({
      statusCode: 403,
      message:
        "Workspace icon asset is not owned by this organization administrator",
    });
  }
}

export function requirePrivateWorkspaceIconId(assetId: string): void {
  if (!ASSET_ID.test(assetId)) {
    throw createError({
      statusCode: 400,
      message: "Invalid workspace icon asset ID",
    });
  }
}
