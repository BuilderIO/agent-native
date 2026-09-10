import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { envKeys } from "../lib/env-config.js";
import { resolvePublicViewerOwner } from "../lib/public-documents.js";

export function resolveContentOpenPath({
  view,
  params,
}: {
  view?: string;
  params: Record<string, string>;
}) {
  if (params.documentId) {
    const search = new URLSearchParams();
    for (const key of ["databaseId", "databaseDocumentId", "viewId"] as const) {
      const value = params[key];
      if (value) search.set(key, value);
    }
    const query = search.toString();
    return `/page/${encodeURIComponent(params.documentId)}${query ? `?${query}` : ""}`;
  }
  if (view === "editor" || view === "list") return "/home";
  return null;
}

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  envKeys,
  anonymousOwner: resolvePublicViewerOwner,
  // Land deep links (`/_agent-native/open?app=content&view=editor&documentId=…`)
  // straight on the real SPA path so there's no `/editor` -> `/` bounce before
  // the polled `navigate` command applies record focus.
  resolveOpenPath: resolveContentOpenPath,
});
