import { fail } from "@agent-native/core/action";
import { z } from "zod";

import { withWarehouseSource } from "../execution/warehouse-connector.js";
import type {
  datasetPageOutput,
  datasetQuerySchema,
} from "./data-connections.js";
import { resourcePolicies } from "./data-resource-policy.js";
import { postgresSchemaId, postgresTableId } from "./data-table-details.js";
import type { WorkspaceScope } from "./scope.js";

const catalogCursor = z.strictObject({
  connectionId: z.string(),
  generation: z.string(),
  parentId: z.string().nullable(),
  search: z.string(),
  offset: z.number().int().nonnegative(),
});

function invalidCursor(): never {
  fail("The dataset cursor is invalid.", {
    errorCode: "data_connection_cursor_invalid",
    statusCode: 422,
  });
}

function pageOffset(
  after: string | undefined,
  expected: Omit<z.infer<typeof catalogCursor>, "offset">,
) {
  if (after === undefined) return 0;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }
  const parsed = catalogCursor.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.connectionId !== expected.connectionId ||
    parsed.data.generation !== expected.generation ||
    parsed.data.parentId !== expected.parentId ||
    parsed.data.search !== expected.search
  )
    invalidCursor();
  return parsed.data.offset;
}

function schemaName(projectId: string, id: string) {
  const prefix = `schema:${encodeURIComponent(projectId)}:`;
  if (!id.startsWith(prefix)) invalidCursor();
  let name: string;
  try {
    name = decodeURIComponent(id.slice(prefix.length));
  } catch {
    invalidCursor();
  }
  if (!name || postgresSchemaId(projectId, name) !== id) invalidCursor();
  return name;
}

export function listPostgresCatalogPage(
  input: z.infer<typeof datasetQuerySchema>,
  scope: WorkspaceScope,
  forAgent: boolean,
): Promise<z.infer<typeof datasetPageOutput>> {
  const { connectionId } = input;
  return withWarehouseSource(
    connectionId,
    { ...scope, caller: forAgent ? "agent" : "frontend" },
    async (source) => {
      if (source.kind !== "postgres")
        fail("The data connection changed.", {
          errorCode: "data_catalog_source_changed",
          statusCode: 409,
        });
      const parent = input.parentId
        ? schemaName(source.projectId, input.parentId)
        : undefined;
      if (forAgent && input.parentId) {
        const policies = await resourcePolicies(
          scope,
          connectionId,
          [{ kind: "schema", id: input.parentId }],
          "included",
          { bypassCache: true },
        );
        if (policies.get(`schema:${input.parentId}`) !== "included")
          fail(
            "This data resource is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
            {
              errorCode: "data_resource_ai_disabled",
              statusCode: 403,
            },
          );
      }
      const context = {
        connectionId,
        generation: source.generation,
        parentId: input.parentId ?? null,
        search: input.search?.trim().toLowerCase() ?? "",
      };
      const offset = pageOffset(input.after, context);
      const catalog = await source.connector.catalog(
        parent ? { schema: parent } : {},
      );
      const items = parent
        ? catalog.tables.map(({ schema, name, oid }) => ({
            id: postgresTableId(source.projectId, schema, name, oid),
            name,
            kind: "table" as const,
            hasChildren: false,
          }))
        : catalog.schemas.map((name) => ({
            id: postgresSchemaId(source.projectId, name),
            name,
            kind: "schema" as const,
            hasChildren: true,
          }));
      const filtered = items.filter(({ name }) =>
        name.toLowerCase().includes(context.search),
      );
      const page = filtered.slice(offset, offset + input.first);
      const policies = forAgent
        ? await resourcePolicies(scope, connectionId, page, "included", {
            bypassCache: true,
          })
        : null;
      await source.authorize();
      const next = offset + page.length;
      const hasNextPage = next < filtered.length;
      return {
        items: policies
          ? page.filter(
              ({ kind, id }) => policies.get(`${kind}:${id}`) === "included",
            )
          : page,
        endCursor: hasNextPage
          ? Buffer.from(JSON.stringify({ ...context, offset: next })).toString(
              "base64url",
            )
          : null,
        hasNextPage,
      };
    },
  );
}
