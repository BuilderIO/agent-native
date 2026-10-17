import { describe, expect, it } from "vitest";

import { activeConnectionMasksLocalCredentialFailure } from "./source-readiness";

describe("active workspace connection readiness", () => {
  it("prioritizes missing Brain-local credentials over active connection metadata", () => {
    expect(
      activeConnectionMasksLocalCredentialFailure({
        usesBrainLocalCredentials: true,
        providerHealth: {
          status: "missing_credentials",
          message: "Add organization Gong keys.",
        },
        workspaceConnection: {
          hasActiveWorkspaceConnection: true,
        },
      }),
    ).toBe(true);
  });

  it("keeps the shared-connection callout for other provider states", () => {
    expect(
      activeConnectionMasksLocalCredentialFailure({
        usesBrainLocalCredentials: true,
        providerHealth: {
          status: "ready",
          message: "Ready.",
        },
        workspaceConnection: {
          hasActiveWorkspaceConnection: true,
        },
      }),
    ).toBe(false);
  });
});
