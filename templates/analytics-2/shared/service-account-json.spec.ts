import { expect, it } from "vitest";

import { normalizeServiceAccountJson } from "./service-account-json";
import {
  workspaceWarehouseFormInput,
  workspaceWarehouseFormSchema,
} from "./workspace-warehouse-form";

const key = JSON.stringify({
  type: "service_account",
  project_id: "example-project",
  client_email: "reader@example-project.iam.gserviceaccount.invalid",
  private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
});

it.each(["\uFEFF", "\u00A0", "\u2003"])(
  "makes a key wrapped in %j parseable, which JSON.parse alone refuses",
  (padding) => {
    const pasted = `${padding}${key}${padding}`;
    expect(() => JSON.parse(pasted)).toThrow(SyntaxError);
    expect(JSON.parse(normalizeServiceAccountJson(pasted))).toMatchObject({
      project_id: "example-project",
    });
  },
);

it("leaves an already clean key unchanged", () => {
  expect(normalizeServiceAccountJson(`${key}\r\n`)).toBe(key);
});

it("hands the native create writer the normalized key", () => {
  const input = workspaceWarehouseFormSchema.parse({
    requestId: "11111111-1111-4111-8111-111111111111",
    type: "bigquery",
    draft: false,
    values: {
      name: "Example warehouse",
      projectId: "example-project",
      serviceAccount: `\uFEFF${key}\u00A0`,
      queryAccessGroupIds: ["workspace"],
      viewAccessGroupIds: ["workspace"],
    },
  });
  const secret = workspaceWarehouseFormInput(input).secretValues.find(
    (value) => value.key === "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  )?.secret;
  expect(secret).toBe(key);
});
