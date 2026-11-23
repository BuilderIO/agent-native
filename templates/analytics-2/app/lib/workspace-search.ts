import { callAction } from "@agent-native/core/client/hooks";

import type { SearchQuery, SearchResult } from "@/components/search";
import { customRangeParams } from "@/components/search/custom-date-range";

export async function searchWorkspace(
  query: SearchQuery,
  onPartial?: (results: SearchResult[]) => void,
): Promise<SearchResult[]> {
  const { customRange, customDateField, customDateMode, ...rest } = query;
  const run = (fields: SearchQuery["fields"], projectsOnly?: true) =>
    callAction(
      "search-workspace",
      {
        ...rest,
        fields,
        ...(projectsOnly ? { projectsOnly } : {}),
        ...customRangeParams(customRange ?? null, customDateMode ?? "between"),
        dateField: customDateField ?? "lastEdited",
      },
      { method: "GET" },
    );
  const quickFields = rest.fields.filter((f) => f !== "cellContents");
  if (
    onPartial &&
    rest.text !== "" &&
    quickFields.length > 0 &&
    quickFields.length < rest.fields.length
  ) {
    void run(quickFields, true).then(
      (quick) => onPartial(quick.results),
      () => undefined,
    );
  }
  return (await run(rest.fields)).results;
}
