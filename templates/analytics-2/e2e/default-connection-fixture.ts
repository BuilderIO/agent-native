import { z } from "zod";

const fixtureSchema = z
  .object({
    connectionId: z.string().trim().min(1),
    query: z
      .string()
      .trim()
      .regex(
        /^SELECT 1 AS qa_value FROM `[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` LIMIT 1$/i,
      ),
    expectedRows: z.tuple([z.tuple([z.literal(1)])]),
  })
  .strict();

export function parseDefaultConnectionFixture(input: string) {
  return fixtureSchema.parse(JSON.parse(input));
}

const connectionsSchema = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      isDefault: z.boolean(),
      isDraft: z.boolean(),
    }),
  ),
});
const catalogSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), kind: z.enum(["database", "schema", "table"]) }),
  ),
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
});
type Action = (
  name: string,
  data: Record<string, unknown>,
  method: "GET",
) => Promise<unknown>;
type Fixture = z.infer<typeof fixtureSchema>;
type Selected = { id: string; name: string; type: string };
type Preparation =
  | {
      status: "ready";
      selected: Selected;
      connectionId: string;
      query: string;
      expectedRows: unknown[][];
    }
  | { status: "unavailable"; reason: string };

function tableIdentity(schemaId: string, tableId: string): string | undefined {
  try {
    const schema = schemaId.split(":");
    const table = tableId.split(":");
    if (
      schema.length !== 3 ||
      schema[0] !== "schema" ||
      table.length !== 4 ||
      table[0] !== "table"
    )
      return undefined;
    const parts = table.slice(1).map(decodeURIComponent);
    const parent = schema.slice(1).map(decodeURIComponent);
    if (
      parts[0] !== parent[0] ||
      parts[1] !== parent[1] ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      return undefined;
    return parts.join(".");
  } catch {
    return undefined;
  }
}

export async function prepareDefaultConnectionFixture(
  action: Action,
  explicit?: { connectionId: string; query: string; expectedRows: unknown[][] },
): Promise<Preparation> {
  const unavailable = (reason: string): Preparation => ({
    status: "unavailable",
    reason,
  });
  const getSelected = async () =>
    connectionsSchema
      .parse(await action("list-data-connections", {}, "GET"))
      .connections.find((item) => item.isDefault && !item.isDraft);
  let selected;
  try {
    selected = await getSelected();
  } catch {
    return unavailable("Default connection list is unreadable");
  }
  if (!selected) return unavailable("No default connection is available");
  if (explicit && explicit.connectionId !== selected.id)
    return unavailable(
      "The default connection no longer matches the table fixture",
    );
  const validated = explicit ? fixtureSchema.safeParse(explicit) : undefined;
  if (validated && !validated.success)
    return unavailable("The table fixture is invalid");
  let fixture: Fixture | undefined = validated?.data;
  if (!fixture) {
    if (selected.type !== "bigquery")
      return unavailable("Default connection SQL dialect is unsupported");
    try {
      let schemaCursor: string | undefined;
      let schemaPages = 0;
      while (schemaPages++ < 10) {
        const schemas = catalogSchema.parse(
          await action(
            "list-connection-datasets",
            {
              connectionId: selected.id,
              ...(schemaCursor ? { after: schemaCursor } : {}),
            },
            "GET",
          ),
        );
        for (const schema of schemas.items
          .filter((item) => item.kind === "schema")
          .slice(0, 20)) {
          let tableCursor: string | undefined;
          const seenCursors = new Set<string>();
          let tablePages = 0;
          while (tablePages++ < 10) {
            const tables = catalogSchema.parse(
              await action(
                "list-connection-datasets",
                {
                  connectionId: selected.id,
                  parentId: schema.id,
                  ...(tableCursor ? { after: tableCursor } : {}),
                },
                "GET",
              ),
            );
            for (const table of tables.items.filter(
              (item) => item.kind === "table",
            )) {
              const identity = tableIdentity(schema.id, table.id);
              if (identity) {
                fixture = {
                  connectionId: selected.id,
                  query: `SELECT 1 AS qa_value FROM \`${identity}\` LIMIT 1`,
                  expectedRows: [[1]],
                };
                break;
              }
            }
            if (fixture) break;
            if (!tables.hasNextPage) break;
            if (!tables.endCursor || seenCursors.has(tables.endCursor))
              return unavailable(
                "Default connection catalog is unreadable: invalid table cursor",
              );
            seenCursors.add(tables.endCursor);
            tableCursor = tables.endCursor;
            if (tablePages === 10)
              return unavailable(
                "Default connection catalog exceeds the bounded table pages",
              );
          }
          if (fixture) break;
        }
        if (fixture || !schemas.hasNextPage) break;
        if (!schemas.endCursor || schemas.endCursor === schemaCursor)
          return unavailable(
            "Default connection catalog is unreadable: invalid cursor",
          );
        schemaCursor = schemas.endCursor;
      }
    } catch {
      return unavailable("Default connection catalog is unreadable");
    }
    if (!fixture)
      return unavailable(
        "Default connection catalog is empty or has no eligible table",
      );
  }
  let current;
  try {
    current = await getSelected();
  } catch {
    return unavailable("Default connection list is unreadable on recheck");
  }
  if (
    !current ||
    current.id !== fixture.connectionId ||
    current.type !== selected.type
  )
    return unavailable(
      "The default connection no longer matches the table fixture",
    );
  return {
    status: "ready",
    selected: { id: selected.id, name: selected.name, type: selected.type },
    ...fixture,
  };
}
