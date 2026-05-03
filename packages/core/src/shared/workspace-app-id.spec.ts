import { describe, expect, it } from "vitest";
import {
  getWorkspaceAppIdValidationError,
  isValidWorkspaceAppIdFormat,
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

  it("rejects reserved workspace routes", () => {
    for (const appId of [
      "dispatch",
      "apps",
      "login",
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
