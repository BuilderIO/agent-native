import type { ActionRunContext } from "@agent-native/core/action";
import {
  buildAgentAccessUrl,
  createScopedAgentAccessGrant,
  getConfiguredAppBasePath,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import {
  privateMediaIdsInContent,
  privateMediaPath,
} from "../../shared/private-media.js";
import { getDb, schema } from "../db/index.js";
import { documentTextOutsideBody } from "./private-media-references.js";

/** The scope of an agent's link to one private image. */
export const PRIVATE_MEDIA_AGENT_RESOURCE_KIND = "content:private-media";

/**
 * How long an agent's image link works. A leaked link opens that one image
 * until then, even for someone who has since lost access to its page.
 */
export const PRIVATE_MEDIA_AGENT_LINK_TTL_SECONDS = 60 * 60;

/** Bounds the tokens one read can mint, however many images a page links. */
const MAX_AGENT_LINKS = 200;

/**
 * Callers that read a page without Content's sign-in cookie. MCP widgets run
 * in the host's frame and fetch without credentials.
 */
const AGENT_CALLERS = new Set<ActionRunContext["caller"]>([
  "mcp",
  "mcp-widget",
  "mcp-widget-write",
  "a2a",
  "tool",
  "cli",
  "automation",
]);

export interface PrivateMediaAgentLinks {
  /** When every link below stops working. */
  expiresAt: string;
  /**
   * Each private image the page shows, in its body, a property value or a
   * Blocks field, or on one of its comments, by the link stored there.
   */
  links: Array<{ src: string; url: string }>;
  /** How many more of its images got no link: one read links at most 200. */
  omitted?: number;
}

export function readsWithoutSessionCookie(
  ctx: Pick<ActionRunContext, "caller"> | undefined,
): boolean {
  return !!ctx && AGENT_CALLERS.has(ctx.caller);
}

/**
 * Expiring links to the private images a page shows (in `content`, then in
 * its property values and Blocks fields), for a reader that can't send
 * Content's sign-in cookie, such as an agent over MCP. The caller
 * must already have checked that the reader can read `documentId`. Only
 * images bound to that page get a link, and only while the page is live (not
 * in Trash or in a deleted collection): those are the ones the reader could
 * open in the browser.
 */
export async function privateMediaAgentLinks(input: {
  documentId: string;
  content: string | null | undefined;
  origin?: string;
}): Promise<PrivateMediaAgentLinks | undefined> {
  const found = privateMediaIdsInContent(input.content ?? "");
  for (const text of await documentTextOutsideBody(getDb(), input.documentId)) {
    for (const id of privateMediaIdsInContent(text)) found.add(id);
  }
  const ids = [...found];
  if (ids.length === 0) return undefined;
  const rows = await getDb()
    .select({ mediaId: schema.privateMediaReferences.mediaId })
    .from(schema.privateMediaReferences)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.privateMediaReferences.documentId),
    )
    .where(
      and(
        eq(schema.privateMediaReferences.documentId, input.documentId),
        inArray(schema.privateMediaReferences.mediaId, ids),
        isNull(schema.documents.trashedAt),
        ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
      ),
    );
  const bound = new Set(rows.map((row) => row.mediaId));
  return agentLinksTo(
    ids.filter((id) => bound.has(id)),
    input.origin,
  );
}

/**
 * Expiring links to the images on a page's comments, for a reader that can't
 * send Content's sign-in cookie. The caller must already have checked that
 * the reader can read `documentId`. Links come only while the page is live,
 * as the browser would load them only then.
 */
export async function commentImageAgentLinks(input: {
  documentId: string;
  mediaIds: Iterable<string>;
  origin?: string;
}): Promise<PrivateMediaAgentLinks | undefined> {
  const ids = [...new Set(input.mediaIds)];
  if (ids.length === 0) return undefined;
  // guard:allow-unscoped — the caller checked the reader can read the page; this reads only whether it is live.
  const live = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, input.documentId),
        isNull(schema.documents.trashedAt),
        ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
      ),
    )
    .limit(1);
  return live.length ? agentLinksTo(ids, input.origin) : undefined;
}

function agentLinksTo(
  shown: readonly string[],
  requestOrigin: string | undefined,
): PrivateMediaAgentLinks | undefined {
  if (shown.length === 0) return undefined;
  const linked = shown.slice(0, MAX_AGENT_LINKS);
  const origin = requestOrigin ?? getRequestContext()?.requestOrigin;
  const basePath = getConfiguredAppBasePath();
  const expiresAt = new Date(
    Date.now() + PRIVATE_MEDIA_AGENT_LINK_TTL_SECONDS * 1000,
  ).toISOString();
  const links = linked.map((id) => {
    const { token } = createScopedAgentAccessGrant({
      resourceKind: PRIVATE_MEDIA_AGENT_RESOURCE_KIND,
      resourceId: id,
      ttlSeconds: PRIVATE_MEDIA_AGENT_LINK_TTL_SECONDS,
    });
    return {
      src: privateMediaPath(id),
      url: buildAgentAccessUrl({
        path: privateMediaPath(id),
        token,
        basePath,
        ...(origin ? { origin } : {}),
      }),
    };
  });
  const omitted = shown.length - linked.length;
  return { expiresAt, links, ...(omitted > 0 ? { omitted } : {}) };
}

/** True when `token` is an unexpired agent link to this image. */
export function agentLinkOpensPrivateMedia(
  token: string,
  mediaId: string,
): boolean {
  return (
    !!token &&
    verifyScopedAgentAccessToken(token, {
      resourceKind: PRIVATE_MEDIA_AGENT_RESOURCE_KIND,
      resourceId: mediaId,
    }).ok
  );
}
