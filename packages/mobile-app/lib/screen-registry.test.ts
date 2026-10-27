import { describe, expect, it } from "vitest";

import { getScreenKind, SCREEN_REGISTRY } from "./screen-registry";

describe("mobile screen registry", () => {
  it("keeps the mail routes on their current hosted implementation", () => {
    expect(SCREEN_REGISTRY).toEqual({
      "mail.inbox": "remote",
      "mail.thread": "remote",
      "mail.compose": "remote",
    });
  });

  it("defaults routes without an explicit registration to the hosted app", () => {
    expect(getScreenKind("user-app.home")).toBe("remote");
  });
});
