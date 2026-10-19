import { describe, expect, it } from "vitest";

import inviteMember from "./invite-member.js";
import removeMember from "./remove-member.js";
import updateMemberRole from "./update-member-role.js";

describe("organization member actions", () => {
  it.each([
    ["invite-member", inviteMember],
    ["remove-member", removeMember],
    ["update-member-role", updateMemberRole],
  ])("%s asks the user to approve every agent call", (_name, action) => {
    expect(action.needsApproval).toBe(true);
    expect(action.allowPersistentApproval).toBe(false);
  });
});
