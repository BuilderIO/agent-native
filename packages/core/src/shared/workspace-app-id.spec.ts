import { describe, expect, it } from "vitest";

import {
  getWorkspaceAppIdValidationError,
  isValidWorkspaceAppIdFormat,
  normalizeWorkspaceAppId,
} from "./workspace-app-id.js";

describe("workspace app id validation", () => {
  it("accepts lowercase workspace app ids", () => {
    expect(isValidWorkspaceAppIdFormat("customer-portal2")).toBe(true);
    expect(getWorkspaceAppIdValidationError("customer-portal2")).toBeNull();
  });

  it("rejects ids that cannot be mounted as workspace app paths", () => {
    expect(getWorkspaceAppIdValidationError("Customer Portal")).toContain(
      "Use lowercase letters",
    );
  });

  it("normalizes human-friendly app names into mount-safe ids", () => {
    expect(normalizeWorkspaceAppId(" Customer Portal ")).toBe(
      "customer-portal",
    );
    expect(normalizeWorkspaceAppId("Sales_ops v2")).toBe("sales-ops-v2");
    expect(normalizeWorkspaceAppId("123 Reports")).toBe("reports");
  });

  it("rejects reserved workspace routes", () => {
    for (const appId of [
      "dispatch",
      "apps",
      "approval",
      "thread-debug",
      "login",
      "tools",
      "_agent-native",
      "api",
      "auth",
    ]) {
      expect(getWorkspaceAppIdValidationError(appId)).toContain(
        "reserved workspace route",
      );
    }
  });
});
