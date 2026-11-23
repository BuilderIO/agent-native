import { expect, it } from "vitest";

import {
  workspaceWarehouseEditFormInput,
  workspaceWarehouseEditFormSchema,
} from "./workspace-warehouse-edit-form.js";

function form(values: Record<string, unknown> = {}) {
  return {
    connectionId: "workspace-connection-id",
    revision: "opened-form-revision",
    type: "bigquery",
    draft: false,
    values: {
      name: "QA Warehouse",
      projectId: "qa-project",
      queryAccessGroupIds: ["workspace"],
      viewAccessGroupIds: ["workspace"],
      ...values,
    },
  };
}
function mapped(values: Record<string, unknown> = {}) {
  return workspaceWarehouseEditFormInput(
    workspaceWarehouseEditFormSchema.parse(form(values)),
  );
}

it.each([{}, { serviceAccount: "" }])(
  "retains an omitted or empty service account while keeping project credential consistent: case %#",
  (values) => {
    expect(mapped(values)).toEqual({
      connectionId: "workspace-connection-id",
      revision: "opened-form-revision",
      draft: false,
      name: "QA Warehouse",
      config: { projectId: "qa-project" },
      secretValues: [{ key: "BIGQUERY_PROJECT_ID", secret: "qa-project" }],
    });
  },
);
it("strips outer whitespace from a replacement credential and normalizes project in both fields", () => {
  const result = mapped({
    projectId: "  changed-project  ",
    serviceAccount: "\uFEFF\n  flagged-source-credential  \u00A0\n",
  });
  expect(result.config).toEqual({ projectId: "changed-project" });
  expect(result.secretValues).toEqual([
    { key: "BIGQUERY_PROJECT_ID", secret: "changed-project" },
    {
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      secret: "flagged-source-credential",
    },
  ]);
});
it("preserves explicit false choices and omits absent edit options", () => {
  expect(mapped().config).toEqual({ projectId: "qa-project" });
  expect(
    mapped({
      useBQStorageAPI: false,
      includeForAI: false,
      disableTablePreviews: false,
    }).config,
  ).toEqual({
    projectId: "qa-project",
    useBQStorageAPI: false,
    includeForAI: false,
    disableTablePreviews: false,
  });
  expect(mapped({ disableTablePreviews: true }).config).toEqual({
    projectId: "qa-project",
    disableTablePreviews: true,
  });
});
it.each([
  { queryAccessGroupIds: ["restricted-group"] },
  { viewAccessGroupIds: [] },
  { shareWithWorkspace: false },
  { description: "x".repeat(4001) },
  { additionalProjectIds: "another-project" },
  { hasDbtMetadata: true },
  { dbtVersion: "unsupported-version" },
  { dbtToken: "flagged-integration-credential" },
  { driveAccess: true },
  { allowWriteback: true },
  { unknownOption: true },
  { serviceAccount: "  \n " },
  { serviceAccount: "x".repeat(65537) },
])(
  "refuses unsupported or invalid form values instead of dropping them: case %#",
  (values) => {
    expect(
      workspaceWarehouseEditFormSchema.safeParse(form(values)).success,
    ).toBe(false);
  },
);
it.each([
  { connectionId: "" },
  { revision: "" },
  { type: "postgres" },
  { draft: "true" },
  { requestId: "old-create-request" },
  { orgId: "another-org" },
  { ownerEmail: "another@example.test" },
])(
  "requires the exact durable edit identity and mode: case %#",
  (overrides) => {
    expect(
      workspaceWarehouseEditFormSchema.safeParse({ ...form(), ...overrides })
        .success,
    ).toBe(false);
  },
);

it("accepts an update idempotency key when saving an existing connection as a draft", () => {
  const requestId = "19fb24de-3f8f-4782-9cbc-8ced8b8cbd47";
  const input = workspaceWarehouseEditFormSchema.parse({
    ...form(),
    draft: true,
    requestId,
  });
  expect(input.requestId).toBe(requestId);
  expect(workspaceWarehouseEditFormInput(input).draft).toBe(true);
});

it("omits empty optional or cleared dbt strings from native config so core text() does not reject them", () => {
  expect(
    mapped({
      hasDbtMetadata: true,
      dbtVersion: "legacy",
      dbtAccountId: " 42 ",
      dbtProjectId: " 77 ",
      dbtEnvironmentId: "  ",
      dbtToken: "flagged-integration-credential",
    }).config,
  ).toEqual({
    projectId: "qa-project",
    hasDbtMetadata: true,
    dbtVersion: "legacy",
    dbtAccountId: "42",
    dbtProjectId: "77",
    dbtCredentialKey: "WAREHOUSE_DBT_SERVICE_TOKEN",
  });
  expect(
    mapped({
      hasDbtMetadata: false,
      dbtVersion: "",
      dbtAccountId: "",
      dbtProjectId: "",
      dbtEnvironmentId: "",
    }).config,
  ).toEqual({
    projectId: "qa-project",
    hasDbtMetadata: false,
  });
});
