import { describe, expect, it } from "vitest";

import createResourceVersion from "./create-resource-version.js";
import getResourceVersion from "./get-resource-version.js";
import listResourceHistory from "./list-resource-history.js";
import listResourceVersions from "./list-resource-versions.js";
import restoreResourceVersion from "./restore-resource-version.js";

describe("history actions over MCP", () => {
  it.each([
    ["create-resource-version", createResourceVersion],
    ["get-resource-version", getResourceVersion],
    ["list-resource-history", listResourceHistory],
    ["list-resource-versions", listResourceVersions],
    ["restore-resource-version", restoreResourceVersion],
  ] as const)(
    "serves %s to outside agents unlisted, through tool search",
    (_name, action) => {
      expect(action.mcpTool).toBe("search");
    },
  );
});
