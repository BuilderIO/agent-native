import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({
  envKeys,
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
    if (view === "editor" || view === "present" || view === "list") return "/";
    return null;
  },
});
