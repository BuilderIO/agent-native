import { describe, expect, it } from "vitest";

import createAnalyticsPublicKey from "./create-analytics-public-key.js";
import deleteDataSourceCredentials from "./delete-data-source-credentials.js";
import deleteDbAdminConnection from "./delete-db-admin-connection.js";
import revokeAnalyticsPublicKey from "./revoke-analytics-public-key.js";
import saveDbAdminConnection from "./save-db-admin-connection.js";
import saveSigmaConnection from "./save-sigma-connection.js";
import updateAnalyticsPublicKey from "./update-analytics-public-key.js";
import updateDataSourceCredentials from "./update-data-source-credentials.js";

// Stored provider credentials, connection secrets and public keys are the
// owner's, so a full-app panel hands them to a signed-in browser.
const actions = [
  ["update-data-source-credentials", updateDataSourceCredentials],
  ["delete-data-source-credentials", deleteDataSourceCredentials],
  ["save-db-admin-connection", saveDbAdminConnection],
  ["delete-db-admin-connection", deleteDbAdminConnection],
  ["save-sigma-connection", saveSigmaConnection],
  ["create-analytics-public-key", createAnalyticsPublicKey],
  ["update-analytics-public-key", updateAnalyticsPublicKey],
  ["revoke-analytics-public-key", revokeAnalyticsPublicKey],
] as const;

describe("actions that need a signed-in browser", () => {
  it.each(actions)("%s refuses full-app panels", (_name, action) => {
    expect(action.requiresSignedInBrowser).toBe(true);
  });
});
