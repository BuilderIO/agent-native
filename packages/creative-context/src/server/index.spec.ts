import { getShareableResource } from "@agent-native/core/sharing";
import { describe, expect, it } from "vitest";

import "./index.js";

describe("creative context shareable registrations", () => {
  it("requires org membership for creative context pack user shares", () => {
    const registration = getShareableResource("creative-context-pack");

    expect(registration).toMatchObject({
      allowPublic: false,
      requireOrgMemberForUserShares: true,
    });
  });
});
