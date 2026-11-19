import { describe, expect, it } from "vitest";

import {
  recordTurnGrantConnectCredential,
  turnGrantConnectCredential,
} from "./turn-grant-identity.js";

describe("turn grant connect credential", () => {
  it("is readable only through the identity object it was recorded on", () => {
    const verified = {};
    const lookalike = {};
    expect(turnGrantConnectCredential(verified)).toBeUndefined();
    recordTurnGrantConnectCredential(verified, "jti-1");
    expect(turnGrantConnectCredential(verified)).toBe("jti-1");
    expect(turnGrantConnectCredential(lookalike)).toBeUndefined();
  });

  it("replaces the credential when the same identity is recorded again", () => {
    const identity = {};
    recordTurnGrantConnectCredential(identity, "first");
    recordTurnGrantConnectCredential(identity, "second");
    expect(turnGrantConnectCredential(identity)).toBe("second");
  });
});
