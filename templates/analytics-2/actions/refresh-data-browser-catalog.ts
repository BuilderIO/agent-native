import { defineAction } from "@agent-native/core/action";

import {
  dataCatalogRefreshOutputSchema,
  refreshDataBrowserCatalogSchema,
} from "../app/lib/model/data-catalog-contracts.js";
import { refreshDataBrowserCatalog } from "../server/model/data-browser-catalog.js";

/**
 * The dispatcher normalises an engine-attested `context.caller` (frontend,
 * agent, mcp, cli) to the connection-scoped authorization mode, so the UI and
 * agents share one permission rule. A direct in-process `run(input)` has no
 * attested caller and keeps the original manager-only contract.
 *
 * `context.caller` is not part of the input schema: a caller can never choose
 * its own authorization mode through request arguments.
 */
export default defineAction({
  description:
    "Refresh the top-level schema catalog for a readable workspace data connection. Every provider page is read before the saved snapshot is replaced; a failed refresh keeps the last good catalog. The built-in demo source returns its current static catalog without provider work.",
  schema: refreshDataBrowserCatalogSchema,
  outputSchema: dataCatalogRefreshOutputSchema,
  http: { method: "POST" },
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: ({ connectionId, revision }, context) =>
    refreshDataBrowserCatalog(connectionId, {
      caller: context?.caller,
      authorization: context?.caller ? "connection" : "manager",
      revision,
    }),
});
