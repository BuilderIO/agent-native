import { getRegisteredProviderApiRuntimeOptions } from "@agent-native/core/provider-api";
import { describe, expect, it } from "vitest";

import { DESIGN_APP_ID } from "./provider-api.js";

describe("Design provider API registration", () => {
  // Capability reads (the composer's Figma source, connected integrations)
  // only see providers of a registered runtime.
  it("registers Design's providers when the runtime loads", () => {
    expect(
      getRegisteredProviderApiRuntimeOptions(DESIGN_APP_ID)?.providerIds,
    ).toEqual(expect.arrayContaining(["figma", "github"]));
  });
});
