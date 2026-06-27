import { describe, expect, it } from "vitest";

import {
  cleanSubmitterEmail,
  isAgentNativeAnonymousEmail,
  publicSubmitterEmail,
} from "./submitter-email.js";

describe("submitter email helpers", () => {
  it("keeps real email hints", () => {
    expect(cleanSubmitterEmail(" user@example.com ")).toBe("user@example.com");
  });

  it("drops synthetic Agent Native anonymous owner emails", () => {
    expect(cleanSubmitterEmail("anon-abc123@agent-native.com")).toBeNull();
    expect(cleanSubmitterEmail(" ANON-owner@agent-native.com ")).toBeNull();
    expect(publicSubmitterEmail("anon-visitor@agent-native.com")).toBeNull();
  });

  it("does not treat other agent-native.com emails as anonymous owners", () => {
    expect(cleanSubmitterEmail("support@agent-native.com")).toBe(
      "support@agent-native.com",
    );
    expect(isAgentNativeAnonymousEmail("anon@agent-native.com")).toBe(false);
  });
});
