import { fail } from "@agent-native/core/action";
import { z } from "zod";

import { sampleTables } from "../../app/lib/model/sample-data.js";

export const SAMPLE_SCHEMA_ID = "schema:PUBLIC";
export const SAMPLE_PROJECT_ID = "sample";

const cursorSchema = z
  .object({
    parent: z.string(),
    search: z.string(),
    offset: z.number().int().positive(),
  })
  .strict();

type SampleResource = {
  id: string;
  name: string;
  kind: "schema" | "table";
  hasChildren: boolean;
};

export function sampleDatasetPage(input: {
  parentId?: string | undefined;
  after?: string | undefined;
  first?: number | undefined;
  search?: string | undefined;
}): {
  items: SampleResource[];
  endCursor: string | null;
  hasNextPage: boolean;
} {
  const tables: SampleResource[] = sampleTables().map((table) => ({
    id: `table:${SAMPLE_PROJECT_ID}:PUBLIC:${table.name}`,
    name: table.name,
    kind: "table",
    hasChildren: false,
  }));
  const parent = input.parentId ?? "";
  let resources: SampleResource[];
  if (parent === "") {
    resources = [
      {
        id: SAMPLE_SCHEMA_ID,
        name: "PUBLIC",
        kind: "schema",
        hasChildren: true,
      },
    ];
  } else if (parent === SAMPLE_SCHEMA_ID) {
    resources = tables;
  } else if (tables.some((table) => table.id === parent)) {
    resources = [];
  } else {
    fail("The selected dataset is invalid.", {
      errorCode: "data_connection_dataset_invalid",
      statusCode: 422,
    });
  }
  const search = input.search?.trim().toLowerCase() ?? "";
  if (search) {
    const matches = (resource: SampleResource) =>
      resource.name.toLowerCase().includes(search);
    resources = resources.filter(
      (resource) =>
        matches(resource) ||
        (resource.id === SAMPLE_SCHEMA_ID && tables.some(matches)),
    );
  }
  let offset = 0;
  if (input.after !== undefined) {
    let cursor: z.infer<typeof cursorSchema>;
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(input.after, "base64url").toString("utf8")),
      );
    } catch {
      fail("The dataset cursor is invalid.", {
        errorCode: "data_connection_cursor_invalid",
        statusCode: 422,
      });
    }
    if (
      cursor.parent !== parent ||
      cursor.search !== search ||
      cursor.offset >= resources.length
    )
      fail("The dataset cursor is invalid.", {
        errorCode: "data_connection_cursor_invalid",
        statusCode: 422,
      });
    offset = cursor.offset;
  }
  const first = input.first ?? 50;
  if (!Number.isInteger(first) || first < 1 || first > 1000)
    fail("The dataset page size is invalid.", {
      errorCode: "data_connection_page_size_invalid",
      statusCode: 422,
    });
  const items = resources.slice(offset, offset + first);
  const hasNextPage = offset + items.length < resources.length;
  return {
    items,
    endCursor: hasNextPage
      ? Buffer.from(
          JSON.stringify({ parent, search, offset: offset + items.length }),
        ).toString("base64url")
      : null,
    hasNextPage,
  };
}
