import { describe, expect, it, vi } from "vitest";

import { ActionContractError, defineAction } from "../action.js";
import { resolveMcpAppResourceSafely, type MCPConfig } from "./build-server.js";

describe("MCP app resource resolution", () => {
  it.each([
    [503, "workspace_app_access_unavailable", true],
    [403, "workspace_app_access_unavailable", false],
    [503, "other_failure", false],
  ])(
    "preserves retryable workspace lookup errors only (%i, %s)",
    async (statusCode, errorCode, retryable) => {
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
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = resolveMcpAppResourceSafely(config, "widget", entry);
        if (retryable) {
          await expect(result).rejects.toMatchObject({
            message: expect.stringContaining(
              "Workspace app access is temporarily unavailable.",
            ),
            data: {
              statusCode: 503,
              errorCode: "workspace_app_access_unavailable",
              retryable: true,
            },
          });
        } else {
          await expect(result).resolves.toBeNull();
        }
      } finally {
        warn.mockRestore();
      }
    },
  );
});
