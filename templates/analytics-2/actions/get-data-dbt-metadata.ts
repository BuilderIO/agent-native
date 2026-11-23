import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDataTableDetailsSchema } from "../app/lib/model/data-table-contracts.js";
import { readBrowsableDataConnection } from "../server/model/data-connections.js";
import {
  dbtTableMetadataSchema,
  readDbtTableMetadata,
} from "../server/model/data-dbt.js";
import { getDataTableDetails } from "../server/model/data-table-details.js";

const publicDbtMetadataSchema = dbtTableMetadataSchema.omit({ parents: true });

function dbtRevision(connection: {
  config: Record<string, unknown>;
  credentialRefs: readonly { key: string }[];
}) {
  const keys = [
    "hasDbtMetadata",
    "dbtVersion",
    "dbtAccountId",
    "dbtProjectId",
    "dbtEnvironmentId",
    "dbtCloudHostname",
    "dbtCredentialKey",
  ];
  return JSON.stringify({
    values: keys.map((key) => connection.config[key] ?? null),
    credentialPresent: connection.credentialRefs.some(
      (ref) => ref.key === connection.config.dbtCredentialKey,
    ),
  });
}

export default defineAction({
  description:
    "Read dbt model or source documentation, column descriptions, test results and freshness for a table in a granted workspace connection.",
  schema: getDataTableDetailsSchema,
  outputSchema: z.object({
    connectionId: z.string(),
    tableId: z.string(),
    metadata: publicDbtMetadataSchema.nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input, context) => {
    const connection = await readBrowsableDataConnection(input.connectionId);
    if (connection.config.hasDbtMetadata !== true)
      return {
        connectionId: input.connectionId,
        tableId: input.tableId,
        metadata: null,
      };
    const revision = dbtRevision(connection);
    const details = await getDataTableDetails(input, context?.caller);
    const metadata = await readDbtTableMetadata(connection, details.table);
    // A remote request can outlive a grant or AI-policy change.
    await getDataTableDetails(input, context?.caller);
    if (
      dbtRevision(await readBrowsableDataConnection(input.connectionId)) !==
      revision
    )
      fail(
        "The dbt configuration changed while metadata was loading. Please try again.",
        { errorCode: "data_dbt_configuration_changed", statusCode: 409 },
      );
    return {
      connectionId: input.connectionId,
      tableId: input.tableId,
      metadata:
        metadata === null ? null : publicDbtMetadataSchema.parse(metadata),
    };
  },
});
