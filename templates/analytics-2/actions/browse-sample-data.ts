import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { sampleTables, sampleTable } from "../app/lib/model/sample-data.js";
import {
  SAMPLE_TABLE_NAMES,
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_DATA_SOURCE_NAME,
} from "../shared/sample-data-contract.js";
import { requireSemanticOrg } from "./_semantic-helpers.js";

const tableNames = SAMPLE_TABLE_NAMES;

export default defineAction({
  description:
    "Browse the built-in synthetic sample data without connecting a warehouse. Lists its schemas and tables, or returns a complete table preview with typed columns. This source is read-only and contains no account data.",
  schema: z.object({ table: z.enum(tableNames).optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ table }) => {
    await requireSemanticOrg();
    const dataset = table ? sampleTable(table) : null;
    return {
      source: { id: SAMPLE_DATA_SOURCE_ID, name: SAMPLE_DATA_SOURCE_NAME },
      schemas: ["PUBLIC"],
      tables: sampleTables().map((dataset) => ({
        name: dataset.name,
        schema: "PUBLIC",
        rowCount: dataset.rows.length,
      })),
      preview: dataset
        ? {
            table: dataset.name,
            columns: dataset.columns.map((column, i) => ({
              name: column.name,
              dataType:
                column.type === "number"
                  ? "NUMERIC"
                  : column.type === "date"
                    ? "DATE"
                    : column.type === "datetime"
                      ? "TIMESTAMP"
                      : column.type === "boolean"
                        ? "BOOLEAN"
                        : column.type === "null"
                          ? "NULL"
                          : "TEXT",
              nullable: dataset.rows.some((row) => row[i] === null),
              ordinalPosition: i + 1,
            })),
            rows: dataset.rows.map((row) =>
              Object.fromEntries(
                dataset.columns.map((column, index) => [
                  column.name,
                  row[index] ?? null,
                ]),
              ),
            ),
            complete: true as const,
          }
        : null,
    };
  },
});
