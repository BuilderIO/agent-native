import { describe, expect, it, vi } from "vitest";

import { ActionContractError, defineAction } from "../action.js";
import { resolveMcpAppResourceSafely, type MCPConfig } from "./build-server.js";

function resolveWithCspError(statusCode: number, errorCode: string) {
  const error = new ActionContractError("private upstream detail", {
    statusCode,
    errorCode,
  });
  const entry = defineAction({
    description: "A widget",
    parameters: {},
    readOnly: true,
    run: async () => ({}),
    mcpApp: {
      resource: {
        html: "<p>widget</p>",
        csp: async () => {
          throw error;
        },
      },
    },
  });
  const config: MCPConfig = {
    name: "Test",
    appId: "test",
    description: "Test",
    actions: { widget: entry },
  };
  return resolveMcpAppResourceSafely(config, "widget", entry);
}

describe("MCP app resource resolution", () => {
  it("preserves a retryable workspace lookup error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        resolveWithCspError(503, "workspace_app_access_unavailable"),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Workspace app access is temporarily unavailable.",
        ),
        data: {
          statusCode: 503,
          errorCode: "workspace_app_access_unavailable",
          retryable: true,
        },
      });
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    [403, "workspace_app_access_unavailable"],
    [503, "other_failure"],
  ])(
    "skips the resource for any other failure (%i, %s)",
    async (statusCode, errorCode) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          resolveWithCspError(statusCode, errorCode),
        ).resolves.toBeNull();
      } finally {
        warn.mockRestore();
      }
    },
  );
});
