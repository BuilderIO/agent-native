import { defineAction } from "@agent-native/core/action";

import {
  dataBrowserCatalogOutputSchema,
  getDataBrowserCatalogSchema,
} from "../app/lib/model/data-catalog-contracts.js";
import { readDataBrowserCatalog } from "../server/model/data-browser-catalog.js";

export default defineAction({
  description:
    "Read one page of the top-level schema catalog for a readable workspace data connection, including the built-in demo source. Warehouse catalogs use a saved snapshot; the demo catalog is always available. totalCount covers every matching schema, not only this page. List a schema's tables with list-connection-datasets and its returned schema id as parentId.",
  schema: getDataBrowserCatalogSchema,
  outputSchema: dataBrowserCatalogOutputSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (input, context) => readDataBrowserCatalog(input, context?.caller),
});
