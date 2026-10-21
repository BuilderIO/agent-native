import { afterEach, describe, expect, it, vi } from "vitest";

const getAppConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getAppConfig: () => getAppConfigMock(),
}));

import { runWithRequestContext } from "@agent-native/core/server";

import { isDispatchEnvironmentAdmin } from "./admin-config.js";

describe("isDispatchEnvironmentAdmin", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("recognizes configured environment administrators outside delegated requests", () => {
    getAppConfigMock.mockReturnValue({
      dispatch: {
        adminEmails: ["platform@example.test"],
        workspaceOwnerEmails: [],
        defaultOwnerEmail: null,
      },
    });

    expect(isDispatchEnvironmentAdmin("PLATFORM@example.test")).toBe(true);
  });

  it("does not turn an org-member assertion for an environment admin into global access", async () => {
    getAppConfigMock.mockReturnValue({
      dispatch: {
        adminEmails: ["platform@example.test"],
        workspaceOwnerEmails: [],
        defaultOwnerEmail: null,
      },
    });

    await runWithRequestContext(
      {
        userEmail: "platform@example.test",
        orgId: "org-1",
        a2aIdentityAssurance: "org-member",
      },
      () => {
        expect(isDispatchEnvironmentAdmin("platform@example.test")).toBe(false);
      },
    );
  });
});
