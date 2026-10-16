import { describe, expect, it } from "vitest";

import inviteMember from "./invite-member.js";
import removeMember from "./remove-member.js";

describe("organization member actions", () => {
  it.each([
    ["invite-member", inviteMember],
    ["remove-member", removeMember],
  ])("%s asks the user to approve every agent call", (_name, action) => {
    expect(action.needsApproval).toBe(true);
    expect(action.allowPersistentApproval).toBe(false);
  });
});
