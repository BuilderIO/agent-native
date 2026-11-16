import { describe, expect, it } from "vitest";

import deleteDataSourceCredentials from "./delete-data-source-credentials.js";
import updateDataSourceCredentials from "./update-data-source-credentials.js";

// Stored provider credentials are the owner's, so a full-app panel hands them
// to a signed-in browser.
const actions = [
  ["update-data-source-credentials", updateDataSourceCredentials],
  ["delete-data-source-credentials", deleteDataSourceCredentials],
] as const;

describe("actions that need a signed-in browser", () => {
  it.each(actions)("%s refuses full-app panels", (_name, action) => {
    expect(action.requiresSignedInBrowser).toBe(true);
  });
});
