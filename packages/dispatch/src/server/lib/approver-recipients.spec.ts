import { describe, expect, it, vi } from "vitest";

import { approverRecipients } from "./dispatch-store.js";

describe("approverRecipients", () => {
  it("drops test identities from approval mail, saying so", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(
      approverRecipients(["lead@example.com", "qa-owner@example.test"]),
    ).toEqual(["lead@example.com"]);
    expect(String(info.mock.calls[0]?.[0])).toContain(
      "suppressed: test identity",
    );
  });
});
