import { createCoreRoutesPlugin } from "@agent-native/core/server";
import { envKeys } from "../lib/env-config.js";
import { resolvePublicViewerOwner } from "../lib/public-documents.js";

export default createCoreRoutesPlugin({
  envKeys,
  anonymousOwner: resolvePublicViewerOwner,
  // Land deep links (`/_agent-native/open?app=content&view=editor&documentId=…`)
  // straight on the real SPA path so there's no `/editor` -> `/` bounce before
  // the polled `navigate` command applies record focus.
  resolveOpenPath: ({ view, params }) => {
    if (params.documentId) return `/page/${params.documentId}`;
    if (view === "editor") return "/";
    if (view === "list") return "/";
    return null;
  },
});
