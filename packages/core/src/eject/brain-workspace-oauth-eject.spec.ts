import { expect, it } from "vitest";

import { WORKSPACE_CONNECTION_PROVIDERS as runtimeProviders } from "../connections/catalog.js";
import { workspaceConnectionProviderOverrides } from "./workspace-connections.js";

it("keeps every runtime workspace provider customizable in the ejected catalog", () => {
  expect(
    workspaceConnectionProviderOverrides.map(({ id }) => id).sort(),
  ).toEqual(runtimeProviders.map(({ id }) => id).sort());
});
