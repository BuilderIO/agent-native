import { describe, expect, it } from "vitest";

import { WORKSPACE_CREDENTIAL_MARKER } from "./workspace-credential-marker.js";

describe("WORKSPACE_CREDENTIAL_MARKER", () => {
  it("is the stable marker stored on workspace connection refs", () => {
    expect(WORKSPACE_CREDENTIAL_MARKER).toBe("workspace-connection");
  });
});
