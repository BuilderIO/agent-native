import { defineAction } from "@agent-native/core/action";

import {
  datasetPageOutput,
  datasetQuerySchema,
  listConnectionDatasets,
} from "../server/model/data-connections.js";
export default defineAction({
  description:
    "Read one cursor page of datasets or tables from the selected granted warehouse or the built-in demo source. Omit parentId for schemas, then pass a returned schema id to list its tables. Keep requesting endCursor until hasNextPage is false; there is no total dataset cap.",
  schema: datasetQuerySchema,
  outputSchema: datasetPageOutput,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (input, context) =>
    listConnectionDatasets(input, { forAgent: context?.caller !== "frontend" }),
});
