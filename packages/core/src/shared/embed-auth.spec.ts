import { describe, expect, it } from "vitest";

import {
  allowsMcpDirectoryWidgetReadAction,
  createMcpDirectoryWidgetReadCapability,
  isMcpDirectoryWidgetReadCapabilityScope,
  MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX,
} from "./embed-auth.js";

describe("MCP directory widget read capabilities", () => {
  it("encodes a stable allowlist of action names", () => {
    const scope = createMcpDirectoryWidgetReadCapability([
      "get-document",
      "list-documents",
      "get-document",
    ]);

    expect(scope).toBe(
      `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}get-document,list-documents`,
    );
    expect(allowsMcpDirectoryWidgetReadAction(scope, "get-document")).toBe(
      true,
    );
    expect(allowsMcpDirectoryWidgetReadAction(scope, "create-document")).toBe(
      false,
    );
  });

  it("fails closed for malformed scopes and action names", () => {
    expect(createMcpDirectoryWidgetReadCapability([])).toBeUndefined();
    expect(createMcpDirectoryWidgetReadCapability(["list,delete"])).toBe(
      undefined,
    );
    expect(
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}list-documents,../delete`,
        "list-documents",
      ),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}list-documents,list-documents`,
        "list-documents",
      ),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}${"a".repeat(600)}`,
        "list-documents",
      ),
    ).toBe(false);
    expect(
      isMcpDirectoryWidgetReadCapabilityScope(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}malformed`,
      ),
    ).toBe(true);
  });
});
