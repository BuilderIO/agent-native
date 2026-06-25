import { createCoreRoutesPlugin } from "@agent-native/core/server";

import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({
  sseRoute: "/_agent-native/sse",
  envKeys,
  // Land deep links (`/_agent-native/open?app=calendar&view=calendar&eventId=…&date=…`)
  // straight on the real SPA path. The calendar UI renders at the ROOT route
  // (`app/routes/_app._index.tsx`), not `/calendar`, so the framework default
  // redirect to `/calendar` would 404. Map the `calendar` deep-link view to `/`;
  // the polled one-shot `navigate` command (written by `/open`) still carries
  // `eventId`/`date`, which `use-navigation-state` consumes to focus the event
  // after load. Unknown views fall back to the framework default.
  resolveOpenPath: ({ view }) => {
    if (view === "calendar") return "/";
    return null;
  },
});
