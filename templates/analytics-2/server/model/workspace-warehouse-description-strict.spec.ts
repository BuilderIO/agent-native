import { expect, it } from "vitest";

import { readWorkspaceWarehouseDescription } from "../../shared/workspace-warehouse-description.js";
import {
  workspaceWarehouseEditFormInput,
  workspaceWarehouseEditFormSchema,
} from "../../shared/workspace-warehouse-edit-form.js";
import {
  workspaceWarehouseFormInput,
  workspaceWarehouseFormSchema,
} from "../../shared/workspace-warehouse-form.js";
import {
  presentationSource,
  resolveConnectionPresentation,
} from "./data-connection-policy.js";
const values = {
  name: "QA description",
  projectId: "fixture-project",
  serviceAccount: "flagged-source-credential",
  queryAccessGroupIds: ["workspace"],
  viewAccessGroupIds: ["workspace"],
};
function create(description?: string) {
  return workspaceWarehouseFormSchema.parse({
    requestId: "11bcd440-3e88-4d70-9fba-7813ea73d635",
    type: "bigquery",
    draft: false,
    values: {
      ...values,
      ...(description === undefined ? {} : { description }),
    },
  });
}
it.each([
  "",
  "  ",
  "  Description  ",
  "first\nsecond",
  'quotes " and \\ slash',
  "x".repeat(4000),
])("roundtrips exact native description case %#", (description) => {
  const config = {
    ...workspaceWarehouseFormInput(create(description)).config,
    workspaceCredentialProfile: "workspace-v1",
  };
  expect(readWorkspaceWarehouseDescription(config.descriptionJson)).toBe(
    description,
  );
  const result = resolveConnectionPresentation(config, null);
  expect(result.description).toBe(description);
  expect(presentationSource(config, result).description).toBe("native");
  const mapped = workspaceWarehouseEditFormInput(
    workspaceWarehouseEditFormSchema.parse({
      connectionId: "fixture-connection",
      revision: "fixture-revision",
      type: "bigquery",
      draft: false,
      values: { ...values, description, serviceAccount: "" },
    }),
  );
  expect(readWorkspaceWarehouseDescription(mapped.config.descriptionJson)).toBe(
    description,
  );
});
it("omitted Description remains absent from native create and edit configuration", () => {
  expect(workspaceWarehouseFormInput(create()).config).not.toHaveProperty(
    "descriptionJson",
  );
  const mapped = workspaceWarehouseEditFormInput(
    workspaceWarehouseEditFormSchema.parse({
      connectionId: "fixture-connection",
      revision: "fixture-revision",
      type: "bigquery",
      draft: false,
      values,
    }),
  );
  expect(mapped.config).not.toHaveProperty("descriptionJson");
});
it.each([
  null,
  5,
  "invalid-json",
  "null",
  "{}",
  "[]",
  "false",
  "7",
  JSON.stringify("x".repeat(4001)),
])("rejects invalid persisted descriptions case %#", (encoded) => {
  expect(() => readWorkspaceWarehouseDescription(encoded)).toThrow();
  const config = {
    workspaceCredentialProfile: "workspace-v1",
    descriptionJson: encoded,
  };
  expect(() => resolveConnectionPresentation(config, null)).toThrow();
});
it("distinguishes an absent native description from an unreadable present one", () => {
  expect(() => readWorkspaceWarehouseDescription(undefined)).toThrow();
  const config = { workspaceCredentialProfile: "workspace-v1" };
  const result = resolveConnectionPresentation(config, null);
  expect(result.description).toBe("");
  expect(presentationSource(config, result).description).toBe("default");
});
it("requires the exact native marker and gives initialized canonical descriptions precedence", () => {
  for (const workspaceCredentialProfile of [undefined, "other-profile"]) {
    const config = {
      workspaceCredentialProfile,
      descriptionJson: JSON.stringify("native"),
      description: "legacy",
    };
    expect(resolveConnectionPresentation(config, null).description).toBe(
      "legacy",
    );
  }
  const config = {
    workspaceCredentialProfile: "workspace-v1",
    descriptionJson: JSON.stringify("native"),
  };
  const result = resolveConnectionPresentation(config, {
    description: "",
    descriptionInitialized: true,
    aiUsage: null,
  });
  expect(result.description).toBe("");
  expect(presentationSource(config, result).description).toBe("canonical");
  expect(() => create("x".repeat(4001))).toThrow();
});

it.each(["agent_native_qa", "", "one, two"])(
  "preserves configured dataset names on native create and edit: %s",
  (datasetNames) => {
    const creation = workspaceWarehouseFormSchema.parse({
      requestId: "11bcd440-3e88-4d70-9fba-7813ea73d635",
      type: "bigquery",
      draft: false,
      values: { ...values, datasetNames },
    });
    expect(workspaceWarehouseFormInput(creation).config).toHaveProperty(
      "datasetNames",
      datasetNames,
    );
    const edit = workspaceWarehouseEditFormSchema.parse({
      connectionId: "fixture-connection",
      revision: "fixture-revision",
      type: "bigquery",
      draft: false,
      values: { ...values, serviceAccount: "", datasetNames },
    });
    expect(workspaceWarehouseEditFormInput(edit).config).toHaveProperty(
      "datasetNames",
      datasetNames,
    );
  },
);
