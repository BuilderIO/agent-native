import { fail, isActionContractError } from "@agent-native/core/action";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { isBuiltinSampleConnection } from "../model/data-connection-dto.js";

export const ORGANIZATION_SOURCE_ONLY_NOTE =
  "Reads the organization source only: a saved or granted connection from list-data-connections is read with list-connection-datasets and get-data-table-details instead.";

export async function rerouteMissingOrganizationSource(
  error: unknown,
): Promise<never> {
  if (
    !isActionContractError(error) ||
    error.errorCode !== "bigquery_org_credentials_missing"
  ) {
    throw error;
  }
  let grantedConnectionIds: string[];
  try {
    const { listDataConnections } =
      await import("../model/data-connections.js");
    grantedConnectionIds = (await listDataConnections({ forAgent: true }))
      .filter(
        (connection) =>
          connection.type === "bigquery" &&
          connection.id !== ORGANIZATION_BIGQUERY_SOURCE_ID &&
          !isBuiltinSampleConnection(connection.id),
      )
      .map((connection) => connection.id);
  } catch {
    throw error;
  }
  if (grantedConnectionIds.length === 0) throw error;
  fail(
    "This workspace has no organization BigQuery source, so this tool cannot read your connected data. Your granted connection needs no extra setup: call list-data-connections, then list-connection-datasets with its id and get-data-table-details with a returned table id, or run its SQL cell with run-project-cell.",
    {
      errorCode: "bigquery_org_source_not_configured",
      statusCode: 409,
      details: { grantedConnectionIds },
    },
  );
}
