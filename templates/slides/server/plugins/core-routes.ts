import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  envKeys,
  googleOAuthCallbackPaths: [
    "/_agent-native/google/callback",
    "/_agent-native/google-docs/callback",
  ],
  googleOAuthCredentialMode: "user",
  resolveOpenPath: ({ view, params }) => {
    if (params.deckId) {
      const slideNumber =
        params.slideNumber ??
        (params.slideIndex && Number.isFinite(Number(params.slideIndex))
          ? String(Number(params.slideIndex) + 1)
          : undefined);
      const suffix = view === "present" ? "/present" : "";
      const query = slideNumber
        ? `?slide=${encodeURIComponent(slideNumber)}`
        : "";
      return `/deck/${params.deckId}${suffix}${query}`;
    }
    if (view === "editor" || view === "list") return "/home";
    if (view === "present") return "/";
    return null;
  },
});
