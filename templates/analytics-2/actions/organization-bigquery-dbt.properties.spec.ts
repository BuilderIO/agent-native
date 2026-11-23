import { fail } from "@agent-native/core/action";
import { checkActionProperties } from "@agent-native/core/action-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ requireOrg: vi.fn() }));

vi.mock("./_semantic-helpers.js", async (original) => ({
  ...(await original<typeof import("./_semantic-helpers.js")>()),
  requireSemanticOrg: state.requireOrg,
}));

import getMetadata from "./get-organization-bigquery-dbt-metadata.js";
import getConfiguration from "./get-organization-bigquery-dbt.js";
import saveConnection from "./save-organization-bigquery-dbt-connection.js";

describe("organization dbt action input contracts", () => {
  beforeEach(() => {
    state.requireOrg.mockReset();
    state.requireOrg.mockImplementation(async () =>
      fail("An active workspace is required.", {
        errorCode: "workspace_required",
        statusCode: 403,
      }),
    );
  });

  it.each([
    ["configuration", getConfiguration],
    ["table metadata", getMetadata],
    ["connection save", saveConnection],
  ] as const)(
    "validates generated %s inputs before entering the authorization boundary",
    async (_name, action) => {
      await checkActionProperties(action, {
        runs: 15,
        seed: 17,
        context: { caller: "frontend" },
      });
      expect(state.requireOrg).toHaveBeenCalledTimes(15);
    },
  );
});
