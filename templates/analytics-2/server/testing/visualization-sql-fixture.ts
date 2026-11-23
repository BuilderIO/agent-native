import { PGlite } from "@electric-sql/pglite";
import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import { afterAll } from "vitest";

import type { ResultField } from "../../shared/notebook-result-contract.js";
import { notebookArrowValue } from "../execution/notebook-arrow.js";
import type { executeVisualizationSql } from "../execution/visualization-kernel.js";

const db = new PGlite();
afterAll(() => db.close());

const ready = db.exec(`
  SET TIME ZONE 'UTC';
  CREATE FUNCTION from_hex(text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT
    AS $$ SELECT pg_catalog.decode($1, 'hex') $$;
  CREATE FUNCTION decode(bytea) RETURNS text LANGUAGE sql IMMUTABLE STRICT
    AS $$ SELECT convert_from($1, 'UTF8') $$;
  CREATE FUNCTION contains(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT
    AS $$ SELECT strpos($1, $2) > 0 $$;
  CREATE FUNCTION to_base64(bytea) RETURNS text LANGUAGE sql IMMUTABLE STRICT
    AS $$ SELECT replace(encode($1, 'base64'), chr(10), '') $$;
  CREATE FUNCTION float_to_varchar(double precision) RETURNS varchar LANGUAGE sql IMMUTABLE STRICT
    AS $$ SELECT CASE WHEN $1::text ~ '^-?[0-9]+$' THEN $1::text || '.0' ELSE $1::text END $$;
  CREATE CAST (double precision AS varchar) WITH FUNCTION float_to_varchar(double precision);
`);

function columnType(field: ResultField) {
  if (field.type === "integer") return "bigint";
  if (field.type === "number") return "double precision";
  if (field.type === "boolean") return "boolean";
  if (field.type === "binary") return "bytea";
  return "text";
}

export async function runVisualizationInPGlite(
  request: Parameters<typeof executeVisualizationSql>[0],
) {
  const { decodeVisualizationPayload, joinVisualizationArrow } =
    await import("../execution/visualization-kernel.js");
  if (!(await request.authorize()))
    throw new Error("Fixture source is unauthorized");
  const arrow = tableFromIPC(
    await joinVisualizationArrow(request.manifest, request.readInput()),
  );
  const columns = request.manifest.fields.map((field, index) => {
    const vector = arrow.getChild(String(index));
    if (!vector) throw new Error("Fixture artifact is missing an Arrow column");
    return { vector, name: `"${index}"`, type: columnType(field) };
  });
  const rows = Array.from({ length: arrow.numRows }, (_, index) =>
    columns.map(({ vector }) => {
      const value = notebookArrowValue(vector, index);
      if (typeof value === "bigint") return String(value);
      if (value instanceof Uint8Array)
        return `\\x${Buffer.from(value).toString("hex")}`;
      return value;
    }),
  );
  await ready;
  const payload = await db.transaction(async (tx) => {
    await tx.exec(
      `CREATE TEMP TABLE input (${columns.map(({ name, type }) => `${name} ${type}`).join(", ")}) ON COMMIT DROP`,
    );
    await tx.query(
      `INSERT INTO input SELECT ${columns.map(({ type }, index) => `CAST(value->>${index} AS ${type})`).join(", ")} FROM jsonb_array_elements($1::jsonb)`,
      [JSON.stringify(rows)],
    );
    const result = await tx.query<{ payload: unknown }>(request.source);
    if (result.fields.length !== 1 || result.fields[0]?.name !== "payload")
      throw new Error("Fixture transform has an invalid output column");
    return result.rows.map(({ payload }) => JSON.stringify(payload));
  });
  if (!(await request.authorize())) throw new Error("Fixture source changed");
  return decodeVisualizationPayload(tableToIPC(tableFromArrays({ payload })));
}
