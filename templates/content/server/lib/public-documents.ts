import { randomUUID } from "node:crypto";

import { getCookie, getHeader, setCookie, type H3Event } from "h3";

const PUBLIC_VIEWER_COOKIE = "content_public_viewer";
const PUBLIC_VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const PUBLIC_DOCUMENT_CONTEXT_EXCERPT_CHARS = 2_400;

type PublicDocumentPromptInput = {
  id: string;
  title: string;
  description?: string;
  content: string;
  updatedAt: string | Date;
};

function publicDocumentExcerpt(content: string): {
  excerpt: string;
  truncated: boolean;
} {
  const normalized = content.trim();
  if (normalized.length <= PUBLIC_DOCUMENT_CONTEXT_EXCERPT_CHARS) {
    return { excerpt: normalized, truncated: false };
  }

  const tailChars = Math.floor(PUBLIC_DOCUMENT_CONTEXT_EXCERPT_CHARS / 3);
  const headChars = PUBLIC_DOCUMENT_CONTEXT_EXCERPT_CHARS - tailChars;
  return {
    excerpt: `${normalized.slice(0, headChars)}\n\n... [middle omitted from initial context] ...\n\n${normalized.slice(-tailChars)}`,
    truncated: true,
  };
}

export function buildPublicDocumentPromptContext(
  doc: PublicDocumentPromptInput,
): string {
  const { excerpt, truncated } = publicDocumentExcerpt(doc.content);
  const fullDocumentGuidance = truncated
    ? `This is a bounded excerpt of the document. Before answering a question that may depend on omitted content, call \`get-document\` with \`id: "${doc.id}"\` to read the complete document.`
    : `The complete document fits in this context. Call \`get-document\` with \`id: "${doc.id}"\` if you need a fresh structured copy.`;

  return `<public-shared-document>
The user is viewing a public, read-only shared Content document. Answer questions using this document as the primary context. Do not create, edit, delete, comment on, share, or otherwise mutate document data for public viewers.
${fullDocumentGuidance}

Document ID: ${doc.id}
Title: ${doc.title}
Description: ${doc.description || "(none)"}
Updated at: ${doc.updatedAt}

Markdown excerpt:
${excerpt}
</public-shared-document>`;
}

function getAppOrigin(event: H3Event): string | null {
  const proto =
    getHeader(event, "x-forwarded-proto") ??
    (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
  const host = getHeader(event, "x-forwarded-host") ?? getHeader(event, "host");
  if (!host) return null;
  return `${proto}://${host}`;
}

function publicDocumentIdFromEvent(event: H3Event): string | null {
  const referrer = getHeader(event, "referer");
  if (!referrer) return null;

  try {
    const url = new URL(referrer);
    // Reject off-origin referers — without this an attacker hosting a
    // page at evil.com/p/<id> could trick same-site requests into
    // minting an anonymous-viewer identity scoped to a doc the user
    // never opened. The lax-cookie protections we rely on assume the
    // referer-derived doc context is same-origin.
    const appOrigin = getAppOrigin(event);
    if (appOrigin && url.origin !== appOrigin) return null;
    const match = url.pathname.match(/(?:^|\/)p\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

async function getPublicDocumentForEvent(event: H3Event) {
  const id = publicDocumentIdFromEvent(event);
  if (!id) return null;

  const { getDb } = await import("../db/index.js");
  const { documents } = await import("../db/schema.js");
  const { and, eq } = await import("drizzle-orm");

  const [doc] = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      description: documents.description,
      content: documents.content,
      updatedAt: documents.updatedAt,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.visibility, "public")))
    .limit(1);

  return doc ?? null;
}

export async function resolvePublicViewerOwner(
  event: H3Event,
): Promise<string | null> {
  const doc = await getPublicDocumentForEvent(event);
  let viewerId = getCookie(event, PUBLIC_VIEWER_COOKIE);

  if (!doc) {
    // OAuth callbacks return with Referer set to the OAuth provider, not
    // /p/<id>. To still resolve an anonymous owner for the callback we
    // accept the viewer cookie when the request path is exactly the
    // builder callback. The pending-connect row written by /builder/connect
    // (which DID require a /p/<id> Referer) is the gate that prevents
    // arbitrary callback hits from completing.
    const rawPath = event.node?.req?.url ?? event.path ?? "";
    const pathOnly = rawPath.split("?")[0]?.split("#")[0] ?? "";
    const isBuilderCallback =
      pathOnly === "/_agent-native/builder/callback" ||
      pathOnly.endsWith("/_agent-native/builder/callback");
    if (isBuilderCallback && viewerId && /^[0-9a-f-]{36}$/i.test(viewerId)) {
      return `public-${viewerId}@agent-native.local`;
    }
    return null;
  }

  if (!viewerId || !/^[0-9a-f-]{36}$/i.test(viewerId)) {
    viewerId = randomUUID();
    const proto =
      getHeader(event, "x-forwarded-proto") ??
      (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
    setCookie(event, PUBLIC_VIEWER_COOKIE, viewerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: proto === "https",
      path: "/",
      maxAge: PUBLIC_VIEWER_COOKIE_MAX_AGE,
    });
  }

  return `public-${viewerId}@agent-native.local`;
}

export async function publicDocumentExtraContext(event: H3Event) {
  const doc = await getPublicDocumentForEvent(event);
  if (!doc) return null;

  return buildPublicDocumentPromptContext(doc);
}
