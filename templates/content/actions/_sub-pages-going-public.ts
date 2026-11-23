import { fail } from "@agent-native/core/action";
import {
  MAX_PUBLIC_FOLLOWERS,
  resolveAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";

import { publicSubPageIds } from "../server/lib/public-sub-pages.js";
import { resolveDocumentAccess } from "./_document-access.js";

const SUB_PAGES_AT_ONCE = 10;

export async function readSubPagesGoingPublic<T>(
  documentId: string,
  read: (content: string | null) => Promise<T>,
): Promise<{ found: T[]; more: boolean }> {
  const page = await resolveDocumentAccess(documentId, {
    skipResourceBody: true,
  });
  if (!page || page.resource.trashedAt) {
    fail("Page not found", {
      errorCode: "document_not_found",
      statusCode: 404,
    });
  }
  if (!roleSatisfies(page.role, "admin")) {
    fail("Only people who can share this page can see this.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
  const ids = await publicSubPageIds(page.resource, { isPublic: false });
  const more = ids.length > MAX_PUBLIC_FOLLOWERS;
  const found: T[] = [];
  const carried = ids.slice(0, MAX_PUBLIC_FOLLOWERS);
  for (let index = 0; index < carried.length; index += SUB_PAGES_AT_ONCE) {
    const batch = await Promise.all(
      carried.slice(index, index + SUB_PAGES_AT_ONCE).map(async (subPageId) => {
        const access = await resolveAccess("document", subPageId);
        if (!access || !roleSatisfies(access.role, "admin")) return null;
        if (access.resource.visibility === "public") return null;
        const content = access.resource.content;
        return {
          value: await read(typeof content === "string" ? content : null),
        };
      }),
    );
    for (const entry of batch) if (entry) found.push(entry.value);
  }
  return { found, more };
}
