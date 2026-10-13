import { createCoreRoutesPlugin } from "@agent-native/core/server";

import {
  DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
  isDesignGenerationAttemptId,
} from "../../shared/generation-provenance.js";

export function resolveDesignOpenPath({
  view,
  params,
}: {
  view?: string;
  params: Record<string, string>;
}): string | null {
  if (params.designId) {
    const search = new URLSearchParams();
    if (params.screen) {
      search.set("editorView", "overview");
      search.set("screen", params.screen);
    }
    const generationAttemptId = params[DESIGN_GENERATION_ATTEMPT_QUERY_PARAM];
    if (isDesignGenerationAttemptId(generationAttemptId)) {
      search.set(DESIGN_GENERATION_ATTEMPT_QUERY_PARAM, generationAttemptId);
    }
    return `/design/${params.designId}${search.size ? `?${search}` : ""}`;
  }
  if (view === "editor") return "/home";
  return null;
}

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  resolveOpenPath: resolveDesignOpenPath,
  allowUnauthenticatedOpen: ({ target }) => {
    const path = target.split(/[?#]/, 1)[0] ?? "/";
    return path.startsWith("/design/");
  },
});
