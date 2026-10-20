import type { OperationDefinitionInput } from "../operations.js";

// Eight complete days up to `until`, summed per service and day. BigQuery
// returns every cell as a string, in column order, under `rows[].f[].v`.
// Columns: 0 service, 1 day, 2 day start (ISO), 3 cost, 4 row key.
const BILLING_SQL = [
  "SELECT service.description AS service_name,",
  "CAST(DATE(usage_start_time) AS STRING) AS usage_date,",
  "FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', TIMESTAMP(DATE(usage_start_time))) AS day_start,",
  "CAST(SUM(cost) AS STRING) AS cost,",
  "CONCAT(service.description, '|', CAST(DATE(usage_start_time) AS STRING)) AS row_key",
  "FROM `{table}`",
  "WHERE usage_start_time >= TIMESTAMP_SUB(TIMESTAMP(DATE(@until)), INTERVAL 8 DAY)",
  "AND usage_start_time < TIMESTAMP(DATE(@until))",
  "GROUP BY service_name, usage_date, day_start, row_key",
  "ORDER BY usage_date, service_name",
].join(" ");

export const bigqueryOperations: OperationDefinitionInput[] = [
  {
    // POST, but it only reads. `table` is pasted into the SQL, so the host
    // must accept only a dotted table name there.
    id: "bigquery.billingQuery",
    provider: "bigquery",
    label: "BigQuery: daily cloud cost by service",
    nodeKinds: ["source"],
    effect: "read",
    readsViaPost: true,
    fields: [
      {
        name: "table",
        type: "string",
        required: true,
        label: "Billing export table",
      },
      {
        name: "projectId",
        type: "string",
        label: "Project (the connected project when empty)",
      },
    ],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/projects/{projectId}/queries",
      bodyTemplate: {
        query: BILLING_SQL,
        useLegacySql: false,
        parameterMode: "NAMED",
        queryParameters: [
          {
            name: "until",
            parameterType: { type: "TIMESTAMP" },
            parameterValue: { value: "{until}" },
          },
        ],
        maxResults: 100,
        timeoutMs: 60000,
      },
    },
    window: { fromParam: "since", toParam: "until" },
    itemMapping: {
      kind: "spike",
      itemsPath: "rows",
      fields: {
        title: "f[0].v",
        occurredAt: "f[2].v",
        "extras.service": "f[0].v",
        "extras.date": "f[1].v",
        "extras.cost": "f[3].v",
      },
      dedupeKey: "f[4].v",
      // BigQuery sends the cost as text; Summarize adds numbers.
      numberFields: ["extras.cost"],
    },
    credential: { provider: "bigquery" },
  },
];
